"""FastAPI entry point. Routes are thin: they load state, call pure functions, save state.

Run from server/:  uvicorn app:app --port 3001 --reload
"""

from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator

load_dotenv()  # before importing modules that read env vars

import finances  # noqa: E402
import llm  # noqa: E402
import nessie  # noqa: E402
import score  # noqa: E402
import store  # noqa: E402
from snapshot import get_financial_snapshot, record_simulated_purchase  # noqa: E402

app = FastAPI(title="Spend-aware checkout")

# The extension's service worker calls us from a chrome-extension:// origin.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^chrome-extension://.*$",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(nessie.NessieError)
def bank_unavailable(_request: Request, exc: nessie.NessieError):
    # NessieError messages never contain the URL (it carries the key), so they're safe to log.
    print(f"[nessie] {exc}")
    return JSONResponse(status_code=502, content={"detail": "The bank (Nessie) is unavailable."})


class Purchase(BaseModel):
    title: str = Field(max_length=500)
    price: float = Field(gt=0, le=100_000)
    quantity: int = 1
    category: str = "other"


class Settings(BaseModel):
    buffer_target: float
    mode: Literal["aware", "strict"]
    floor: int


class Profile(BaseModel):
    """The popup's Finances tab. Stored in Nessie; discretionary is derived there, so it must balance here."""

    account_id: str = Field(min_length=1, max_length=100)
    monthly_income: float = Field(gt=0, le=1_000_000)
    fixed_bills: float = Field(ge=0, le=1_000_000)
    savings: float = Field(ge=0, le=1_000_000)
    discretionary: float = Field(ge=0, le=1_000_000)

    @model_validator(mode="after")
    def split_is_whole_income(self):
        # Whole cents, matching the popup, so float drift can't reject a balanced split.
        cents = [round(v * 100) for v in (self.fixed_bills, self.savings, self.discretionary)]
        if sum(cents) != round(self.monthly_income * 100):
            raise ValueError("fixed_bills + savings + discretionary must equal monthly_income")
        return self


class Commitment(BaseModel):
    purchase_id: str
    category: str
    text: str


class Outcome(BaseModel):
    purchase_id: str
    answer: Literal["used", "returned", "unused"]


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=2000)


class ChatRequest(BaseModel):
    purchase: Purchase
    history: list[ChatTurn]


MAX_USER_TURNS = 3


@app.get("/health")
def health():
    return {"ok": True}


UI_SNAPSHOT_KEYS = ("monthly_income", "monthly_bills", "savings", "budget", "spent_this_month", "balance", "transactions")


def _snapshot_for_ui(snap: dict) -> dict:
    """What the overlay's charts and ledger draw, so they match the numbers the score used."""
    return {k: snap[k] for k in UI_SNAPSHOT_KEYS}


@app.post("/evaluate")
def evaluate(purchase: Purchase):
    snap = get_financial_snapshot()
    facts = score.evaluate(snap, purchase.model_dump(), store.load_state())
    return {**facts, "message": llm.explain(facts), "snapshot": _snapshot_for_ui(snap)}


@app.post("/purchase")
def simulate_purchase(purchase: Purchase):
    """'Buy anyway' in the overlay. SIMULATED: logs a fake purchase; no order is placed on Amazon."""
    record_simulated_purchase(purchase.title, purchase.price)
    return {"snapshot": _snapshot_for_ui(get_financial_snapshot())}


@app.post("/chat")
def chat(req: ChatRequest):
    if not req.history or req.history[-1].role != "user":
        raise HTTPException(400, "history must end with a user message")
    if sum(t.role == "user" for t in req.history) > MAX_USER_TURNS:
        return {"reply": "That's the end of this chat. The score above stands, and the choice is yours.", "done": True}
    # Recompute facts server-side so the client can't hand Claude made-up numbers.
    facts = score.evaluate(get_financial_snapshot(), req.purchase.model_dump(), store.load_state())
    history = [t.model_dump() for t in req.history]
    return {"reply": llm.chat(facts, req.purchase.title, history), "done": False}


def _checking_account(account_id: str) -> dict:
    account = finances.find_checking_account(account_id)
    if account is None:
        raise HTTPException(404, "not one of this customer's checking accounts")
    return account


def _profile_response(account: dict) -> dict:
    return {"account": finances.account_summary(account), **finances.get_profile(account["_id"])}


@app.get("/accounts")
def accounts():
    """Accounts the popup's Connect Bank dialog may link. Display fields only."""
    return [finances.account_summary(a) for a in finances.checking_accounts()]


@app.get("/profile")
def get_profile(account_id: str | None = None):
    """The financial profile as Nessie holds it, for the linked account (or `account_id`, to preview one)."""
    return _profile_response(_checking_account(account_id or finances.linked_account_id()))


@app.put("/profile")
def put_profile(profile: Profile):
    """Write the popup's Finances tab to Nessie and link the account; returns what Nessie now holds."""
    account = _checking_account(profile.account_id)
    try:
        finances.save_profile(account["_id"], profile.monthly_income, profile.fixed_bills, profile.savings)
    except ValueError as e:
        raise HTTPException(409, str(e)) from None
    state = store.load_state()
    state["account_id"] = account["_id"]
    store.save_state(state)
    return _profile_response(account)


@app.get("/settings")
def get_settings():
    return store.load_state()["settings"]


@app.put("/settings")
def put_settings(settings: Settings):
    state = store.load_state()
    state["settings"] = settings.model_dump()
    store.save_state(state)
    return state["settings"]


# --- Follow-up loop: stubs to fill in during the 21:00-22:30 block ---------------------------


@app.post("/commit")
def commit(c: Commitment):
    # TODO: append {purchase_id, category, commitment, follow_up_date} to commitments.json
    return {"todo": "store commitment", "received": c.model_dump()}


@app.get("/followups")
def followups():
    # TODO: return commitments whose follow_up_date has passed and have no outcome yet
    return store.load_commitments()


@app.post("/outcome")
def outcome(o: Outcome):
    # TODO: look up category by purchase_id; used -> penalty -3 (min 0), returned/unused -> +5 (max 15)
    return {"todo": "update regret_penalty", "received": o.model_dump()}


@app.post("/demo/skip-week")
def skip_week():
    # TODO: SIMULATED time-skip; move follow-up dates into the past and reset blocks_this_week
    return {"todo": "simulate a week passing"}
