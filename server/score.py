"""Financial score engine. Pure functions only: no I/O, no LLM, no randomness.

Same inputs always give the same score, which is what makes it unit-testable
and is why the LLM is never allowed to decide anything.
"""

from dataclasses import dataclass, asdict

# Tunable defaults (brief section 8). The budget comes from the user's Nessie profile; buffer/floor are
# settings; these weights are ours.
WEIGHTS = {"bills": 0.5, "budget": 0.3, "buffer": 0.2}
# Finances-tab-only mode (no bank linked): there's no balance, so only the budget can be judged.
BUDGET_ONLY_WEIGHTS = {"budget": 0.7, "size": 0.3}
AWARE_NUDGE_DROP = 15  # Aware mode offers "Sleep on it" when the score drops this much...
AWARE_NUDGE_BELOW = 50  # ...or ends below this.
STRICT_MAX_BLOCKS_PER_WEEK = 3

# The popup's Agent setting (saved per customer) sets both Claude's persona and these thresholds.
# Light only nudges on bigger hits; Medium is the default; Harsh can put an order on hold below the floor.
INTENSITY_RULES = {
    "light": {"mode": "aware", "nudge_drop": 25, "nudge_below": 40},
    "medium": {"mode": "aware", "nudge_drop": AWARE_NUDGE_DROP, "nudge_below": AWARE_NUDGE_BELOW},
    "harsh": {"mode": "strict", "nudge_drop": AWARE_NUDGE_DROP, "nudge_below": AWARE_NUDGE_BELOW, "floor": 70},
}


def rules_for(intensity: str) -> dict:
    return INTENSITY_RULES.get(intensity, INTENSITY_RULES["medium"])


def rules_from_settings(settings: dict) -> dict:
    """Fallback for callers without an Agent setting (scripts, tests): the server's mode/floor settings."""
    return {"mode": settings.get("mode", "aware"), "nudge_drop": AWARE_NUDGE_DROP, "nudge_below": AWARE_NUDGE_BELOW,
            "floor": settings.get("floor", 70)}


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


def compute_budget_only(budget: float, spent: float, price: float = 0, penalty: float = 0) -> Components:
    """Score from the Finances tab alone (no bank linked): how much of the month's discretionary budget is left
    after this purchase, and how big this one purchase is against the whole budget. Pass price=0 for 'before'."""
    left_after = budget - spent - price
    budget_score = clamp(100 * left_after / budget) if budget > 0 else 0.0
    size_score = clamp(100 * (1 - price / budget)) if budget > 0 else 0.0
    raw = BUDGET_ONLY_WEIGHTS["budget"] * budget_score + BUDGET_ONLY_WEIGHTS["size"] * size_score - penalty
    # Reuses Components: `bills` carries the size score here, and `buffer` is unused.
    return Components(size_score, budget_score, 0.0, penalty, round(clamp(raw)))


def decide(score_before: int, score_after: int, rules: dict, blocks_this_week: int) -> dict:
    """Turn two scores into what the card should do, using the rules for the student's Agent setting.
    Override is always possible."""
    # After 3 blocks in a week, Strict falls through to Aware behaviour.
    if rules["mode"] == "strict" and blocks_this_week < STRICT_MAX_BLOCKS_PER_WEEK and score_after < rules["floor"]:
        return {"action": "block"}
    nudge = (score_before - score_after) >= rules["nudge_drop"] or score_after < rules["nudge_below"]
    return {"action": "nudge" if nudge else "inform"}


def evaluate(snapshot: dict, purchase: dict, state: dict, rules: dict | None = None) -> dict:
    """Main entry point used by /evaluate. Returns the 'facts' object the LLM may word.
    `rules` come from the Agent setting (rules_for); without them, the server's mode/floor settings apply."""
    settings = state["settings"]
    rules = rules or rules_from_settings(settings)
    penalty = state.get("regret_penalty", {}).get(purchase.get("category", "other"), 0)

    bank_linked = snapshot["balance"] is not None
    if bank_linked:
        common = dict(
            balance=snapshot["balance"],
            monthly_bills=snapshot["monthly_bills"],
            budget=snapshot["budget"],
            spent=snapshot["spent_this_month"],
            buffer_target=settings["buffer_target"],
        )
        before = compute_components(**common)
        after = compute_components(**common, price=purchase["price"], penalty=penalty)
    else:
        before = compute_budget_only(snapshot["budget"], snapshot["spent_this_month"])
        after = compute_budget_only(snapshot["budget"], snapshot["spent_this_month"], purchase["price"], penalty)

    verdict = decide(before.total, after.total, rules, state.get("blocks_this_week", 0))
    facts = {
        "score_before": before.total,
        "score_after": after.total,
        "components_after": {k: round(v, 1) for k, v in asdict(after).items()},
        "price": purchase["price"],
        "monthly_bills": snapshot["monthly_bills"],
        "budget_left_after": round(snapshot["budget"] - snapshot["spent_this_month"] - purchase["price"], 2),
        "mode": rules["mode"],
        **verdict,
    }
    # Without a bank there's no balance to talk about, so Claude never gets one.
    if bank_linked:
        facts["balance_after"] = round(snapshot["balance"] - purchase["price"], 2)
    facts["formula"] = "full" if bank_linked else "budget_only"
    # The floor only means something in Strict mode; leaving it out stops the LLM mentioning it in Aware.
    if rules["mode"] == "strict":
        facts["floor"] = rules["floor"]
    return facts
