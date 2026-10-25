"""Financial score engine. Pure functions only: no I/O, no LLM, no randomness.

Same inputs always give the same score, which is what makes it unit-testable
and is why the LLM is never allowed to decide anything.
"""

from dataclasses import dataclass, asdict

# Tunable defaults (brief section 8). The budget comes from the user's Nessie profile; buffer/floor are
# settings; these weights are ours.
WEIGHTS = {"bills": 0.5, "budget": 0.3, "buffer": 0.2}
AWARE_NUDGE_DROP = 15  # Aware mode offers "Sleep on it" when the score drops this much...
AWARE_NUDGE_BELOW = 50  # ...or ends below this.
STRICT_MAX_BLOCKS_PER_WEEK = 3


def clamp(x: float, lo: float = 0, hi: float = 100) -> float:
    return max(lo, min(hi, x))


@dataclass
class Components:
    bills: float
    budget: float
    buffer: float
    penalty: float
    total: int


def compute_components(
    balance: float,
    monthly_bills: float,
    budget: float,
    spent: float,
    buffer_target: float,
    price: float = 0,
    penalty: float = 0,
) -> Components:
    """Score the user's position *after* spending `price` (pass price=0 for 'before')."""
    balance_after = balance - price
    left_after = budget - spent - price

    bills_score = 100.0 if monthly_bills <= 0 else clamp(100 * (balance_after / monthly_bills - 1))
    budget_score = clamp(100 * left_after / budget) if budget > 0 else 0.0
    buffer_score = clamp(100 * (balance_after - monthly_bills) / buffer_target) if buffer_target > 0 else 100.0

    raw = (
        WEIGHTS["bills"] * bills_score
        + WEIGHTS["budget"] * budget_score
        + WEIGHTS["buffer"] * buffer_score
        - penalty
    )
    return Components(bills_score, budget_score, buffer_score, penalty, round(clamp(raw)))


def decide(score_before: int, score_after: int, mode: str, floor: int, blocks_this_week: int) -> dict:
    """Turn two scores into what the card should do. Override is always possible."""
    # After 3 blocks in a week, Strict falls through to Aware behaviour.
    if mode == "strict" and blocks_this_week < STRICT_MAX_BLOCKS_PER_WEEK and score_after < floor:
        return {"action": "block"}
    nudge = (score_before - score_after) >= AWARE_NUDGE_DROP or score_after < AWARE_NUDGE_BELOW
    return {"action": "nudge" if nudge else "inform"}


def evaluate(snapshot: dict, purchase: dict, state: dict) -> dict:
    """Main entry point used by /evaluate. Returns the 'facts' object the LLM may word."""
    settings = state["settings"]
    penalty = state.get("regret_penalty", {}).get(purchase.get("category", "other"), 0)

    common = dict(
        balance=snapshot["balance"],
        monthly_bills=snapshot["monthly_bills"],
        budget=snapshot["budget"],
        spent=snapshot["spent_this_month"],
        buffer_target=settings["buffer_target"],
    )
    before = compute_components(**common)
    after = compute_components(**common, price=purchase["price"], penalty=penalty)

    verdict = decide(before.total, after.total, settings["mode"], settings["floor"], state.get("blocks_this_week", 0))
    facts = {
        "score_before": before.total,
        "score_after": after.total,
        "components_after": {k: round(v, 1) for k, v in asdict(after).items()},
        "price": purchase["price"],
        "monthly_bills": snapshot["monthly_bills"],
        "budget_left_after": round(snapshot["budget"] - snapshot["spent_this_month"] - purchase["price"], 2),
        "mode": settings["mode"],
        **verdict,
    }
    # The floor only means something in Strict mode; leaving it out stops the LLM mentioning it in Aware.
    if settings["mode"] == "strict":
        facts["floor"] = settings["floor"]
    return facts
