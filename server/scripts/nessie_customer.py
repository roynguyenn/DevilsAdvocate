"""Dev tool: inspect Nessie customers and pick which one the server uses.

    python scripts/nessie_customer.py list              # every customer your key can see: all fields + accounts
    python scripts/nessie_customer.py show <customer_id> # one customer: accounts, bills, deposits, purchases
    python scripts/nessie_customer.py use <customer_id>  # point the server at that customer

`use` rewrites data/nessie_ids.json with that customer's first Checking account. The server re-reads
that file on every request, so the switch is live (only matters with DATA_SOURCE=nessie).
To make a brand-new customer instead, run scripts/seed_nessie.py. Never prints the API key.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

import nessie  # noqa: E402
import store  # noqa: E402

IDS_FILE = ROOT / "data" / "nessie_ids.json"


def current() -> dict:
    return json.loads(IDS_FILE.read_text()) if IDS_FILE.exists() else {}


def _print(title: str, data, indent: str = "") -> None:
    print(f"\n{indent}=== {title}")
    print("\n".join(indent + line for line in json.dumps(data, indent=2).splitlines()))


def list_customers() -> None:
    cur = current().get("customer_id")
    customers = nessie._get("/customers")
    for c in customers:
        label = f"{c.get('first_name', '')} {c.get('last_name', '')}" + ("   <- current" if c["_id"] == cur else "")
        _print(label, c)
        _print("Accounts", nessie.get_accounts(c["_id"]), indent="  ")
    print(f"\n{len(customers)} customer(s).")


def show(customer_id: str) -> None:
    hidden = set(store.load_state().get("ignored_nessie_purchases", []))
    _print("Customer", nessie._get(f"/customers/{customer_id}"))
    for account in nessie.get_accounts(customer_id):
        aid = account["_id"]
        _print(f"Account {account.get('nickname')} ({aid})", account)
        _print("Bills", nessie.get_bills(aid), indent="  ")
        _print("Deposits", nessie.get_deposits(aid), indent="  ")
        purchases = nessie.get_purchases(aid)
        for p in purchases:
            # Hidden by reset_demo.py: still in Nessie (it can't delete purchases), but the server skips them.
            p["_hidden_by_reset"] = p["_id"] in hidden
        _print("Purchases", purchases, indent="  ")


def use(customer_id: str) -> None:
    customer = nessie._get(f"/customers/{customer_id}")
    accounts = nessie.get_accounts(customer_id)
    checking = next((a for a in accounts if a.get("type") == "Checking"), accounts[0] if accounts else None)
    if not checking:
        sys.exit("That customer has no accounts. Run scripts/seed_nessie.py to make a complete one.")
    ids = {
        "customer_id": customer_id,
        "account_id": checking["_id"],
        # Merchants aren't tied to a customer, so the demo merchant carries over.
        "merchant_id": current().get("merchant_id"),
        "last_name": customer.get("last_name", ""),
    }
    IDS_FILE.write_text(json.dumps(ids, indent=2) + "\n")
    print(f"Now using {customer.get('first_name', '')} {ids['last_name']}: account {checking.get('nickname')} "
          f"({checking['_id']}), balance {checking.get('balance')}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args == ["list"]:
        list_customers()
    elif len(args) == 2 and args[0] in ("show", "use"):
        (show if args[0] == "show" else use)(args[1])
    else:
        sys.exit(__doc__)
