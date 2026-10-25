"""JSON-file state for agent preferences and bookkeeping. One user, one writer.

The user's money (balance, income, bills, savings, purchases) lives in Nessie, not here: see
finances.py and snapshot.py. This file only holds what a bank has no place for.

Writes go to a temp file and then rename, so a crash mid-write can't leave half a file.
"""

import json
import os
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"
STATE = DATA_DIR / "state.json"
COMMITMENTS = DATA_DIR / "commitments.json"

DEFAULT_STATE = {
    "settings": {"buffer_target": 300, "mode": "aware", "floor": 70},
    "regret_penalty": {},
    "blocks_this_week": 0,
    "ignored_nessie_purchases": [],
    # Per Nessie customer, keyed by customer_id: what the bank has no field for (see DEFAULT_CUSTOMER).
    "customers": {},
}

DEFAULT_CUSTOMER = {
    "account_id": None,  # checking account linked in the popup; None means the seeded one
    "intensity": "medium",  # the popup's Agent tab: light | medium | harsh
    "decisions": [],  # one summarized line per finished checkout (decisions.py)
}


def _read(path: Path, default):
    if not path.exists():
        return json.loads(json.dumps(default))  # deep copy so callers can't mutate the default
    return json.loads(path.read_text())


def write_json(path: Path, data) -> None:
    path.parent.mkdir(exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    os.replace(tmp, path)


def load_state() -> dict:
    # Merged over the defaults so state files written before a key existed still load.
    return {**json.loads(json.dumps(DEFAULT_STATE)), **_read(STATE, {})}


def save_state(state: dict) -> None:
    write_json(STATE, state)


def load_customer(customer_id: str) -> dict:
    saved = load_state()["customers"].get(customer_id, {})
    return {**json.loads(json.dumps(DEFAULT_CUSTOMER)), **saved}


def save_customer(customer_id: str, data: dict) -> None:
    state = load_state()
    state["customers"][customer_id] = data
    save_state(state)


def load_commitments() -> list:
    return _read(COMMITMENTS, [])


def save_commitments(items: list) -> None:
    write_json(COMMITMENTS, items)
