"""Thin client for Capital One's Nessie mock bank. The key never leaves the server."""

import os

import httpx

BASE = os.getenv("NESSIE_BASE", "https://prod-api.nessieisreal.com")


class NessieError(Exception):
    pass


def _request(method: str, path: str, body: dict | None = None) -> list | dict:
    try:
        r = httpx.request(method, f"{BASE}{path}", params={"key": os.environ["NESSIE_KEY"]}, json=body, timeout=10)
        r.raise_for_status()
    except httpx.HTTPError as e:
        # httpx's message includes the full URL, which carries the key; don't let it reach logs.
        raise NessieError(f"{method} {path} failed: {type(e).__name__}") from None
    # Some Nessie DELETEs answer 200 with an empty body.
    return r.json() if r.content.strip() else {}


def _get(path: str) -> list | dict:
    return _request("GET", path)


def get_account(account_id: str) -> dict:
    return _get(f"/accounts/{account_id}")


def get_accounts(customer_id: str) -> list:
    return _get(f"/customers/{customer_id}/accounts")


def get_bills(account_id: str) -> list:
    return _get(f"/accounts/{account_id}/bills")


def get_deposits(account_id: str) -> list:
    return _get(f"/accounts/{account_id}/deposits")


def create_deposit(account_id: str, amount: float, transaction_date: str, description: str) -> dict:
    # Like purchases, deposit amounts are stored as whole dollars; callers keep the exact figure in description.
    body = {"medium": "balance", "transaction_date": transaction_date, "status": "completed",
            "amount": round(amount), "description": description}
    return _request("POST", f"/accounts/{account_id}/deposits", body)["objectCreated"]


def create_bill(account_id: str, payee: str, nickname: str, amount: float, payment_date: str) -> dict:
    body = {"status": "recurring", "payee": payee, "nickname": nickname, "payment_date": payment_date,
            "recurring_date": 1, "payment_amount": amount}
    return _request("POST", f"/accounts/{account_id}/bills", body)["objectCreated"]


def delete_bill(bill_id: str) -> None:
    _request("DELETE", f"/bills/{bill_id}")


def delete_deposit(deposit_id: str) -> None:
    _request("DELETE", f"/deposits/{deposit_id}")


def get_purchases(account_id: str) -> list:
    return _get(f"/accounts/{account_id}/purchases")


def create_purchase(account_id: str, merchant_id: str, amount: float, purchase_date: str, description: str) -> dict:
    # Nessie stores amount as a whole number (1.23 is saved as 1), so callers keep the exact price in description.
    body = {
        "merchant_id": merchant_id,
        "medium": "balance",
        "purchase_date": purchase_date,
        "amount": round(amount),
        "status": "completed",
        "description": description,
    }
    return _request("POST", f"/accounts/{account_id}/purchases", body)["objectCreated"]
