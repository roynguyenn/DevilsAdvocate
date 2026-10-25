"""The user's financial profile (income, fixed bills, savings), stored in Nessie.

What the popup's Finances tab saves maps onto ordinary bank records:
  * monthly income  -> a deposit on the linked checking account tagged "INCOME | <amount>"
  * fixed bills     -> the account's recurring bills; we own the one nicknamed "Fixed bills"
  * monthly savings -> a deposit on the customer's Savings account tagged "SAVINGS | <amount>"
  * discretionary   -> derived (income - fixed bills - savings), so there is only one budget

Nessie truncates deposit amounts to whole dollars, so the exact amount lives in the description.
"""

import json
from datetime import date
from pathlib import Path

import nessie
import store

DATA_DIR = Path(__file__).parent / "data"
NESSIE_IDS = DATA_DIR / "nessie_ids.json"
INCOME_TAG = "INCOME"
SAVINGS_TAG = "SAVINGS"
FIXED_BILLS_NICKNAME = "Fixed bills"


def nessie_ids() -> dict:
    return json.loads(NESSIE_IDS.read_text())


def linked_account_id() -> str:
    """The checking account the popup linked, or the seeded one before anything was linked."""
    return store.load_state().get("account_id") or nessie_ids()["account_id"]


def _last4(account: dict) -> str:
    return str(account.get("account_number") or account["_id"])[-4:]


def account_summary(account: dict) -> dict:
    """The only account fields the extension ever sees (no balance, no full number)."""
    return {"id": account["_id"], "nickname": account.get("nickname") or account.get("type", "Account"),
            "last4": _last4(account)}


def checking_accounts() -> list[dict]:
    return [a for a in nessie.get_accounts(nessie_ids()["customer_id"]) if a.get("type") == "Checking"]


def find_checking_account(account_id: str) -> dict | None:
    return next((a for a in checking_accounts() if a["_id"] == account_id), None)


def savings_account_id(create: bool = False) -> str | None:
    ids = nessie_ids()
    if ids.get("savings_account_id"):
        return ids["savings_account_id"]
    found = next((a["_id"] for a in nessie.get_accounts(ids["customer_id"]) if a.get("type") == "Savings"), None)
    if found is None and create:
        found = nessie.create_account(ids["customer_id"], "Savings", "Savings", 0)["_id"]
    if found:
        store.write_json(NESSIE_IDS, {**ids, "savings_account_id": found})
    return found


# --- Pure mapping from Nessie records ---------------------------------------------------------


def tag_description(tag: str, amount: float) -> str:
    return f"{tag} | {amount:.2f}"


def tagged_amount(record: dict, tag: str) -> float | None:
    """Exact amount of a deposit we tagged, or None if it isn't ours."""
    parts = (record.get("description") or "").split(" | ")
    if len(parts) != 2 or parts[0] != tag:
        return None
    try:
        return float(parts[1])
    except ValueError:
        return float(record.get("amount", 0))


def _find_tagged(deposits: list, tag: str) -> dict | None:
    return next((d for d in deposits if tagged_amount(d, tag) is not None), None)


def _counts_this_month(bill: dict, today: date) -> bool:
    if bill.get("status") == "recurring":
        return True
    due = bill.get("upcoming_payment_date") or bill.get("payment_date")
    return bill.get("status") == "pending" and bool(due) and date.fromisoformat(due).replace(day=1) == today.replace(day=1)


def monthly_bills(bills: list, today: date | None = None) -> float:
    """Recurring bills plus one-off pending bills due this calendar month. Completed bills are paid."""
    today = today or date.today()
    return round(sum(b.get("payment_amount", 0) for b in bills if _counts_this_month(b, today)), 2)


def _managed_bill(bills: list) -> dict | None:
    return next((b for b in bills if b.get("nickname") == FIXED_BILLS_NICKNAME and b.get("status") == "recurring"), None)


def profile_from(deposits: list, bills: list, savings_deposits: list) -> dict:
    income_dep, savings_dep = _find_tagged(deposits, INCOME_TAG), _find_tagged(savings_deposits, SAVINGS_TAG)
    income = tagged_amount(income_dep, INCOME_TAG) if income_dep else 0.0
    savings = tagged_amount(savings_dep, SAVINGS_TAG) if savings_dep else 0.0
    fixed = monthly_bills(bills)
    return {
        "monthly_income": income,
        "fixed_bills": fixed,
        "savings": savings,
        "discretionary": round(max(income - fixed - savings, 0), 2),
    }


# --- Read / write -----------------------------------------------------------------------------


def get_profile(account_id: str) -> dict:
    sav_id = savings_account_id()
    return profile_from(nessie.get_deposits(account_id), nessie.get_bills(account_id),
                        nessie.get_deposits(sav_id) if sav_id else [])


def save_profile(account_id: str, monthly_income: float, fixed_bills: float, savings: float) -> dict:
    """Make Nessie hold exactly these numbers, updating our records in place. Returns the profile read back."""
    today = date.today()

    deposits = nessie.get_deposits(account_id)
    income_dep = _find_tagged(deposits, INCOME_TAG)
    if income_dep:
        nessie.update_deposit(income_dep["_id"], monthly_income, tag_description(INCOME_TAG, monthly_income))
    else:
        nessie.create_deposit(account_id, monthly_income, today.replace(day=1).isoformat(),
                              tag_description(INCOME_TAG, monthly_income))

    # The user's number is the total of their fixed bills, so other bills on the account count toward it.
    bills = nessie.get_bills(account_id)
    managed = _managed_bill(bills)
    others = monthly_bills([b for b in bills if b is not managed], today)
    managed_amount = round(fixed_bills - others, 2)
    if managed_amount < 0:
        raise ValueError(f"The account already has ${others:.2f} in monthly bills, more than ${fixed_bills:.2f}.")
    if managed:
        nessie.update_bill(managed["_id"], managed_amount)
    else:
        next_month = date(today.year + today.month // 12, today.month % 12 + 1, 1)
        nessie.create_bill(account_id, "Fixed bills", FIXED_BILLS_NICKNAME, managed_amount, next_month.isoformat(), 1)

    sav_id = savings_account_id(create=True)
    savings_dep = _find_tagged(nessie.get_deposits(sav_id), SAVINGS_TAG)
    if savings_dep:
        nessie.update_deposit(savings_dep["_id"], savings, tag_description(SAVINGS_TAG, savings))
    else:
        nessie.create_deposit(sav_id, savings, today.replace(day=1).isoformat(), tag_description(SAVINGS_TAG, savings))

    return get_profile(account_id)
