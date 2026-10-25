"""The system prompts, the per-customer persona, and the purchase history Claude gets for linking."""

from fastapi.testclient import TestClient

import app as server
import llm

client = TestClient(server.app)


def test_every_prompt_carries_the_shared_sections():
    for prompt in (llm.system_prompt(), llm.chat_system_prompt(), llm.chat_system_prompt(final=True)):
        for section in (llm.ROLE, llm.STANCE, llm.INFORM, llm.ANGLES, llm.LINKING, llm.RULES):
            assert section in prompt
    assert llm.FINAL_TURN in llm.chat_system_prompt(final=True)
    assert llm.FINAL_TURN not in llm.chat_system_prompt()


def test_persona_follows_the_agent_setting():
    assert "The Gentle Nudge" in llm.system_prompt("light")
    assert "The Negotiator" in llm.system_prompt("medium")
    assert "The Interrogator" in llm.chat_system_prompt("harsh")
    assert llm.system_prompt("unknown") == llm.system_prompt("medium")


def test_relative_dates_are_written_out():
    now = 10 * server.DAY_MS
    assert server._when(now, now) == "today"
    assert server._when(now - server.DAY_MS, now) == "yesterday"
    assert server._when(now - 4 * server.DAY_MS - 5, now) == "4 days ago"


def test_claude_gets_recent_purchases_but_never_the_score(bank):
    facts = client.post("/evaluate?debug=true", json={"title": "Levi's 501 Jeans", "price": 60}).json()["debug"]
    pub = llm.public_facts(facts)
    recent = pub["recent_purchases"]
    assert recent and set(recent[0]) == {"merchant", "category", "amount", "when"}
    assert recent[0]["when"] in ("today", "yesterday") or recent[0]["when"].endswith("days ago")
    assert not {"score_before", "score_after", "components_after", "floor", "mode"} & set(pub)
    # The number guard accepts amounts and relative dates taken from the history.
    assert llm.numbers_are_grounded(f"You spent ${recent[0]['amount']} at {recent[0]['merchant']} {recent[0]['when']}.", pub)


def test_saved_intensity_picks_the_persona(bank, monkeypatch):
    seen = []
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(llm, "_ask_claude", lambda system, messages: seen.append(system) or None)
    body = {"account_id": bank.ids["account_id"], "monthly_income": 1500, "fixed_bills": 700, "savings": 400,
            "discretionary": 400, "intensity": "harsh"}
    client.put("/profile", json=body)
    client.post("/evaluate", json={"title": "Headphones", "price": 180})
    assert seen and "The Interrogator" in seen[-1]
