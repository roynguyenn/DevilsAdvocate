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
from snapshot import get_financial_snapshot  # noqa: E402

app = FastAPI(title="Spend-aware checkout")

# The extension's service worker calls us from a chrome-extension:// origin.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^chrome-extension://.*$",
    allow_methods=["*"],
    allow_headers=["*"],
)


class Purchase(BaseModel):
    title: str
    price: float
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
    return {"ok": True}


@app.post("/evaluate")
def evaluate(purchase: Purchase):
    facts = score.evaluate(get_financial_snapshot(), purchase.model_dump(), store.load_state())
    return {**facts, "message": llm.explain(facts)}


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
