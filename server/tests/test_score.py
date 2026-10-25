from datetime import date

import pytest

import llm
import score
from finances import monthly_bills

BASE = dict(balance=1400, monthly_bills=700, budget=400, spent=150, buffer_target=300)


def test_worked_example_from_brief():
    assert score.compute_components(**BASE).total == 89
    assert score.compute_components(**BASE, price=180).total == 62


def test_no_bills_scores_full_on_bills_component():
    assert score.compute_components(**{**BASE, "monthly_bills": 0}).bills == 100


def test_penalty_lowers_score():
    assert score.compute_components(**BASE, price=180, penalty=10).total == 52


# Add rows here until there are 10+ (brief section 8). (before, after, mode, floor, blocks) -> action
@pytest.mark.parametrize(
    "before, after, mode, floor, blocks, expected",
    [
        (89, 62, "strict", 70, 0, "block"),
        (89, 62, "strict", 70, 3, "nudge"),  # 3 blocks this week -> behaves like Aware
        (89, 62, "aware", 70, 0, "nudge"),  # dropped 27 points
        (89, 80, "aware", 70, 0, "inform"),
        (60, 49, "aware", 70, 0, "nudge"),  # ended below 50
        (89, 75, "strict", 70, 0, "inform"),
    ],
)
def test_decide(before, after, mode, floor, blocks, expected):
    assert score.decide(before, after, mode, floor, blocks)["action"] == expected


def test_evaluate_end_to_end():
    snapshot = {"balance": 1400, "monthly_bills": 700, "budget": 400, "spent_this_month": 150}
    state = {"settings": {"buffer_target": 300, "mode": "strict", "floor": 70}}
    facts = score.evaluate(snapshot, {"price": 180, "category": "electronics"}, state)
    assert (facts["score_before"], facts["score_after"], facts["action"]) == (89, 62, "block")
    assert facts["monthly_bills"] == 700 and facts["budget_left_after"] == 70
    assert "bills_14d" not in facts and "bills_window_days" not in facts


def test_budget_comes_from_the_snapshot_not_settings():
    # The discretionary budget is the user's Nessie profile; a stale settings value must not leak in.
    snapshot = {"balance": 1400, "monthly_bills": 700, "budget": 800, "spent_this_month": 150}
    state = {"settings": {"buffer_target": 300, "mode": "aware", "floor": 70, "budget": 400}}
    facts = score.evaluate(snapshot, {"price": 180}, state)
    assert facts["budget_left_after"] == 470
    assert facts["score_before"] == score.compute_components(**{**BASE, "budget": 800}).total


def test_llm_guard_rejects_invented_numbers():
    facts = {"score_before": 89, "score_after": 62, "monthly_bills": 700}
    assert llm.numbers_are_grounded("Your score drops from 89 to 62.", facts)
    assert not llm.numbers_are_grounded("You'll be broke in 3 days.", facts)


def test_llm_guard_accepts_reformatted_money():
    facts = {"budget_left_after": 70.0, "monthly_bills": 1200}
    assert llm.numbers_are_grounded("That leaves $70.00, with $1,200 in bills.", facts)


def test_template_used_without_api_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    snapshot = {"balance": 1400, "monthly_bills": 700, "budget": 400, "spent_this_month": 150}
    state = {"settings": {"buffer_target": 300, "mode": "strict", "floor": 70}}
    facts = score.evaluate(snapshot, {"price": 180}, state)
    text = llm.explain(facts)
    assert text == llm.template_message(facts)
    assert llm.numbers_are_grounded(text, facts)


def test_monthly_bills_counts_recurring_and_this_months_pending():
    today = date(2026, 10, 24)
    bills = [
        {"status": "recurring", "upcoming_payment_date": "2026-11-01", "payment_amount": 700},
        {"status": "recurring", "payment_date": "2026-12-15", "payment_amount": 15.49},  # monthly whatever the date
        {"status": "pending", "payment_date": "2026-10-30", "payment_amount": 50},  # one-off, due this month
        {"status": "pending", "payment_date": "2026-11-20", "payment_amount": 60},  # one-off, next month
        {"status": "completed", "payment_date": "2026-10-30", "payment_amount": 90},  # already paid
    ]
    assert monthly_bills(bills, today) == 765.49


def test_monthly_bills_is_zero_without_bills():
    assert monthly_bills([], date(2026, 10, 24)) == 0
