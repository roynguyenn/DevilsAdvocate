"""A short memory of past checkouts, per customer: what they looked at, whether they bought it, and why.

Each finished checkout becomes one entry with a 1-2 line summary (llm.summarize_decision). When the
same customer checks out a similar item again, the matching summaries go to Claude with the facts,
so it can say what happened last time. They only change the wording, never the verdict (Rule 4).
"""

import re
import time

import finances
import llm
import store

KEEP = 50  # entries per customer
MATCH_THRESHOLD = 0.5  # share of the shorter title's words the two titles must have in common
MAX_RELEVANT = 3
_STOPWORDS = {"the", "and", "for", "with", "new", "pack", "set", "of", "in", "to", "a"}


def _words(title: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", title.lower()) if len(w) > 1 and w not in _STOPWORDS}


def similar(a: str, b: str) -> bool:
    """Same product, loosely: most words of the shorter title appear in the other."""
    wa, wb = _words(a), _words(b)
    if not wa or not wb:
        return False
    return len(wa & wb) / min(len(wa), len(wb)) >= MATCH_THRESHOLD


def record(title: str, price: float, outcome: str, history: list[dict], customer_id: str | None = None) -> dict:
    """Summarize a finished checkout and keep it for this customer. Returns the stored entry."""
    customer_id = customer_id or finances.current_customer_id()
    entry = {
        "title": title,
        "price": round(price, 2),
        "outcome": outcome,
        "summary": llm.summarize_decision(title, price, outcome, history),
        "timestamp": int(time.time() * 1000),
    }
    data = store.load_customer(customer_id)
    data["decisions"] = (data["decisions"] + [entry])[-KEEP:]
    store.save_customer(customer_id, data)
    return entry


def history(customer_id: str | None = None) -> list[dict]:
    return store.load_customer(customer_id or finances.current_customer_id())["decisions"]


def relevant(title: str, customer_id: str | None = None) -> list[str]:
    """Summaries of this customer's past checkouts of a similar item, newest first."""
    matches = [d for d in reversed(history(customer_id)) if similar(d["title"], title)]
    return [d["summary"] for d in matches[:MAX_RELEVANT]]
