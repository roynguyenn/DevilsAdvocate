"""The one place that reads the user's finances, and records simulated purchases.

Two sources behind one interface: seeded JSON (default, works offline) or Nessie.
Either way the score engine and the overlay see the same shape.

Simulated purchases ("Buy anyway" in the overlay) never reach Amazon. In seed mode they go to
data/purchases.json; in Nessie mode they're created on the demo account.
"""

import json
import time
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

import money_plan
import nessie
import store

DATA_DIR = Path(__file__).parent / "data"
LOCAL_PURCHASES = DATA_DIR / "purchases.json"
BILLS_WINDOW_DAYS = 14
LEDGER_SIZE = 10
SIM_MERCHANT = "Amazon.com (simulated)"
SIM_TAG = "SIMULATED"
DAY_MS = 86_400_000


def _now_ms() -> int:
    return int(time.time() * 1000)


def _seed() -> dict:
    return json.loads((DATA_DIR / "seed_data.json").read_text())


def _seed_transactions(seed: dict) -> list[dict]:
    now = _now_ms()
    return [
        {"id": f"seed-{i}", "merchant": t["merchant"], "category": t["category"], "amount": t["amount"],
         "timestamp": now - t["days_ago"] * DAY_MS, "simulated": False}
        for i, t in enumerate(seed["transactions"])
    ]


def bills_due_within(bills: list, today: date, days: int = BILLS_WINDOW_DAYS) -> float:
    """Sum of pending/recurring bills whose next payment falls in [today, today + days]."""
    cutoff = today + timedelta(days=days)
    total = 0.0
    for b in bills:
        due = b.get("upcoming_payment_date") or b.get("payment_date")
        if b.get("status") in ("pending", "recurring") and due and today <= date.fromisoformat(due) <= cutoff:
            total += b.get("payment_amount", 0)
    return total


def _description(title: str, price: float, ts: int) -> str:
    return f"{SIM_TAG} | {title} | {price:.2f} | {ts}"


def parse_nessie_purchase(p: dict) -> dict:
    """Map a Nessie purchase to a ledger row, recovering the exact price and time from our description."""
    amount, ts = float(p.get("amount", 0)), None
    parts = (p.get("description") or "").rsplit(" | ", 2)
    if len(parts) == 3 and parts[0].startswith(SIM_TAG):
        try:
            amount, ts = float(parts[1]), int(parts[2])
        except ValueError:
            pass
    if ts is None:
        ts = int(datetime.fromisoformat(p["purchase_date"]).timestamp() * 1000)
    return {"id": p["_id"], "merchant": SIM_MERCHANT, "category": "shopping", "amount": amount,
            "timestamp": ts, "simulated": True}


def _local_purchases() -> list[dict]:
    return json.loads(LOCAL_PURCHASES.read_text()) if LOCAL_PURCHASES.exists() else []


_nessie_ids = money_plan.nessie_ids
_source = money_plan.data_source


def _nessie_purchases(account_id: str) -> list[dict]:
    # Nessie can't delete purchases (403), so reset_demo hides old ones by ID instead.
    ignored = set(store.load_state().get("ignored_nessie_purchases", []))
    return [parse_nessie_purchase(p) for p in nessie.get_purchases(account_id) if p["_id"] not in ignored]


def _this_month(ts: int) -> bool:
    d, today = datetime.fromtimestamp(ts / 1000), date.today()
    return (d.year, d.month) == (today.year, today.month)


def _assemble(balance: float, bills_14d: float, seeded: list[dict], purchases: list[dict]) -> dict:
    # Seeded rows stand for "already spent this month"; simulated ones count if they fall in this month.
    spent = sum(t["amount"] for t in seeded) + sum(t["amount"] for t in purchases if _this_month(t["timestamp"]))
    ledger = sorted(seeded + purchases, key=lambda t: t["timestamp"], reverse=True)[:LEDGER_SIZE]
    return {
        # Neither source deducts purchases from the balance (Nessie doesn't), so we do it here.
        "balance": round(balance - sum(t["amount"] for t in purchases), 2),
        "bills_14d": bills_14d,
        "spent_this_month": round(spent, 2),
        "transactions": ledger,
    }


def describe_source() -> dict:
    """Which data the server is reading, for dev display. Reads local files only (no Nessie call)."""
    if _source() != "nessie":
        return {"type": "seed"}
    ids = _nessie_ids()
    return {"type": "nessie", "customer_id": ids["customer_id"], "account_id": ids["account_id"],
            "customer_name": f"Test {ids.get('last_name', '')}".strip()}


def _with_plan(snap: dict, plan: dict, seed: dict) -> dict:
    # Until the user saves a plan in the popup, the seed defaults stand in (they keep the worked example).
    if not plan["saved"]:
        d = seed["plan_defaults"]
        plan = money_plan.make_plan(d["monthly_income"], d["fixed_bills"], d["savings"], saved=False)
    return {**snap, "monthly_income": plan["monthly_income"], "monthly_bills": plan["fixed_bills"],
            "savings": plan["savings"], "budget": plan["discretionary"], "plan_saved": plan["saved"]}


def get_financial_snapshot() -> dict:
    """Returns {balance, bills_14d, spent_this_month, transactions, monthly_income, monthly_bills, savings,
    budget, plan_saved, source}. Money is dollars; budget is the discretionary part of the monthly plan."""
    seed = _seed()
    seeded = _seed_transactions(seed)
    if _source() == "nessie":
        account_id = _nessie_ids()["account_id"]
        balance = nessie.get_account(account_id)["balance"]
        all_bills = nessie.get_bills(account_id)
        real_bills = [b for b in all_bills if not money_plan.is_profile_bill(b)]
        snap = _assemble(balance, bills_due_within(real_bills, date.today()), seeded, _nessie_purchases(account_id))
        plan = money_plan.plan_from_records(all_bills, nessie.get_deposits(account_id))
    else:
        snap = _assemble(seed["balance"], seed["bills_14d"], seeded, _local_purchases())
        plan = money_plan.read_plan(money_plan.SEED_ACCOUNT["id"])
    return {**_with_plan(snap, plan, seed), "source": describe_source()}


def record_simulated_purchase(title: str, price: float) -> None:
    """Log a 'Buy anyway' as a fake purchase. Nothing is ordered anywhere."""
    ts = _now_ms()
    if _source() == "nessie":
        ids = _nessie_ids()
        nessie.create_purchase(ids["account_id"], ids["merchant_id"], price, date.today().isoformat(),
                               _description(title, price, ts))
        return
    rows = _local_purchases()
    rows.append({"id": f"sim-{uuid.uuid4().hex[:8]}", "merchant": SIM_MERCHANT, "category": "shopping",
                 "amount": round(price, 2), "timestamp": ts, "simulated": True, "title": title})
    store.write_json(LOCAL_PURCHASES, rows)
