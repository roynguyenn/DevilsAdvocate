import pytest
from fastapi.testclient import TestClient

import app as server
import money_plan
import snapshot
import store

client = TestClient(server.app)
SEED_ID = money_plan.SEED_ACCOUNT["id"]


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "STATE", tmp_path / "state.json")
    monkeypatch.setattr(snapshot, "LOCAL_PURCHASES", tmp_path / "purchases.json")
    monkeypatch.setenv("DATA_SOURCE", "seed")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)


def test_accounts_lists_linkable_accounts():
    assert client.get("/accounts").json() == [money_plan.SEED_ACCOUNT]


def test_profile_starts_empty_then_round_trips():
    assert client.get(f"/profile?account_id={SEED_ID}").json()["monthly_income"] == 0
    saved = client.put("/profile", json={"account_id": SEED_ID, "monthly_income": 2500, "fixed_bills": 1500,
                                         "savings": 500, "discretionary": 9999}).json()
    # Discretionary is derived, never taken from the client.
    assert (saved["monthly_income"], saved["fixed_bills"], saved["savings"], saved["discretionary"]) == (2500, 1500, 500, 500)
    assert saved["account"] == money_plan.SEED_ACCOUNT
    assert client.get(f"/profile?account_id={SEED_ID}").json() == saved


def test_impossible_plan_is_rejected_with_a_reason():
    r = client.put("/profile", json={"account_id": SEED_ID, "monthly_income": 1000, "fixed_bills": 900, "savings": 200})
    assert r.status_code == 400 and "more than your income" in r.json()["detail"]


def test_unknown_account_is_404():
    assert client.get("/profile?account_id=someone-else").status_code == 404


def test_snapshot_uses_defaults_until_a_plan_is_saved():
    snap = client.post("/evaluate", json={"title": "Headphones", "price": 180}).json()["snapshot"]
    assert (snap["monthly_income"], snap["monthly_bills"], snap["savings"], snap["budget"]) == (2000, 1200, 400, 400)


def test_saved_plan_drives_the_budget_the_score_uses():
    before = client.post("/evaluate?debug=true", json={"title": "x", "price": 180}).json()["debug"]
    client.put("/profile", json={"account_id": SEED_ID, "monthly_income": 2000, "fixed_bills": 1200, "savings": 600})
    after = client.post("/evaluate?debug=true", json={"title": "x", "price": 180}).json()
    assert after["snapshot"]["budget"] == 200
    assert after["debug"]["score_after"] < before["score_after"]  # a smaller budget makes the same item tighter


def test_plan_is_rebuilt_from_nessie_records():
    deposits = [{"description": "Paycheck", "amount": 900},
                {"description": "PROFILE income | 2345.67", "amount": 2346}]
    bills = [{"nickname": "Rent", "payment_amount": 700},
             {"nickname": "PROFILE fixed bills", "payment_amount": 1200.5},
             {"nickname": "PROFILE savings", "payment_amount": 300}]
    plan = money_plan.plan_from_records(bills, deposits)
    assert (plan["monthly_income"], plan["fixed_bills"], plan["savings"]) == (2345.67, 1200.5, 300)
    assert plan["discretionary"] == 845.17 and plan["saved"] is True
    assert money_plan.plan_from_records([{"nickname": "Rent"}], [{"description": "Paycheck"}]) == money_plan.EMPTY


def test_profile_bills_never_count_as_bills_coming_due():
    from datetime import date
    bills = [{"status": "recurring", "nickname": "Rent", "upcoming_payment_date": "2026-11-01", "payment_amount": 700},
             {"status": "recurring", "nickname": "PROFILE fixed bills", "payment_date": "2026-11-01", "payment_amount": 1200}]
    real = [b for b in bills if not money_plan.is_profile_bill(b)]
    assert snapshot.bills_due_within(real, date(2026, 10, 25)) == 700
