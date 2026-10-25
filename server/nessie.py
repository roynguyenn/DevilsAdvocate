"""Thin client for Capital One's Nessie mock bank. The key never leaves the server.

Verified quirks: deposit/purchase amounts and account balances are stored as whole numbers
(bill payment_amount keeps cents), creates return {"objectCreated": {...}}, updates return 202,
and DELETE /purchases/{id} is forbidden (403).
"""

import os

import httpx


def _base() -> str:
    # A trailing slash in .env would turn every path into "//customers", which Nessie rejects with 403.
    return os.getenv("NESSIE_BASE", "https://prod-api.nessieisreal.com").rstrip("/")


class NessieError(Exception):
    pass


# One pooled client: reusing TLS connections roughly halves the intercept's Nessie latency.
_client = httpx.Client(timeout=10)


def _request(method: str, path: str, body: dict | None = None) -> list | dict:
    try:
        r = _client.request(method, f"{_base()}{path}", params={"key": os.environ["NESSIE_KEY"]}, json=body)
        r.raise_for_status()
    except httpx.HTTPError as e:
        # httpx's message includes the full URL, which carries the key; don't let it reach logs.
        raise NessieError(f"{method} {path} failed: {type(e).__name__}") from None
    # Some Nessie DELETEs answer 200 with an empty body.
    return r.json() if r.content.strip() else {}


def _get(path: str) -> list | dict:
    return _request("GET", path)


def _create(path: str, body: dict) -> dict:
    return _request("POST", path, body)["objectCreated"]


# --- Reads ----------------------------------------------------------------------------------


def get_account(account_id: str) -> dict:
    return _get(f"/accounts/{account_id}")


def get_accounts(customer_id: str) -> list:
    return _get(f"/customers/{customer_id}/accounts")


def get_bills(account_id: str) -> list:
    return _get(f"/accounts/{account_id}/bills")


def get_deposits(account_id: str) -> list:
    return _get(f"/accounts/{account_id}/deposits")


def get_purchases(account_id: str) -> list:
    return _get(f"/accounts/{account_id}/purchases")


def get_merchant(merchant_id: str) -> dict:
    return _get(f"/merchants/{merchant_id}")


# --- Writes ---------------------------------------------------------------------------------


def create_customer(first_name: str, last_name: str, address: dict) -> dict:
    return _create("/customers", {"first_name": first_name, "last_name": last_name, "address": address})


def create_account(customer_id: str, account_type: str, nickname: str, balance: float) -> dict:
    body = {"type": account_type, "nickname": nickname, "rewards": 0, "balance": round(balance)}
    return _create(f"/customers/{customer_id}/accounts", body)


def create_merchant(name: str, category: str) -> dict:
    # Nessie rejects a list for category; it must be a single string.
    return _create("/merchants", {
        "name": name, "category": category,
        "address": {"street_number": "1", "street_name": "Demo St", "city": "Seattle", "state": "WA", "zip": "98109"},
        "geocode": {"lat": 47.6, "lng": -122.3},
    })


def create_deposit(account_id: str, amount: float, transaction_date: str, description: str) -> dict:
    # Stored as a whole number, so callers keep the exact amount in description.
    body = {"medium": "balance", "transaction_date": transaction_date, "status": "completed",
            "amount": round(amount), "description": description}
    return _create(f"/accounts/{account_id}/deposits", body)


def update_deposit(deposit_id: str, amount: float, description: str) -> None:
    _request("PUT", f"/deposits/{deposit_id}", {"medium": "balance", "amount": round(amount), "description": description})


def create_bill(account_id: str, payee: str, nickname: str, amount: float, payment_date: str, recurring_date: int) -> dict:
    body = {"status": "recurring", "payee": payee, "nickname": nickname, "payment_date": payment_date,
            "recurring_date": recurring_date, "payment_amount": round(amount, 2)}
    return _create(f"/accounts/{account_id}/bills", body)


def update_bill(bill_id: str, amount: float) -> None:
    _request("PUT", f"/bills/{bill_id}", {"payment_amount": round(amount, 2)})


def create_purchase(account_id: str, merchant_id: str, amount: float, purchase_date: str, description: str) -> dict:
    # Stored as a whole number (1.23 is saved as 1), so callers keep the exact price in description.
    body = {
        "merchant_id": merchant_id,
        "medium": "balance",
        "purchase_date": purchase_date,
        "amount": round(amount),
        "status": "completed",
        "description": description,
    }
    return _create(f"/accounts/{account_id}/purchases", body)
