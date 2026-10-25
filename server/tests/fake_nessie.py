"""In-memory stand-in for the Nessie API, patched in for nessie._request.

Reproduces the behaviour verified against the real sandbox (see nessie.py): whole-number
deposit/purchase amounts and balances (truncated), bills keep cents, creates wrap the object in
objectCreated, merchant category must be a string, and DELETE /purchases is forbidden.
"""

import itertools
import re
import uuid

import nessie


class FakeNessie:
    def __init__(self):
        self.customers: dict[str, dict] = {}
        self.accounts: dict[str, dict] = {}
        self.merchants: dict[str, dict] = {}
        self.bills: dict[str, dict] = {}
        self.deposits: dict[str, dict] = {}
        self.purchases: dict[str, dict] = {}
        self.down = False
        self.calls: list[tuple[str, str]] = []
        self._numbers = itertools.count(5_000_000_000_001_234)

    # --- helpers for tests -------------------------------------------------------------------

    def of_account(self, table: dict, account_id: str, key: str = "account_id") -> list[dict]:
        return [r for r in table.values() if r[key] == account_id]

    # --- the patched transport ---------------------------------------------------------------

    def request(self, method: str, path: str, body: dict | None = None):
        self.calls.append((method, path))
        if self.down:
            raise nessie.NessieError(f"{method} {path} failed: ConnectError")
        for pattern, handlers in self._routes():
            m = re.fullmatch(pattern, path)
            if m and method in handlers:
                return handlers[method](*m.groups(), **({"body": body} if body is not None else {}))
        raise nessie.NessieError(f"{method} {path} failed: HTTPStatusError")

    def _routes(self):
        return [
            (r"/customers", {"POST": self._create_customer}),
            (r"/customers/([^/]+)/accounts", {"GET": self._customer_accounts, "POST": self._create_account}),
            (r"/accounts/([^/]+)", {"GET": lambda a: self._get(self.accounts, a)}),
            (r"/accounts/([^/]+)/bills", {"GET": lambda a: self.of_account(self.bills, self._acct(a)),
                                          "POST": self._create_bill}),
            (r"/accounts/([^/]+)/deposits", {"GET": lambda a: self.of_account(self.deposits, self._acct(a)),
                                             "POST": self._create_deposit}),
            (r"/accounts/([^/]+)/purchases", {"GET": lambda a: self.of_account(self.purchases, self._acct(a), "payer_id"),
                                              "POST": self._create_purchase}),
            (r"/deposits/([^/]+)", {"GET": lambda d: self._get(self.deposits, d), "PUT": self._update_deposit}),
            (r"/bills/([^/]+)", {"GET": lambda b: self._get(self.bills, b), "PUT": self._update_bill}),
            (r"/purchases/([^/]+)", {"DELETE": self._forbidden}),
            (r"/merchants", {"POST": self._create_merchant}),
            (r"/merchants/([^/]+)", {"GET": lambda m: self._get(self.merchants, m)}),
        ]

    @staticmethod
    def _get(table: dict, key: str) -> dict:
        if key not in table:
            raise nessie.NessieError("GET failed: HTTPStatusError")
        return dict(table[key])

    def _acct(self, account_id: str) -> str:
        self._get(self.accounts, account_id)
        return account_id

    @staticmethod
    def _created(table: dict, record: dict) -> dict:
        record["_id"] = str(uuid.uuid4())
        table[record["_id"]] = record
        return {"code": 201, "objectCreated": dict(record)}

    def _forbidden(self, _id):
        raise nessie.NessieError("DELETE failed: HTTPStatusError")

    def _create_customer(self, body):
        return self._created(self.customers, dict(body))

    def _customer_accounts(self, customer_id):
        return [dict(a) for a in self.accounts.values() if a["customer_id"] == customer_id]

    def _create_account(self, customer_id, body):
        self._get(self.customers, customer_id)
        record = {**body, "balance": int(body["balance"]), "customer_id": customer_id,
                  "account_number": str(next(self._numbers))}
        return self._created(self.accounts, record)

    def _create_bill(self, account_id, body):
        record = {**body, "account_id": self._acct(account_id), "upcoming_payment_date": body.get("payment_date")}
        return self._created(self.bills, record)

    def _update_bill(self, bill_id, body):
        self._get(self.bills, bill_id)
        self.bills[bill_id].update(body)
        return {"code": 202, "objectUpdated": dict(self.bills[bill_id])}

    def _create_deposit(self, account_id, body):
        record = {**body, "amount": int(body["amount"]), "account_id": self._acct(account_id)}
        return self._created(self.deposits, record)

    def _update_deposit(self, deposit_id, body):
        self._get(self.deposits, deposit_id)
        self.deposits[deposit_id].update({**body, "amount": int(body["amount"])})
        return {"code": 202, "objectUpdated": dict(self.deposits[deposit_id])}

    def _create_merchant(self, body):
        if not isinstance(body.get("category"), str):
            raise nessie.NessieError("POST /merchants failed: HTTPStatusError")
        return self._created(self.merchants, dict(body))

    def _create_purchase(self, account_id, body):
        self._get(self.merchants, body["merchant_id"])
        record = {**body, "amount": int(body["amount"]), "payer_id": self._acct(account_id), "type": "merchant"}
        return self._created(self.purchases, record)
