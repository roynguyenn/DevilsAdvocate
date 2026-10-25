"""Create a fake demo customer in the shared Nessie sandbox:  python scripts/seed_nessie.py

Writes the checking/savings accounts, merchants, this month's purchases and the financial
profile from data/seed_data.json, then saves the IDs to data/nessie_ids.json. Fake data only.
Errors never print URLs, because the URL carries the API key.
"""

import random
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

import demo_data  # noqa: E402
import nessie  # noqa: E402
import snapshot  # noqa: E402

# Everyone shares one sandbox, so make the name unique.
last_name = f"Student{random.randint(1000, 9999)}"
try:
    ids = demo_data.seed_customer(demo_data.load_seed(), last_name)
except nessie.NessieError as e:
    sys.exit(f"Seeding failed: {e}")

print("Saved", ids)
snap = snapshot.get_financial_snapshot(ids["account_id"])
print({k: v for k, v in snap.items() if k != "transactions"}, f"{len(snap['transactions'])} transactions")
