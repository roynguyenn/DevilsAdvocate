"""The one function everything else calls to get the user's finances.

Two sources behind one interface: seeded JSON (default, works offline) or Nessie.
Swapping the source never changes the shape the score engine sees.
"""

import json
import os
from datetime import date, timedelta
from pathlib import Path

import nessie

DATA_DIR = Path(__file__).parent / "data"
BILLS_WINDOW_DAYS = 14


def _from_seed() -> dict:
    return json.loads((DATA_DIR / "seed_snapshot.json").read_text())


def bills_due_within(bills: list, today: date, days: int = BILLS_WINDOW_DAYS) -> float:
    """Sum of pending/recurring bills whose next payment falls in [today, today + days]."""
    cutoff = today + timedelta(days=days)
    total = 0.0
    for b in bills:
        due = b.get("upcoming_payment_date") or b.get("payment_date")
        if b.get("status") in ("pending", "recurring") and due and today <= date.fromisoformat(due) <= cutoff:
            total += b.get("payment_amount", 0)
    return total


def _from_nessie() -> dict:
    account_id = json.loads((DATA_DIR / "nessie_ids.json").read_text())["account_id"]
    return {
        "balance": nessie.get_account(account_id)["balance"],
        "bills_14d": bills_due_within(nessie.get_bills(account_id), date.today()),
        # Nessie has a purchases endpoint, but our demo account has none yet, so spending stays seeded.
        "spent_this_month": _from_seed()["spent_this_month"],
    }


def get_financial_snapshot() -> dict:
    """Returns {balance, bills_14d, spent_this_month}. Money is dollars."""
    source = os.getenv("DATA_SOURCE", "seed")
    return _from_nessie() if source == "nessie" else _from_seed()
