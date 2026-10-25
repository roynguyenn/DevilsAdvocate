"""Create and reset the Nessie demo customer (fake data only).

Shared by scripts/seed_nessie.py, scripts/reset_demo.py and the tests, so the tests seed
exactly what the demo runs on.
"""

import json
import time
from datetime import datetime

import finances
import nessie
import snapshot
import store

SEED_DATA = finances.DATA_DIR / "seed_data.json"
ADDRESS = {"street_number": "1", "street_name": "Main St", "city": "Berkeley", "state": "CA", "zip": "94704"}
DAY_MS = 86_400_000


def load_seed() -> dict:
    return json.loads(SEED_DATA.read_text())


def _month_start_ms(now_ms: int) -> int:
    start = datetime.fromtimestamp(now_ms / 1000).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return int(start.timestamp() * 1000)


def seed_customer(seed: dict, last_name: str, now_ms: int | None = None) -> dict:
    """Create a customer, accounts, merchants, purchases and profile; save and return their IDs."""
    now_ms = now_ms or int(time.time() * 1000)
    customer_id = nessie.create_customer("Test", last_name, ADDRESS)["_id"]
    account_id = nessie.create_account(customer_id, "Checking", "Main", seed["checking_balance"])["_id"]
    savings_id = nessie.create_account(customer_id, "Savings", "Savings", 0)["_id"]
    merchant_ids = {name: nessie.create_merchant(name, category)["_id"] for name, category in seed["merchants"].items()}

    for p in seed["purchases"]:
        # Kept inside the current month so "spent this month" matches the seed even on the 1st.
        ts = max(now_ms - p["days_ago"] * DAY_MS, _month_start_ms(now_ms))
        day = datetime.fromtimestamp(ts / 1000).date().isoformat()
        nessie.create_purchase(account_id, merchant_ids[p["merchant"]], p["amount"], day,
                               snapshot.purchase_description(snapshot.SEED_TAG, p["merchant"], p["amount"], ts))

    ids = {
        "customer_id": customer_id,
        "account_id": account_id,
        "savings_account_id": savings_id,
        "merchant_id": merchant_ids["Amazon.com"],  # simulated "Buy anyway" purchases are logged here
        "last_name": last_name,
    }
    store.write_json(finances.NESSIE_IDS, ids)
    finances.save_profile(account_id, **seed["profile"])
    return ids


def reset_demo() -> int:
    """Restore default settings and the seed profile, and hide simulated purchases. Returns how many were hidden.

    Nessie can't delete purchases (403), so they're hidden by ID. Seeded spending stays visible.
    """
    hidden = [
        p["_id"]
        for account in finances.checking_accounts()
        for p in nessie.get_purchases(account["_id"])
        if (p.get("description") or "").startswith(f"{snapshot.SIM_TAG} | ")
    ]
    store.save_state({**json.loads(json.dumps(store.DEFAULT_STATE)), "ignored_nessie_purchases": hidden})
    store.save_commitments([])
    finances.save_profile(finances.nessie_ids()["account_id"], **load_seed()["profile"])
    return len(hidden)
