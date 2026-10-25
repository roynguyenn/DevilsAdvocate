"""JSON-file state. One user, one writer, so no database for the hackathon.

Writes go to a temp file and then rename, so a crash mid-write can't leave half a file.
"""

import json
import os
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"
STATE = DATA_DIR / "state.json"
COMMITMENTS = DATA_DIR / "commitments.json"

DEFAULT_STATE = {
    "settings": {"budget": 400, "buffer_target": 300, "mode": "aware", "floor": 70},
    "regret_penalty": {},
    "blocks_this_week": 0,
}


def _read(path: Path, default):
    if not path.exists():
        return json.loads(json.dumps(default))  # deep copy so callers can't mutate the default
    return json.loads(path.read_text())


def _write(path: Path, data) -> None:
    path.parent.mkdir(exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    os.replace(tmp, path)


def load_state() -> dict:
    return _read(STATE, DEFAULT_STATE)


def save_state(state: dict) -> None:
    _write(STATE, state)


def load_commitments() -> list:
    return _read(COMMITMENTS, [])


def save_commitments(items: list) -> None:
    _write(COMMITMENTS, items)
