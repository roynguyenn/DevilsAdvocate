"""The one place that reads the user's finances, and records simulated purchases.

Everything comes from the Nessie demo customer (see scripts/seed_nessie.py): balance, bills,
the income/savings profile (finances.py) and the purchase ledger, with each purchase's
merchant mapped to a ledger category.

Simulated purchases ("Buy anyway" in the overlay) never reach Amazon; they're created on the
Nessie account and tagged SIMULATED so reset_demo can hide them again.
"""

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime

import finances
import nessie
import store

LEDGER_SIZE = 10
SIM_MERCHANT = "Amazon.com (simulated)"
SIM_TAG = "SIMULATED"
SEED_TAG = "SEED"
# Must match TransactionCategory in extension/src/store.ts.
CATEGORIES = {"shopping", "transport", "coffee", "groceries", "dining", "subscriptions"}

# Merchants never change once created, so one lookup per merchant per process is enough.
_merchants: dict[str, dict] = {}


def _now_ms() -> int:
    return int(time.time() * 1000)


def purchase_description(tag: str, title: str, price: float, ts: int) -> str:
    return f"{tag} | {title} | {price:.2f} | {ts}"


def _merchant(merchant_id: str | None) -> dict:
    if not merchant_id:
        return {}
    if merchant_id not in _merchants:
        try:
            _merchants[merchant_id] = nessie.get_merchant(merchant_id)
        except nessie.NessieError:
            return {}
    return _merchants[merchant_id]


def parse_nessie_purchase(p: dict, merchant: dict | None = None) -> dict:
    """Map a Nessie purchase to a ledger row, recovering the exact price and time from our description."""
    merchant = merchant or {}
    amount, ts, tag = float(p.get("amount", 0)), None, None
    parts = (p.get("description") or "").rsplit(" | ", 2)
    if len(parts) == 3:
        try:
            amount, ts, tag = float(parts[1]), int(parts[2]), parts[0].split(" | ", 1)[0]
        except ValueError:
            pass
    if ts is None:
        ts = int(datetime.fromisoformat(p["purchase_date"]).timestamp() * 1000)
    simulated = tag == SIM_TAG
    category = merchant.get("category")
    return {
        "id": p["_id"],
        "merchant": SIM_MERCHANT if simulated else merchant.get("name", "Unknown merchant"),
        "category": category if category in CATEGORIES else "shopping",
        "amount": amount,
        "timestamp": ts,
        "simulated": simulated,
    }


def _this_month(ts: int) -> bool:
    d, today = datetime.fromtimestamp(ts / 1000), date.today()
    return (d.year, d.month) == (today.year, today.month)


def assemble(account: dict, bills: list, deposits: list, savings_deposits: list, purchases: list[dict]) -> dict:
    """Pure: combine raw Nessie records (purchases already parsed) into the snapshot."""
    profile = finances.profile_from(deposits, bills, savings_deposits)
    spent = sum(t["amount"] for t in purchases if _this_month(t["timestamp"]))
    return {
        # Nessie never changes the balance on a purchase. Seeded spending is already reflected in the
        # starting balance; simulated purchases aren't, so we deduct them here.
        "balance": round(account["balance"] - sum(t["amount"] for t in purchases if t["simulated"]), 2),
        "monthly_bills": profile["fixed_bills"],
        "monthly_income": profile["monthly_income"],
        "savings": profile["savings"],
        "budget": profile["discretionary"],
        "spent_this_month": round(spent, 2),
        "transactions": sorted(purchases, key=lambda t: t["timestamp"], reverse=True)[:LEDGER_SIZE],
    }


def describe_source(account_id: str | None = None) -> dict:
    """Which Nessie customer and account the server reads, for the overlay's dev line. Local files only."""
    ids = finances.nessie_ids()
    return {"type": "nessie", "customer_id": ids["customer_id"], "account_id": account_id or finances.linked_account_id(),
            "customer_name": f"Test {ids.get('last_name', '')}".strip()}


def get_financial_snapshot(account_id: str | None = None) -> dict:
    """Returns {balance, monthly_bills, monthly_income, savings, budget, spent_this_month, transactions, source}.

    Money is dollars. `budget` is the discretionary budget (income - fixed bills - savings).
    """
    account_id = account_id or finances.linked_account_id()
    sav_id = finances.savings_account_id()
    # Nessie round trips dominate the intercept's latency, so the independent reads run in parallel.
    with ThreadPoolExecutor(max_workers=5) as pool:
        account = pool.submit(nessie.get_account, account_id)
        bills = pool.submit(nessie.get_bills, account_id)
        deposits = pool.submit(nessie.get_deposits, account_id)
        savings_deposits = pool.submit(nessie.get_deposits, sav_id) if sav_id else None
        raw = pool.submit(nessie.get_purchases, account_id)
        # Nessie can't delete purchases (403), so reset_demo hides old ones by ID instead.
        ignored = set(store.load_state().get("ignored_nessie_purchases", []))
        visible = [p for p in raw.result() if p["_id"] not in ignored]
        merchant_ids = list({p.get("merchant_id") for p in visible})
        merchants = dict(zip(merchant_ids, pool.map(_merchant, merchant_ids)))
        purchases = [parse_nessie_purchase(p, merchants.get(p.get("merchant_id"))) for p in visible]
        snap = assemble(account.result(), bills.result(), deposits.result(),
                        savings_deposits.result() if savings_deposits else [], purchases)
    return {**snap, "source": describe_source(account_id)}


def record_simulated_purchase(title: str, price: float, account_id: str | None = None) -> None:
    """Log a 'Buy anyway' as a fake purchase on the Nessie account. Nothing is ordered anywhere."""
    account_id = account_id or finances.linked_account_id()
    nessie.create_purchase(account_id, finances.nessie_ids()["merchant_id"], price, date.today().isoformat(),
                           purchase_description(SIM_TAG, title, price, _now_ms()))
