"""Switching customers, per-customer config, and the decision log that feeds Claude next time."""

from fastapi.testclient import TestClient

import app as server
import decisions
import demo_data
import finances
import llm
import store

client = TestClient(server.app)
HEADPHONES = {"title": "Sony WH-1000XM5 Wireless Headphones", "price": 180}


def second_customer(bank) -> dict:
    """Seed another full customer, then point the server back at the first one."""
    first = dict(bank.ids)
    other = demo_data.seed_customer(demo_data.load_seed(), "StudentTwo")
    store.write_json(finances.NESSIE_IDS, first)
    return other


def test_customers_lists_everyone_and_marks_the_current_one(bank):
    other = second_customer(bank)
    body = client.get("/customers").json()
    assert body["current"] == bank.ids["customer_id"]
    names = {c["id"]: c["name"] for c in body["customers"]}
    assert names[bank.ids["customer_id"]] == "Test StudentTest" and names[other["customer_id"]] == "Test StudentTwo"


def test_switching_customer_moves_the_server_and_returns_their_profile(bank):
    other = second_customer(bank)
    r = client.put("/customer", json={"customer_id": other["customer_id"]}).json()
    assert r["customer"] == {"id": other["customer_id"], "name": "Test StudentTwo"}
    assert r["profile"]["account"]["id"] == other["account_id"]
    assert finances.current_customer_id() == other["customer_id"]
    assert client.get("/health").json()["source"]["customer_id"] == other["customer_id"]


def test_config_is_saved_per_customer(bank):
    other = second_customer(bank)
    body = {"account_id": bank.ids["account_id"], "monthly_income": 1500, "fixed_bills": 700, "savings": 400,
            "discretionary": 400, "intensity": "harsh"}
    assert client.put("/profile", json=body).json()["intensity"] == "harsh"

    client.put("/customer", json={"customer_id": other["customer_id"]})
    assert client.get("/profile").json()["intensity"] == "medium"  # the other customer's own default

    client.put("/customer", json={"customer_id": bank.ids["customer_id"]})
    back = client.get("/profile").json()
    assert back["intensity"] == "harsh" and back["account"]["id"] == bank.ids["account_id"]


def test_customer_without_checking_account_is_refused(bank):
    lonely = bank.request("POST", "/customers", {"first_name": "No", "last_name": "Accounts", "address": {}})
    r = client.put("/customer", json={"customer_id": lonely["objectCreated"]["_id"]})
    assert r.status_code == 409 and "no checking account" in r.json()["detail"]


def test_similar_titles_match_and_different_ones_dont():
    assert decisions.similar("Sony WH-1000XM5 Wireless Headphones", "Sony WH-1000XM5 Headphones, Black")
    assert not decisions.similar("Sony WH-1000XM5 Wireless Headphones", "Instant Pot Duo 7-in-1")


def test_decision_is_logged_per_customer_with_outcome_and_reason(bank):
    history = [{"role": "assistant", "content": "This order is on hold for now."},
               {"role": "user", "content": "Fine, rent comes first this month."}]
    entry = client.post("/decision", json={"purchase": HEADPHONES, "history": history, "outcome": "walked_away"}).json()
    # No API key in tests, so the template summary is used.
    assert entry["summary"].startswith("Walked away from Sony WH-1000XM5")
    assert "rent comes first" in entry["summary"]
    assert client.get("/decisions").json() == [entry]
    assert store.load_customer(bank.ids["customer_id"])["decisions"] == [entry]


def test_past_decisions_reach_claude_for_a_similar_item_only(bank):
    client.post("/decision", json={"purchase": HEADPHONES, "history": [], "outcome": "walked_away"})
    same = client.post("/evaluate?debug=true", json={"title": "Sony WH-1000XM5 Headphones", "price": 180}).json()
    other = client.post("/evaluate?debug=true", json={"title": "Instant Pot Duo", "price": 80}).json()
    assert same["debug"]["past_decisions"] and "Walked away" in same["debug"]["past_decisions"][0]
    assert "past_decisions" not in other["debug"]
    assert "past_decisions" in llm.public_facts(same["debug"])  # Claude sees them
    assert not {"score_before", "score_after"} & set(llm.public_facts(same["debug"]))  # Claude never sees the score


def test_memory_never_changes_the_verdict(bank):
    before = client.post("/evaluate?debug=true", json=HEADPHONES).json()["debug"]
    client.post("/decision", json={"purchase": HEADPHONES, "history": [], "outcome": "bought"})
    after = client.post("/evaluate?debug=true", json=HEADPHONES).json()["debug"]
    assert (after["score_after"], after["action"]) == (before["score_after"], before["action"])


def test_summary_falls_back_when_no_reason_was_given():
    assert llm.summary_template("Phone case", 20, "bought", []) == "Bought Phone case ($20.00). No reason given."
