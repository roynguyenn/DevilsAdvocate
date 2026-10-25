"""FastAPI entry point. Routes are thin: they load state, call pure functions, save state.

Run from server/:  uvicorn app:app --port 3001 --reload
"""

import time
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
import manual  # noqa: E402
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
    # /purchase only: False when the student placed the real order (Live mode) rather than a simulated one.
    simulated: bool = True


class Settings(BaseModel):
    buffer_target: float
    mode: Literal["aware", "strict"]
    floor: int


class Profile(BaseModel):
    """The popup's Finances tab. Stored in Nessie; discretionary is derived there, so it must balance here."""

    # None = no bank linked: the student uses the Finances tab only (manual.py), stored on our server.
    account_id: str | None = Field(default=None, min_length=1, max_length=100)
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


def _snapshot() -> dict:
    """Nessie when the student linked their bank; otherwise the Finances tab and their in-extension purchases."""
    return get_financial_snapshot() if manual.bank_linked() else manual.snapshot()


def _profile_key() -> str:
    """Whose decision log and intensity to use: the Nessie customer, or the Finances-tab-only profile."""
    return finances.current_customer_id() if manual.bank_linked() else manual.MANUAL_KEY


@app.get("/health")
def health():
    return {"ok": True, "source": describe_source() if manual.bank_linked() else {"type": "manual"}}


UI_SNAPSHOT_KEYS = ("monthly_income", "monthly_bills", "savings", "budget", "spent_this_month", "balance",
                    "transactions", "source")


def _snapshot_for_ui(snap: dict) -> dict:
    """What the overlay's charts and ledger draw, so they match the numbers the score used."""
    return {k: snap[k] for k in UI_SNAPSHOT_KEYS}


RECENT_FOR_LLM = 8
DAY_MS = 86_400_000


def _when(ts: int, now_ms: int) -> str:
    # Relative dates are written out here so Claude never has to compute one (and the number guard can check them).
    days = max((now_ms - ts) // DAY_MS, 0)
    return "today" if days == 0 else "yesterday" if days == 1 else f"{days} days ago"


def _with_context(facts: dict, title: str, snap: dict) -> dict:
    """Add what Claude needs to link this item to their history: recent purchases and past decisions."""
    now_ms = int(time.time() * 1000)
    recent = [{"merchant": t["merchant"], "category": t["category"], "amount": t["amount"], "when": _when(t["timestamp"], now_ms),
               # Purchases made through the extension know what the item was, so Claude can link "jeans" to "jeans".
               **({"item": t["title"]} if t.get("title") else {})}
              for t in snap["transactions"][:RECENT_FOR_LLM]]
    past = decisions.relevant(title, _profile_key())
    return {**facts, "recent_purchases": recent, **({"past_decisions": past} if past else {})}


def _intensity() -> str:
    """The popup's Agent setting for the current customer: picks Claude's persona."""
    return store.load_customer(_profile_key())["intensity"]


@app.post("/evaluate")
def evaluate(purchase: Purchase, debug: bool = False):
    """The extension gets the verdict, the wording and the score (score_before/after), which it uses as a hidden
    heuristic and never shows. Claude never sees the score. `?debug=true` adds every fact for development."""
    snap = _snapshot()
    rules = score.rules_for(_intensity())  # the Agent setting picks the thresholds as well as the persona
    facts = _with_context(score.evaluate(snap, purchase.model_dump(), store.load_state(), rules), purchase.title, snap)
    body = {
        "action": facts["action"],
        "score_before": facts["score_before"],
        "score_after": facts["score_after"],
        "message": llm.explain(facts, _intensity()),
        "snapshot": _snapshot_for_ui(snap),
    }
    return {**body, "debug": facts} if debug else body


@app.post("/purchase")
def simulate_purchase(purchase: Purchase):
    """'Buy it/anyway' in the overlay: records the purchase in Nessie. In Testing mode it's simulated and nothing is
    ordered; in Live mode (simulated=false) the extension then releases the real Place Order click itself."""
    if manual.bank_linked():
        record_simulated_purchase(purchase.title, purchase.price, simulated=purchase.simulated)
    else:
        manual.record_purchase(purchase.title, purchase.price, simulated=purchase.simulated)
    return {"snapshot": _snapshot_for_ui(_snapshot())}


@app.post("/chat")
def chat(req: ChatRequest):
    if not req.history or req.history[-1].role != "user":
        raise HTTPException(400, "history must end with a user message")
    # Recompute facts server-side so the client can't hand Claude made-up numbers.
    snap = _snapshot()
    rules = score.rules_for(_intensity())
    facts = _with_context(score.evaluate(snap, req.purchase.model_dump(), store.load_state(), rules), req.purchase.title,
                          snap)
    user_turns = sum(t.role == "user" for t in req.history)
    # The cap is never shown to the user: their last allowed reply gets a wrap-up that hands them the decision,
    # and `done` tells the overlay to close the chat. Anything past the cap gets the wrap-up without calling Claude.
    if user_turns > MAX_USER_TURNS:
        return {"reply": llm.closing_message(facts), "done": True}
    final = user_turns == MAX_USER_TURNS
    history = [t.model_dump() for t in req.history]
    return {"reply": llm.chat(facts, req.purchase.title, history, final=final, intensity=_intensity()), "done": final}


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


def _manual_profile_response() -> dict:
    return {"account": None, **manual.get_profile(), "intensity": store.load_customer(manual.MANUAL_KEY)["intensity"]}


@app.get("/profile")
def get_profile(account_id: str | None = None):
    """The current config: from Nessie for the linked account (or `account_id`, to preview one), or the
    Finances-tab-only profile when no bank is linked (`account` is then null)."""
    if account_id is None and not manual.bank_linked():
        return _manual_profile_response()
    return _profile_response(_checking_account(account_id or finances.linked_account_id()))


@app.put("/profile")
def put_profile(profile: Profile):
    """Save the popup's config. With an account: write the Finances tab to Nessie and link it (bank mode).
    Without one: keep the Finances tab on our server and score from it alone (manual.py)."""
    if profile.account_id is None:
        manual.save_profile(profile.monthly_income, profile.fixed_bills, profile.savings)
        manual.set_bank_linked(False)
        if profile.intensity:
            data = store.load_customer(manual.MANUAL_KEY)
            data["intensity"] = profile.intensity
            store.save_customer(manual.MANUAL_KEY, data)
        return _manual_profile_response()
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
    manual.set_bank_linked(True)
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
        manual.set_bank_linked(True)  # picking a bank customer means reading their bank
    except LookupError as e:
        raise HTTPException(409, str(e)) from None
    return {"customer": chosen, "profile": _profile_response(_checking_account(finances.linked_account_id()))}


@app.post("/decision")
def post_decision(d: Decision):
    """Log how a checkout ended (bought or walked away) as a 1-2 line summary for next time."""
    return decisions.record(d.purchase.title, d.purchase.price, d.outcome, [t.model_dump() for t in d.history],
                            customer_id=_profile_key())


@app.get("/decisions")
def get_decisions():
    """This customer's decision log, oldest first (for development)."""
    return decisions.history(_profile_key())


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
