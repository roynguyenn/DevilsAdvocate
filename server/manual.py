"""Finances-tab-only mode: when the student doesn't link a bank account.

Without a bank there's no balance and no transaction history, so everything comes from what they told us:
the popup's Finances tab (income, fixed bills, savings -> discretionary budget) and the purchases they
make through the extension itself ("Buy it / Buy anyway"). All of it lives in state.json under "manual".
The score switches to a budget-only formula (score.compute_budget_only).

Decision memory and intensity are kept under the profile key MANUAL_KEY, like a customer of their own.
"""

import time
import uuid
from datetime import date, datetime

import store

MANUAL_KEY = "manual"
SIM_MERCHANT = "Amazon.com (simulated)"
LEDGER_SIZE = 10


def bank_linked() -> bool:
    """Whether the student opted in to reading their bank (Nessie). Defaults to yes for older state files."""
    return store.load_state().get("bank_linked", True)


def set_bank_linked(linked: bool) -> None:
    state = store.load_state()
    state["bank_linked"] = linked
    store.save_state(state)


def _manual() -> dict:
    return store.load_state().get("manual", {"profile": None, "purchases": []})


def _save_manual(data: dict) -> None:
    state = store.load_state()
    state["manual"] = data
    store.save_state(state)


def plan(income: float, fixed: float, savings: float) -> dict:
    return {"monthly_income": round(income, 2), "fixed_bills": round(fixed, 2), "savings": round(savings, 2),
            "discretionary": round(max(income - fixed - savings, 0), 2)}


EMPTY = plan(0, 0, 0)


def get_profile() -> dict:
    return _manual()["profile"] or EMPTY


def save_profile(income: float, fixed: float, savings: float) -> dict:
    data = _manual()
    data["profile"] = plan(income, fixed, savings)
    _save_manual(data)
    return data["profile"]


def record_purchase(title: str, price: float, simulated: bool = True) -> None:
    """A purchase made through the extension: the only spending we know about without a bank."""
    data = _manual()
    data["purchases"] = (data["purchases"] + [{
        "id": f"manual-{uuid.uuid4().hex[:8]}",
        "merchant": SIM_MERCHANT if simulated else "Amazon.com",
        "category": "shopping",
        "amount": round(price, 2),
        "timestamp": int(time.time() * 1000),
        "simulated": simulated,
        "title": title,
    }])[-200:]
    _save_manual(data)


def _this_month(ts: int) -> bool:
    d, today = datetime.fromtimestamp(ts / 1000), date.today()
    return (d.year, d.month) == (today.year, today.month)


def snapshot() -> dict:
    """Same shape as snapshot.get_financial_snapshot(), with balance None (unknown without a bank)."""
    data, p = _manual(), get_profile()
    purchases = data["purchases"]
    return {
        "balance": None,
        "monthly_bills": p["fixed_bills"],
        "monthly_income": p["monthly_income"],
        "savings": p["savings"],
        "budget": p["discretionary"],
        "spent_this_month": round(sum(t["amount"] for t in purchases if _this_month(t["timestamp"])), 2),
        "transactions": sorted(purchases, key=lambda t: t["timestamp"], reverse=True)[:LEDGER_SIZE],
        "source": {"type": "manual"},
    }
