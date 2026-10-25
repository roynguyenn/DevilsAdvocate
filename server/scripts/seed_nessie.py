"""Create a fake demo customer in the shared Nessie sandbox:  python scripts/seed_nessie.py

Fake data only. Saves the new IDs to data/nessie_ids.json so snapshot.py can find them.
Prints status codes and bodies, never URLs, because the URL carries the API key.
"""

import json
import os
import random
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")
BASE = os.getenv("NESSIE_BASE", "https://prod-api.nessieisreal.com")
KEY = {"key": os.environ["NESSIE_KEY"]}


def call(method: str, path: str, body: dict | None = None):
    r = httpx.request(method, f"{BASE}{path}", params=KEY, json=body, timeout=15)
    print(f"{method} {path} -> {r.status_code}")
    if r.status_code >= 400:
        print("  ", r.text[:300])
        return None
    return r.json()


def created_id(resp) -> str | None:
    # Nessie wraps created objects as {"code": 201, "objectCreated": {...}}.
    return (resp or {}).get("objectCreated", {}).get("_id")


# Everyone shares one sandbox, so make the name unique.
last_name = f"Student{random.randint(1000, 9999)}"
customer = call("POST", "/customers", {
    "first_name": "Test",
    "last_name": last_name,
    "address": {"street_number": "1", "street_name": "Main St", "city": "Berkeley", "state": "CA", "zip": "94704"},
})
customer_id = created_id(customer)
if not customer_id:
    # Fall back to finding it by name if the create response had no ID.
    matches = [c for c in call("GET", "/customers") or [] if c.get("last_name") == last_name]
    customer_id = matches[0]["_id"] if matches else None
if not customer_id:
    sys.exit("Could not create or find the customer.")

account_id = created_id(call("POST", f"/customers/{customer_id}/accounts", {
    "type": "Checking", "nickname": "Main", "rewards": 0, "balance": 1400,
}))
if not account_id:
    sys.exit("Could not create the account.")

call("POST", f"/accounts/{account_id}/deposits", {
    "medium": "balance", "transaction_date": "2026-10-16", "status": "completed", "amount": 900, "description": "Paycheck",
})
call("POST", f"/accounts/{account_id}/bills", {
    "status": "recurring", "payee": "Landlord", "nickname": "Rent",
    "payment_date": "2026-11-01", "recurring_date": 1, "payment_amount": 700,
})

# Simulated "Buy anyway" purchases are recorded against this merchant. Nessie wants category as a string.
merchant_id = created_id(call("POST", "/merchants", {
    "name": "Amazon (demo)", "category": "shopping",
    "address": {"street_number": "1", "street_name": "Demo St", "city": "Seattle", "state": "WA", "zip": "98109"},
    "geocode": {"lat": 47.6, "lng": -122.3},
}))

print("\nAccount now:", json.dumps(call("GET", f"/accounts/{account_id}"), indent=2))
print("Bills:", json.dumps(call("GET", f"/accounts/{account_id}/bills"), indent=2))

ids = {"customer_id": customer_id, "account_id": account_id, "merchant_id": merchant_id, "last_name": last_name}
(ROOT / "data" / "nessie_ids.json").write_text(json.dumps(ids, indent=2))
print("\nSaved", ids)
