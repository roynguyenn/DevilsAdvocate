"""The ledger and simulated purchases, read from and written to (fake) Nessie."""

import time

from fastapi.testclient import TestClient

import app as server
import demo_data
import finances
import nessie
import snapshot
import store

client = TestClient(server.app)
HEADPHONES = {"title": "Headphones", "price": 180}


def test_seed_ledger_sums_to_worked_example(bank):
    snap = snapshot.get_financial_snapshot()
    assert snap["spent_this_month"] == 150
    assert snap["balance"] == 1400
    assert snap["monthly_bills"] == 700 and snap["budget"] == 400
    assert len(snap["transactions"]) == 7
    assert not any(t["simulated"] for t in snap["transactions"])


def test_ledger_categories_come_from_nessie_merchants(bank):
    seed = demo_data.load_seed()
    rows = snapshot.get_financial_snapshot()["transactions"]
    assert {(t["merchant"], t["category"]) for t in rows} == set(seed["merchants"].items())
    assert set(seed["merchants"].values()) == snapshot.CATEGORIES  # every ledger icon is exercised
    # Nessie truncated the stored amounts; the exact cents come back from the description.
    assert sorted(t["amount"] for t in rows) == sorted(p["amount"] for p in seed["purchases"])
    assert [t["timestamp"] for t in rows] == sorted((t["timestamp"] for t in rows), reverse=True)


def test_simulated_purchase_updates_ledger_spent_and_next_score(bank):
    first = client.post("/evaluate?debug=true", json=HEADPHONES).json()["debug"]
    assert (first["score_before"], first["score_after"]) == (89, 62)

    r = client.post("/purchase", json=HEADPHONES).json()
    top = r["snapshot"]["transactions"][0]
    assert top["simulated"] is True and top["amount"] == 180 and top["merchant"] == snapshot.SIM_MERCHANT
    assert r["snapshot"]["spent_this_month"] == 330
    assert r["snapshot"]["balance"] == 1220

    again = client.post("/evaluate?debug=true", json=HEADPHONES).json()["debug"]
    assert again["score_before"] == first["score_after"]  # the logged purchase is now part of "before"
    assert again["score_after"] < first["score_after"]


def test_evaluate_never_sends_the_score_to_the_extension(bank):
    body = client.post("/evaluate", json=HEADPHONES).json()
    assert set(body) == {"action", "message", "snapshot"}
    assert "score" not in body["message"].lower()


def test_simulated_purchase_is_written_to_nessie_with_exact_price(bank):
    client.post("/purchase", json={"title": "Sony | WH-1000XM5", "price": 179.99})
    [stored] = [p for p in bank.purchases.values() if p["description"].startswith("SIMULATED")]
    assert stored["payer_id"] == bank.ids["account_id"] and stored["merchant_id"] == bank.ids["merchant_id"]
    assert stored["amount"] == 180  # what Nessie keeps
    assert snapshot.get_financial_snapshot()["transactions"][0]["amount"] == 179.99  # what we show


def test_nessie_purchase_keeps_exact_price_from_description():
    row = snapshot.parse_nessie_purchase(
        {"_id": "abc", "amount": 180, "purchase_date": "2026-10-24",
         "description": "SIMULATED | Sony | WH-1000XM5 | 179.99 | 1793000000000"},
        {"name": "Amazon.com", "category": "shopping"},
    )
    assert row["amount"] == 179.99 and row["timestamp"] == 1793000000000 and row["simulated"] is True


def test_foreign_purchase_falls_back_to_nessie_fields():
    # A purchase someone made by hand in the sandbox: no tag, an unknown category.
    row = snapshot.parse_nessie_purchase(
        {"_id": "x", "amount": 12, "purchase_date": "2026-10-20", "description": "lunch"},
        {"name": "Corner Deli", "category": "food"},
    )
    assert (row["amount"], row["merchant"], row["category"], row["simulated"]) == (12.0, "Corner Deli", "shopping", False)


def test_last_months_purchases_are_listed_but_not_spent_this_month(bank):
    old_ts = int(time.time() * 1000) - 45 * demo_data.DAY_MS
    nessie.create_purchase(bank.ids["account_id"], bank.ids["merchant_id"], 99.5, "2026-01-01",
                           snapshot.purchase_description(snapshot.SEED_TAG, "Amazon.com", 99.5, old_ts))
    snap = snapshot.get_financial_snapshot()
    assert snap["spent_this_month"] == 150
    assert any(t["amount"] == 99.5 for t in snap["transactions"])


def test_reset_hides_simulated_purchases_and_restores_the_seed_profile(bank):
    client.post("/purchase", json=HEADPHONES)
    finances.save_profile(bank.ids["account_id"], 5000, 2000, 1000)
    store.save_state({**store.load_state(), "blocks_this_week": 2})

    assert demo_data.reset_demo() == 1
    snap = snapshot.get_financial_snapshot()
    assert snap["spent_this_month"] == 150 and len(snap["transactions"]) == 7  # seeded rows survive
    assert finances.get_profile(bank.ids["account_id"])["monthly_income"] == 1500
    assert store.load_state()["blocks_this_week"] == 0
    assert client.post("/evaluate?debug=true", json=HEADPHONES).json()["debug"]["score_after"] == 62


def test_source_names_the_linked_nessie_customer(bank):
    src = client.get("/health").json()["source"]
    assert src["type"] == "nessie" and src["customer_id"] == bank.ids["customer_id"]
    assert src["account_id"] == bank.ids["account_id"]
    assert client.post("/evaluate", json=HEADPHONES).json()["snapshot"]["source"] == src


def test_purchase_rejects_non_positive_price():
    assert client.post("/purchase", json={"title": "x", "price": 0}).status_code == 422


def test_bank_outage_is_a_502_without_the_key(bank):
    bank.down = True
    r = client.post("/evaluate", json=HEADPHONES)
    assert r.status_code == 502
    assert "test-key" not in r.text
