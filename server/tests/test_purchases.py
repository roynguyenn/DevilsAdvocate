import pytest
from fastapi.testclient import TestClient

import app as server
import snapshot

client = TestClient(server.app)


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    # Keep tests off the real data/purchases.json and in seed mode, with no LLM calls.
    monkeypatch.setattr(snapshot, "LOCAL_PURCHASES", tmp_path / "purchases.json")
    monkeypatch.setenv("DATA_SOURCE", "seed")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)


def test_seed_ledger_sums_to_worked_example():
    snap = snapshot.get_financial_snapshot()
    assert snap["spent_this_month"] == 150
    assert snap["balance"] == 1400
    assert len(snap["transactions"]) == 6


def test_simulated_purchase_updates_ledger_spent_and_next_score():
    first = client.post("/evaluate", json={"title": "Headphones", "price": 180}).json()
    assert (first["score_before"], first["score_after"]) == (89, 62)

    r = client.post("/purchase", json={"title": "Headphones", "price": 180}).json()
    top = r["snapshot"]["transactions"][0]
    assert top["simulated"] is True and top["amount"] == 180
    assert r["snapshot"]["spent_this_month"] == 330

    again = client.post("/evaluate", json={"title": "Headphones", "price": 180}).json()
    assert again["score_before"] == first["score_after"]  # the logged purchase is now part of "before"
    assert again["score_after"] < first["score_after"]


def test_nessie_purchase_keeps_exact_price_from_description():
    row = snapshot.parse_nessie_purchase({
        "_id": "abc", "amount": 180, "purchase_date": "2026-10-24",
        "description": "SIMULATED | Sony | WH-1000XM5 | 179.99 | 1793000000000",
    })
    assert row["amount"] == 179.99 and row["timestamp"] == 1793000000000


def test_purchase_rejects_non_positive_price():
    assert client.post("/purchase", json={"title": "x", "price": 0}).status_code == 422
