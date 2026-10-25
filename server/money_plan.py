"""The user's monthly money plan (income, fixed bills, savings) and the accounts they can link.

In Nessie mode the bank is the source of truth. Nessie has no custom fields, so each number lives in a
Nessie object on the linked account, tagged so we can find it again:
    monthly income -> a deposit described "PROFILE income | <exact amount>"
    fixed bills    -> a recurring bill nicknamed "PROFILE fixed bills"
    savings        -> a recurring bill nicknamed "PROFILE savings" (pay yourself first)
Discretionary is never stored: it's always income - fixed bills - savings, so the plan always balances.
Saving deletes the old tagged objects and creates new ones (Nessie can delete bills and deposits).

In seed mode the same plan is kept in state.json, so everything works offline.
"""

import json
import os
from datetime import date
from pathlib import Path

import nessie
import store

DATA_DIR = Path(__file__).parent / "data"
TAG = "PROFILE"
INCOME_DESC = f"{TAG} income"
FIXED_NICK = f"{TAG} fixed bills"
SAVINGS_NICK = f"{TAG} savings"
SEED_ACCOUNT = {"id": "seed-checking", "nickname": "Checking (demo data)", "last4": "0000"}


def data_source() -> str:
    return os.getenv("DATA_SOURCE", "seed")


def nessie_ids() -> dict:
    return json.loads((DATA_DIR / "nessie_ids.json").read_text())


def is_profile_bill(bill: dict) -> bool:
    """Profile bills describe the monthly plan; they aren't real bills coming due."""
    return (bill.get("nickname") or "").startswith(TAG)


def make_plan(income: float, fixed: float, savings: float, saved: bool) -> dict:
    return {
        "monthly_income": round(income, 2),
        "fixed_bills": round(fixed, 2),
        "savings": round(savings, 2),
        "discretionary": round(max(income - fixed - savings, 0), 2),
        "saved": saved,
    }


EMPTY = make_plan(0, 0, 0, saved=False)


def validate(income: float, fixed: float, savings: float) -> None:
    if income <= 0:
        raise ValueError("Monthly income must be more than $0.")
    if fixed < 0 or savings < 0:
        raise ValueError("Amounts can't be negative.")
    if fixed + savings > income:
        raise ValueError("Fixed bills and savings add up to more than your income.")


# --- Accounts -----------------------------------------------------------------------------------------------

def _display(account: dict) -> dict:
    number = account.get("account_number") or account["_id"]
    return {"id": account["_id"], "nickname": account.get("nickname") or account.get("type", "Account"),
            "last4": number[-4:]}


def list_accounts() -> list[dict]:
    """Accounts the user can link: the demo customer's checking accounts. Display metadata only."""
    if data_source() != "nessie":
        return [SEED_ACCOUNT]
    accounts = nessie.get_accounts(nessie_ids()["customer_id"])
    return [_display(a) for a in accounts if a.get("type") == "Checking"]


def find_account(account_id: str) -> dict | None:
    return next((a for a in list_accounts() if a["id"] == account_id), None)


# --- Reading and writing the plan ---------------------------------------------------------------------------

def plan_from_records(bills: list[dict], deposits: list[dict]) -> dict:
    """Rebuild the plan from an account's Nessie bills and deposits (EMPTY if it was never saved)."""
    income_dep = next((d for d in reversed(deposits) if (d.get("description") or "").startswith(INCOME_DESC)), None)
    fixed_bill = next((b for b in reversed(bills) if b.get("nickname") == FIXED_NICK), None)
    savings_bill = next((b for b in reversed(bills) if b.get("nickname") == SAVINGS_NICK), None)
    if not income_dep:
        return EMPTY
    # Nessie rounds deposit amounts to whole dollars, so the exact figure rides in the description.
    try:
        income = float(income_dep["description"].rsplit("|", 1)[1])
    except (IndexError, ValueError):
        income = float(income_dep.get("amount", 0))
    fixed = float(fixed_bill["payment_amount"]) if fixed_bill else 0.0
    savings = float(savings_bill["payment_amount"]) if savings_bill else 0.0
    return make_plan(income, fixed, savings, saved=True)


def read_plan(account_id: str) -> dict:
    if data_source() != "nessie":
        return store.load_state().get("profile", EMPTY)
    return plan_from_records(nessie.get_bills(account_id), nessie.get_deposits(account_id))


def _first_of_next_month(today: date) -> str:
    return (date(today.year + 1, 1, 1) if today.month == 12 else date(today.year, today.month + 1, 1)).isoformat()


def write_plan(account_id: str, income: float, fixed: float, savings: float) -> dict:
    """Validate and store the plan, then return what's stored. Raises ValueError for an impossible plan."""
    validate(income, fixed, savings)
    plan = make_plan(income, fixed, savings, saved=True)
    if data_source() != "nessie":
        state = store.load_state()
        state["profile"] = plan
        store.save_state(state)
        return plan

    for b in nessie.get_bills(account_id):
        if b.get("nickname") in (FIXED_NICK, SAVINGS_NICK):
            nessie.delete_bill(b["_id"])
    for d in nessie.get_deposits(account_id):
        if (d.get("description") or "").startswith(INCOME_DESC):
            nessie.delete_deposit(d["_id"])

    today = date.today()
    nessie.create_deposit(account_id, income, today.isoformat(), f"{INCOME_DESC} | {income:.2f}")
    due = _first_of_next_month(today)
    for nick, payee, amount in ((FIXED_NICK, "Fixed bills", fixed), (SAVINGS_NICK, "Savings", savings)):
        if amount > 0:
            nessie.create_bill(account_id, payee=payee, nickname=nick, amount=amount, payment_date=due)

    # Linking an account means the server reads from it from now on.
    ids = nessie_ids()
    if ids.get("account_id") != account_id:
        ids["account_id"] = account_id
        (DATA_DIR / "nessie_ids.json").write_text(json.dumps(ids, indent=2) + "\n")
    return read_plan(account_id)
