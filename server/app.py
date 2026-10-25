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

import customers  # noqa: E402
import decisions  # noqa: E402
import finances  # noqa: E402
import llm  # noqa: E402
import nessie  # noqa: E402
import score  # noqa: E402
import store  # noqa: E402
from snapshot import describe_source, get_financial_snapshot, record_simulated_purchase  # noqa: E402

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
    # The Agent tab. Not a bank field, so it's kept per customer in state.json.
    intensity: Literal["light", "medium", "harsh"] | None = None

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


class Decision(BaseModel):
    """How a checkout ended: the overlay sends this when they buy (simulated) or close without buying."""

    purchase: Purchase
    history: list[ChatTurn] = Field(max_length=20)
    outcome: Literal["bought", "walked_away"]


class CustomerChoice(BaseModel):
    customer_id: str = Field(min_length=1, max_length=100)


MAX_USER_TURNS = 3


@app.get("/health")
def health():
    return {"ok": True, "source": describe_source()}


UI_SNAPSHOT_KEYS = ("monthly_income", "monthly_bills", "savings", "budget", "spent_this_month", "balance",
                    "transactions", "source")


def _snapshot_for_ui(snap: dict) -> dict:
    """What the overlay's charts and ledger draw, so they match the numbers the score used."""
    return {k: snap[k] for k in UI_SNAPSHOT_KEYS}


def _with_memory(facts: dict, title: str) -> dict:
    past = decisions.relevant(title)
    return {**facts, "past_decisions": past} if past else facts


@app.post("/evaluate")
def evaluate(purchase: Purchase, debug: bool = False):
    """The score and threshold stay server-side: the extension only gets the verdict and the wording.
    `?debug=true` adds the full facts (scores, components, floor) for development."""
    snap = get_financial_snapshot()
    facts = _with_memory(score.evaluate(snap, purchase.model_dump(), store.load_state()), purchase.title)
    body = {"action": facts["action"], "message": llm.explain(facts), "snapshot": _snapshot_for_ui(snap)}
    return {**body, "debug": facts} if debug else body


@app.post("/purchase")
def simulate_purchase(purchase: Purchase):
    """'Buy anyway' in the overlay. SIMULATED: logs a fake purchase; no order is placed on Amazon."""
    record_simulated_purchase(purchase.title, purchase.price)
    return {"snapshot": _snapshot_for_ui(get_financial_snapshot())}


@app.post("/chat")
def chat(req: ChatRequest):
    if not req.history or req.history[-1].role != "user":
        raise HTTPException(400, "history must end with a user message")
    # Recompute facts server-side so the client can't hand Claude made-up numbers.
    facts = _with_memory(score.evaluate(get_financial_snapshot(), req.purchase.model_dump(), store.load_state()),
                         req.purchase.title)
    user_turns = sum(t.role == "user" for t in req.history)
    # The cap is never shown to the user: their last allowed reply gets a wrap-up that hands them the decision,
    # and `done` tells the overlay to close the chat. Anything past the cap gets the wrap-up without calling Claude.
    if user_turns > MAX_USER_TURNS:
        return {"reply": llm.closing_message(facts), "done": True}
    final = user_turns == MAX_USER_TURNS
    history = [t.model_dump() for t in req.history]
    return {"reply": llm.chat(facts, req.purchase.title, history, final=final), "done": final}


def _checking_account(account_id: str) -> dict:
    account = finances.find_checking_account(account_id)
    if account is None:
        raise HTTPException(404, "not one of this customer's checking accounts")
    return account


def _profile_response(account: dict) -> dict:
    intensity = store.load_customer(finances.current_customer_id())["intensity"]
    return {"account": finances.account_summary(account), **finances.get_profile(account["_id"]), "intensity": intensity}


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
    customer_id = finances.current_customer_id()
    data = store.load_customer(customer_id)
    data["account_id"] = account["_id"]
    if profile.intensity:
        data["intensity"] = profile.intensity
    store.save_customer(customer_id, data)
    return _profile_response(account)


@app.get("/customers")
def get_customers():
    """Dev/demo control: the Nessie customers the key can see, and which one the server reads."""
    return customers.list_customers()


@app.put("/customer")
def put_customer(choice: CustomerChoice):
    """Switch the server to another Nessie customer. Their linked account, finances and intensity come with them."""
    try:
        chosen = customers.select_customer(choice.customer_id)
    except LookupError as e:
        raise HTTPException(409, str(e)) from None
    return {"customer": chosen, "profile": _profile_response(_checking_account(finances.linked_account_id()))}


@app.post("/decision")
def post_decision(d: Decision):
    """Log how a checkout ended (bought or walked away) as a 1-2 line summary for next time."""
    return decisions.record(d.purchase.title, d.purchase.price, d.outcome, [t.model_dump() for t in d.history])


@app.get("/decisions")
def get_decisions():
    """This customer's decision log, oldest first (for development)."""
    return decisions.history()


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
