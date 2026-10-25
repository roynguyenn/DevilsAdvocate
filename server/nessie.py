"""Thin client for Capital One's Nessie mock bank. The key never leaves the server."""

import os

import httpx

BASE = os.getenv("NESSIE_BASE", "https://prod-api.nessieisreal.com")


class NessieError(Exception):
    pass


def _get(path: str) -> list | dict:
    try:
        r = httpx.get(f"{BASE}{path}", params={"key": os.environ["NESSIE_KEY"]}, timeout=10)
        r.raise_for_status()
    except httpx.HTTPError as e:
        # httpx's message includes the full URL, which carries the key; don't let it reach logs.
        raise NessieError(f"GET {path} failed: {type(e).__name__}") from None
    return r.json()


def get_account(account_id: str) -> dict:
    return _get(f"/accounts/{account_id}")


def get_accounts(customer_id: str) -> list:
    return _get(f"/customers/{customer_id}/accounts")


def get_bills(account_id: str) -> list:
    return _get(f"/accounts/{account_id}/bills")


def get_deposits(account_id: str) -> list:
    return _get(f"/accounts/{account_id}/deposits")
