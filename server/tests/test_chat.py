from fastapi.testclient import TestClient

import app as server
import llm

client = TestClient(server.app)
PURCHASE = {"title": "Headphones", "price": 180}


def history_with(user_turns: int) -> list[dict]:
    history = []
    for _ in range(user_turns):
        history += [{"role": "assistant", "content": "..."}, {"role": "user", "content": "but I need it"}]
    return history


def test_history_must_end_with_user():
    r = client.post("/chat", json={"purchase": PURCHASE, "history": [{"role": "assistant", "content": "Hi"}]})
    assert r.status_code == 400


def test_chat_falls_back_without_api_key(bank):
    r = client.post("/chat", json={"purchase": PURCHASE, "history": history_with(1)})
    assert r.status_code == 200
    assert r.json()["reply"].startswith("Here's where your money stands.")
    assert r.json()["done"] is False


def test_last_allowed_reply_wraps_up_and_closes_the_chat(bank):
    assert client.post("/chat", json={"purchase": PURCHASE, "history": history_with(server.MAX_USER_TURNS - 1)}
                       ).json()["done"] is False
    last = client.post("/chat", json={"purchase": PURCHASE, "history": history_with(server.MAX_USER_TURNS)}).json()
    assert last["done"] is True
    assert "your call" in last["reply"]


def test_turn_cap_is_enforced_server_side(bank):
    r = client.post("/chat", json={"purchase": PURCHASE, "history": history_with(server.MAX_USER_TURNS + 1)})
    assert r.json()["done"] is True


def test_wrap_up_never_reveals_the_cap_or_score(bank):
    for n in (server.MAX_USER_TURNS, server.MAX_USER_TURNS + 1):
        reply = client.post("/chat", json={"purchase": PURCHASE, "history": history_with(n)}).json()["reply"]
        assert not llm.mentions_internals(reply)
        assert not any(w in reply.lower() for w in ("limit", "last message", "replies"))
