"""Restore starting state before every rehearsal:  python scripts/reset_demo.py

Restores default settings and the seed financial profile in Nessie, clears commitments, and
hides simulated purchases. Nessie can't delete purchases, so they're hidden by ID instead.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

import demo_data  # noqa: E402
import nessie  # noqa: E402

try:
    hidden = demo_data.reset_demo()
except nessie.NessieError as e:
    sys.exit(f"Couldn't reach Nessie ({e}); nothing was reset.")
print(f"Demo state reset. Hid {hidden} simulated purchase(s).")
