"""The system prompts, the per-customer persona, and the purchase history Claude gets for linking."""

from fastapi.testclient import TestClient

import app as server
import llm

client = TestClient(server.app)


def test_every_prompt_carries_the_shared_sections():
    for section in (llm.ROLE, llm.STANCE, llm.INFORM, llm.ANGLES, llm.LINKING, llm.RULES):
        assert section in llm.system_prompt()
    for prompt in (llm.chat_system_prompt(), llm.chat_system_prompt(final=True)):
        for section in (llm.ROLE, llm.STANCE, llm.ANGLES, llm.LINKING, llm.JUDGE, llm.JUDGE_FORMAT):
            assert section in prompt
        # In chat Claude is the judge, so the "you don't decide" lines are swapped out.
        assert llm._RULES_NOT_DECIDING not in prompt and llm._CHAT_NO_CHANGE not in prompt
    assert llm.FINAL_TURN_JUDGE in llm.chat_system_prompt(final=True)
    assert llm.FINAL_TURN_JUDGE not in llm.chat_system_prompt()


def test_judgment_parsing_fails_closed():
    assert llm.parse_judgment('{"reply": "Approved, go ahead.", "approved": true}') == ("Approved, go ahead.", True)
    fenced = '```json\n{"reply": "Not yet.", "approved": false}\n```'
    assert llm.parse_judgment(fenced) == ("Not yet.", False)
    for bad in (None, "", "Sure, approved!", '{"reply": "x"}', '{"reply": "x", "approved": "yes"}'):
        assert llm.parse_judgment(bad) is None


def test_ungrounded_or_leaky_approvals_are_refused(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    facts = {"price": 180, "monthly_bills": 700, "budget_left_after": 70, "action": "nudge"}
    for text in ('{"reply": "Approved, and you will save 500 dollars.", "approved": true}',   # invented number
                 '{"reply": "Your score is fine, approved.", "approved": true}',              # mentions the score
                 'Approved!'):                                                                 # not JSON
        monkeypatch.setattr(llm, "_ask_claude", lambda system, messages, text=text: text)
        reply, approved = llm.chat(facts, "Headphones", [{"role": "user", "content": "please"}])
        assert approved is False and reply.startswith("Here's where your money stands.")


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
