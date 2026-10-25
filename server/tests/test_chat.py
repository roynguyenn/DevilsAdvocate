from fastapi.testclient import TestClient

import app as server

client = TestClient(server.app)
PURCHASE = {"title": "Headphones", "price": 180}


def test_history_must_end_with_user():
    r = client.post("/chat", json={"purchase": PURCHASE, "history": [{"role": "assistant", "content": "Hi"}]})
    assert r.status_code == 400


def test_turn_cap_is_enforced_server_side():
    history = []
    for _ in range(server.MAX_USER_TURNS + 1):
        history += [{"role": "assistant", "content": "..."}, {"role": "user", "content": "but I need it"}]
    r = client.post("/chat", json={"purchase": PURCHASE, "history": history})
    assert r.json()["done"] is True


def test_chat_falls_back_without_api_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    history = [{"role": "assistant", "content": "Score 89 -> 62."}, {"role": "user", "content": "Why?"}]
    r = client.post("/chat", json={"purchase": PURCHASE, "history": history})
    assert r.status_code == 200
    assert r.json()["reply"].startswith("I can only speak to the numbers I have.")
