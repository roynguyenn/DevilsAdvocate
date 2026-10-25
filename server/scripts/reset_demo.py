"""Restore starting state before every rehearsal:  python scripts/reset_demo.py"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import store  # noqa: E402

store.save_state(store.DEFAULT_STATE)
store.save_commitments([])
print("Demo state reset.")
