"""Switching which Nessie customer the server reads (a developer/demo control in the popup).

The current customer is whoever data/nessie_ids.json names. Each customer's money lives in
Nessie; their linked account, intensity and decision log live in state.json under their ID.
"""

import finances
import nessie
import store

LIST_LIMIT = 50


def _name(customer: dict) -> str:
    return f"{customer.get('first_name', '')} {customer.get('last_name', '')}".strip() or customer["_id"]


def list_customers() -> dict:
    """Customers the API key can see (newest last, capped), and which one is current."""
    customers = nessie._get("/customers")[-LIST_LIMIT:]
    return {"current": finances.current_customer_id(),
            "customers": [{"id": c["_id"], "name": _name(c)} for c in customers]}


def select_customer(customer_id: str) -> dict:
    """Point the server at another customer. Raises LookupError if they have no checking account."""
    customer = nessie._get(f"/customers/{customer_id}")
    accounts = nessie.get_accounts(customer_id)
    checking = next((a for a in accounts if a.get("type") == "Checking"), None)
    if checking is None:
        raise LookupError(f"{_name(customer)} has no checking account. Seed one with scripts/seed_nessie.py.")
    savings = next((a for a in accounts if a.get("type") == "Savings"), None)
    ids = {
        "customer_id": customer_id,
        "account_id": checking["_id"],
        # Merchants aren't tied to a customer, so the demo merchants (and Amazon.com's ID) carry over.
        "merchant_id": finances.nessie_ids().get("merchant_id"),
        "last_name": customer.get("last_name", ""),
    }
    if savings:
        ids["savings_account_id"] = savings["_id"]
    store.write_json(finances.NESSIE_IDS, ids)
    return {"id": customer_id, "name": _name(customer)}
