"""End-to-end against the real Nessie sandbox:  NESSIE_LIVE=1 python -m pytest tests/test_nessie_live.py

Skipped by default: it creates a throwaway fake customer in the shared sandbox on every run
(IDs go to a temp file, not data/nessie_ids.json).
"""

import os
from pathlib import Path

import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient

import app as server
import demo_data
import finances
import nessie

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(os.getenv("NESSIE_LIVE") != "1", reason="set NESSIE_LIVE=1 to hit the real sandbox"),
]

client = TestClient(server.app)


@pytest.fixture
def live_ids():
    load_dotenv(Path(__file__).parent.parent / ".env")
    return demo_data.seed_customer(demo_data.load_seed(), "StudentLiveTest")


def test_live_profile_round_trip_and_score(live_ids):
    assert client.post("/evaluate", json={"title": "Headphones", "price": 180}).json()["score_after"] == 62

    body = {"account_id": live_ids["account_id"], "monthly_income": 4500.55, "fixed_bills": 1800.25,
            "savings": 1200.10, "discretionary": 1500.20}
    saved = client.put("/profile", json=body).json()
    assert {k: saved[k] for k in body if k != "account_id"} == {k: v for k, v in body.items() if k != "account_id"}

    # Straight from Nessie, not through our parsing.
    deposits = nessie.get_deposits(live_ids["account_id"])
    assert [d["description"] for d in deposits] == ["INCOME | 4500.55"]
    bills = nessie.get_bills(live_ids["account_id"])
    assert [(b["nickname"], b["payment_amount"]) for b in bills] == [(finances.FIXED_BILLS_NICKNAME, 1800.25)]
    assert [d["description"] for d in nessie.get_deposits(live_ids["savings_account_id"])] == ["SAVINGS | 1200.10"]

    snap = client.post("/evaluate", json={"title": "Headphones", "price": 180}).json()["snapshot"]
    assert (snap["monthly_income"], snap["monthly_bills"], snap["budget"], snap["spent_this_month"]) == (
        4500.55, 1800.25, 1500.20, 150)

    client.post("/purchase", json={"title": "Headphones", "price": 179.99})
    snap = client.post("/evaluate", json={"title": "Headphones", "price": 1}).json()["snapshot"]
    assert snap["transactions"][0]["amount"] == 179.99 and snap["spent_this_month"] == 329.99
