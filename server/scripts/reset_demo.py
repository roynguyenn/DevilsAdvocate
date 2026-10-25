"""Restore starting state before every rehearsal:  python scripts/reset_demo.py

Clears settings, commitments and simulated purchases. Nessie can't delete purchases, so the
ones already on the demo account are hidden by ID instead.
"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

import nessie  # noqa: E402
import snapshot  # noqa: E402
import store  # noqa: E402

state = {**json.loads(json.dumps(store.DEFAULT_STATE)), "ignored_nessie_purchases": []}

if os.getenv("NESSIE_KEY") and (snapshot.DATA_DIR / "nessie_ids.json").exists():
    account_id = snapshot._nessie_ids()["account_id"]
    try:
        state["ignored_nessie_purchases"] = [p["_id"] for p in nessie.get_purchases(account_id)]
    except nessie.NessieError as e:
        print(f"Couldn't reach Nessie ({e}); Nessie purchases were not hidden.")

store.save_state(state)
store.save_commitments([])
snapshot.LOCAL_PURCHASES.unlink(missing_ok=True)
print(f"Demo state reset. Hid {len(state['ignored_nessie_purchases'])} Nessie purchase(s).")
