"""FastAPI entry point. Routes are thin: they load state, call pure functions, save state.

Run from server/:  uvicorn app:app --port 3001 --reload
"""

from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()  # before importing modules that read env vars

import llm  # noqa: E402
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


class Purchase(BaseModel):
    title: str = Field(max_length=500)
    price: float = Field(gt=0, le=100_000)
    quantity: int = 1
    category: str = "other"


class Settings(BaseModel):
    budget: float
    buffer_target: float
    mode: Literal["aware", "strict"]
    floor: int


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
    return {"ok": True, "source": describe_source()}


def _snapshot_for_ui(snap: dict, state: dict) -> dict:
    """What the overlay's charts and ledger draw, so they match the numbers the score used."""
    return {
        "budget": state["settings"]["budget"],
        "spent_this_month": snap["spent_this_month"],
        "balance": snap["balance"],
        "transactions": snap["transactions"],
        "source": snap["source"],
    }


@app.post("/evaluate")
def evaluate(purchase: Purchase, debug: bool = False):
    """The score and threshold stay server-side: the extension only gets the verdict and the wording.
    `?debug=true` adds the full facts (scores, components, floor) for development."""
    snap, state = get_financial_snapshot(), store.load_state()
    facts = score.evaluate(snap, purchase.model_dump(), state)
    body = {"action": facts["action"], "message": llm.explain(facts), "snapshot": _snapshot_for_ui(snap, state)}
    return {**body, "debug": facts} if debug else body


@app.post("/purchase")
def simulate_purchase(purchase: Purchase):
    """'Buy anyway' in the overlay. SIMULATED: logs a fake purchase; no order is placed on Amazon."""
    record_simulated_purchase(purchase.title, purchase.price)
    return {"snapshot": _snapshot_for_ui(get_financial_snapshot(), store.load_state())}


@app.post("/chat")
def chat(req: ChatRequest):
    if not req.history or req.history[-1].role != "user":
        raise HTTPException(400, "history must end with a user message")
    # Recompute facts server-side so the client can't hand Claude made-up numbers.
    facts = score.evaluate(get_financial_snapshot(), req.purchase.model_dump(), store.load_state())
    user_turns = sum(t.role == "user" for t in req.history)
    # The cap is never shown to the user: their last allowed reply gets a wrap-up that hands them the decision,
    # and `done` tells the overlay to close the chat. Anything past the cap gets the wrap-up without calling Claude.
    if user_turns > MAX_USER_TURNS:
        return {"reply": llm.closing_message(facts), "done": True}
    final = user_turns == MAX_USER_TURNS
    history = [t.model_dump() for t in req.history]
    return {"reply": llm.chat(facts, req.purchase.title, history, final=final), "done": final}


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
