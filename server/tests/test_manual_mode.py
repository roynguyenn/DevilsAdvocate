"""Finances-tab-only mode: the student doesn't link a bank, so everything runs on what the popup told us."""

from fastapi.testclient import TestClient

import app as server
import llm
import manual
import score
import store

client = TestClient(server.app)
PLAN = {"account_id": None, "monthly_income": 1500, "fixed_bills": 700, "savings": 400, "discretionary": 400}
HEADPHONES = {"title": "Sony WH-1000XM5 Headphones", "price": 180}


def go_manual(**extra):
    r = client.put("/profile", json={**PLAN, **extra})
    assert r.status_code == 200
    return r.json()


def test_budget_only_formula_worked_example():
    assert score.compute_budget_only(400, 150).total == 74
    assert score.compute_budget_only(400, 150, 180).total == 29


def test_saving_without_an_account_switches_to_the_finances_tab():
    saved = go_manual(intensity="light")
    assert saved["account"] is None and saved["discretionary"] == 400 and saved["intensity"] == "light"
    assert manual.bank_linked() is False
    assert client.get("/profile").json() == saved
    assert client.get("/health").json()["source"] == {"type": "manual"}


def test_scoring_uses_the_budget_only_formula_and_never_needs_nessie():
    # No `bank` fixture: any Nessie call would fail, so this also proves the mode never touches the bank.
    go_manual()
    body = client.post("/evaluate?debug=true", json=HEADPHONES).json()
    facts = body["debug"]
    assert facts["formula"] == "budget_only"
    assert (body["score_before"], body["score_after"]) == (100, 55)  # nothing spent yet this month
    assert "balance_after" not in facts and "balance_after" not in llm.public_facts(facts)
    snap = body["snapshot"]
    assert (snap["monthly_income"], snap["monthly_bills"], snap["savings"], snap["budget"]) == (1500, 700, 400, 400)
    assert snap["balance"] is None and snap["source"] == {"type": "manual"}


def test_purchases_through_the_extension_are_the_spending_history():
    go_manual()
    first = client.post("/evaluate", json=HEADPHONES).json()
    r = client.post("/purchase", json={**HEADPHONES, "simulated": True}).json()["snapshot"]
    assert r["spent_this_month"] == 180 and r["transactions"][0]["amount"] == 180
    again = client.post("/evaluate", json=HEADPHONES).json()
    assert again["score_before"] < first["score_before"]  # the purchase now counts against the budget
    facts = client.post("/evaluate?debug=true", json=HEADPHONES).json()["debug"]
    assert facts["recent_purchases"][0]["amount"] == 180  # Claude can link to it


def test_decisions_and_intensity_are_kept_under_the_manual_profile():
    go_manual(intensity="harsh")
    client.post("/decision", json={"purchase": HEADPHONES, "history": [], "outcome": "left_checkout"})
    assert len(store.load_customer(manual.MANUAL_KEY)["decisions"]) == 1
    assert server._intensity() == "harsh"
    assert client.get("/decisions").json()[0]["outcome"] == "left_checkout"


def test_linking_a_bank_or_picking_a_customer_switches_back(bank):
    go_manual()
    body = {**PLAN, "account_id": bank.ids["account_id"]}
    assert client.put("/profile", json=body).json()["account"]["id"] == bank.ids["account_id"]
    assert manual.bank_linked() is True
    assert client.post("/evaluate?debug=true", json=HEADPHONES).json()["debug"]["formula"] == "full"

    go_manual()
    client.put("/customer", json={"customer_id": bank.ids["customer_id"]})
    assert manual.bank_linked() is True
