"""The popup's Finances tab is stored in (fake) Nessie and read back exactly."""

import pytest
from fastapi.testclient import TestClient

import app as server
import finances
import nessie
import score
import store

client = TestClient(server.app)


def profile_body(bank, income, fixed, savings, discretionary=None):
    if discretionary is None:
        discretionary = round(income - fixed - savings, 2)
    return {"account_id": bank.ids["account_id"], "monthly_income": income, "fixed_bills": fixed,
            "savings": savings, "discretionary": discretionary}


def numbers(profile: dict) -> tuple:
    return tuple(profile[k] for k in ("monthly_income", "fixed_bills", "savings", "discretionary"))


def test_seeded_profile_reads_back_from_nessie(bank):
    assert numbers(finances.get_profile(bank.ids["account_id"])) == (1500, 700, 400, 400)


def test_save_keeps_exact_cents_even_though_nessie_truncates_deposits(bank):
    finances.save_profile(bank.ids["account_id"], 4500.55, 1800.25, 1200.10)
    assert numbers(finances.get_profile(bank.ids["account_id"])) == (4500.55, 1800.25, 1200.10, 1500.20)

    [income] = bank.of_account(bank.deposits, bank.ids["account_id"])
    assert (income["description"], income["amount"]) == ("INCOME | 4500.55", 4501)
    [bill] = bank.of_account(bank.bills, bank.ids["account_id"])
    assert (bill["nickname"], bill["status"], bill["payment_amount"]) == ("Fixed bills", "recurring", 1800.25)
    [saving] = bank.of_account(bank.deposits, bank.ids["savings_account_id"])
    assert (saving["description"], saving["amount"]) == ("SAVINGS | 1200.10", 1200)
    assert all(isinstance(d["amount"], int) for d in bank.deposits.values())


def test_saving_again_updates_records_in_place(bank):
    for income in (2000, 3000, 2500.5):
        finances.save_profile(bank.ids["account_id"], income, 900, 600)
    assert len(bank.of_account(bank.deposits, bank.ids["account_id"])) == 1
    assert len(bank.of_account(bank.deposits, bank.ids["savings_account_id"])) == 1
    assert len(bank.of_account(bank.bills, bank.ids["account_id"])) == 1
    assert finances.get_profile(bank.ids["account_id"])["monthly_income"] == 2500.5


def test_other_bills_on_the_account_count_toward_fixed_bills(bank):
    nessie.create_bill(bank.ids["account_id"], "Netflix", "Netflix", 15.49, "2026-11-05", 5)
    finances.save_profile(bank.ids["account_id"], 1500, 700, 400)
    managed = [b for b in bank.bills.values() if b["nickname"] == finances.FIXED_BILLS_NICKNAME]
    assert managed[0]["payment_amount"] == 684.51
    assert finances.get_profile(bank.ids["account_id"])["fixed_bills"] == 700

    with pytest.raises(ValueError):
        finances.save_profile(bank.ids["account_id"], 1500, 10, 400)  # less than the Netflix bill alone


def test_savings_account_is_created_when_the_customer_has_none(bank):
    del bank.accounts[bank.ids["savings_account_id"]]
    ids = finances.nessie_ids()
    del ids["savings_account_id"]
    store.write_json(finances.NESSIE_IDS, ids)

    finances.save_profile(bank.ids["account_id"], 1500, 700, 300)
    new_id = finances.nessie_ids()["savings_account_id"]
    assert bank.accounts[new_id]["type"] == "Savings"
    assert finances.get_profile(bank.ids["account_id"])["savings"] == 300


# --- HTTP API ---------------------------------------------------------------------------------


def test_put_profile_returns_what_nessie_now_holds(bank):
    body = profile_body(bank, 4500, 1800, 1900.01)
    r = client.put("/profile", json=body)
    assert r.status_code == 200
    saved = r.json()
    assert numbers(saved) == (4500, 1800, 1900.01, 799.99)
    account = bank.accounts[bank.ids["account_id"]]
    assert saved["account"] == {"id": account["_id"], "nickname": "Main", "last4": account["account_number"][-4:]}
    assert client.get("/profile").json() == saved
    assert store.load_state()["account_id"] == bank.ids["account_id"]


@pytest.mark.parametrize("change", [
    {"discretionary": 500},  # 1500 != 700 + 400 + 500
    {"monthly_income": 0, "fixed_bills": 0, "savings": 0, "discretionary": 0},
    {"savings": -100, "discretionary": 500},
    {"account_id": ""},
])
def test_put_profile_rejects_invalid_splits(bank, change):
    r = client.put("/profile", json={**profile_body(bank, 1500, 700, 400), **change})
    assert r.status_code == 422
    assert numbers(finances.get_profile(bank.ids["account_id"])) == (1500, 700, 400, 400)  # nothing written


def test_put_profile_accepts_float_drift(bank):
    r = client.put("/profile", json=profile_body(bank, 0.3, 0.1, 0.2, 0))
    assert r.status_code == 200 and r.json()["discretionary"] == 0


def test_put_profile_only_accepts_the_customers_checking_accounts(bank):
    for account_id in ("not-an-account", bank.ids["savings_account_id"]):
        r = client.put("/profile", json={**profile_body(bank, 1500, 700, 400), "account_id": account_id})
        assert r.status_code == 404


def test_put_profile_conflict_when_existing_bills_exceed_fixed_bills(bank):
    nessie.create_bill(bank.ids["account_id"], "Gym", "Gym", 50, "2026-11-05", 5)
    r = client.put("/profile", json=profile_body(bank, 1500, 20, 400))
    assert r.status_code == 409


def test_accounts_lists_checking_accounts_without_balances(bank):
    [account] = client.get("/accounts").json()
    assert account["id"] == bank.ids["account_id"] and len(account["last4"]) == 4
    assert set(account) == {"id", "nickname", "last4"}


def test_preview_of_an_unconfigured_account_has_only_the_customers_savings_goal(bank):
    # Income and bills belong to a checking account; the savings goal belongs to the customer.
    other = nessie.create_account(bank.ids["customer_id"], "Checking", "Second", 250)
    r = client.get("/profile", params={"account_id": other["_id"]})
    assert numbers(r.json()) == (0, 0, 400, 0)


# --- The saved profile drives the score and the overlay ----------------------------------------


def test_saved_profile_drives_the_score_and_overlay_snapshot(bank):
    client.put("/profile", json=profile_body(bank, 3000, 900, 1500))  # discretionary 600
    e = client.post("/evaluate", json={"title": "Headphones", "price": 180}).json()

    snap = e["snapshot"]
    assert (snap["monthly_income"], snap["monthly_bills"], snap["savings"], snap["budget"]) == (3000, 900, 1500, 600)
    assert e["monthly_bills"] == 900 and e["budget_left_after"] == 600 - 150 - 180
    expected = score.compute_components(balance=1400, monthly_bills=900, budget=600, spent=150, buffer_target=300,
                                        price=180)
    assert e["score_after"] == expected.total
    assert "bills_14d" not in e


def test_linking_another_checking_account_moves_the_score_to_it(bank):
    other = nessie.create_account(bank.ids["customer_id"], "Checking", "Second", 2000)
    r = client.put("/profile", json={**profile_body(bank, 2000, 500, 500), "account_id": other["_id"]})
    assert r.json()["account"]["nickname"] == "Second"

    snap = client.post("/evaluate", json={"title": "Headphones", "price": 180}).json()["snapshot"]
    assert (snap["balance"], snap["spent_this_month"], snap["budget"], snap["transactions"]) == (2000, 0, 1000, [])
    client.post("/purchase", json={"title": "Headphones", "price": 180})
    assert [p["payer_id"] for p in bank.purchases.values() if p["description"].startswith("SIMULATED")] == [other["_id"]]


def test_settings_no_longer_carry_a_budget(bank):
    r = client.put("/settings", json={"buffer_target": 300, "mode": "strict", "floor": 70})
    assert r.json() == {"buffer_target": 300, "mode": "strict", "floor": 70}
    e = client.post("/evaluate", json={"title": "Headphones", "price": 180}).json()
    assert (e["score_after"], e["action"], e["floor"]) == (62, "block", 70)
