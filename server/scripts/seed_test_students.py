"""Create the five fake test students in the shared Nessie sandbox:  python scripts/seed_test_students.py

Each gets a checking and savings account, merchants, this month's purchases and a financial profile from
data/test_students.json. The server keeps pointing at whoever was current before; switch with the popup's
customer dropdown or scripts/nessie_customer.py use <id>. Fake data only. Never prints the API key.
"""

import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

import demo_data  # noqa: E402
import finances  # noqa: E402
import nessie  # noqa: E402
import score  # noqa: E402
import snapshot  # noqa: E402
import store  # noqa: E402

PRICES = (60, 180, 600)
STRICT = {"settings": {"buffer_target": 300, "mode": "strict", "floor": 70}}
AWARE = {"settings": {"buffer_target": 300, "mode": "aware", "floor": 70}}


def main() -> None:
    data = json.loads((ROOT / "data" / "test_students.json").read_text())
    original = finances.nessie_ids()  # seeding rewrites nessie_ids.json; put it back at the end
    seeded = []
    try:
        for s in data["students"]:
            seed = {"checking_balance": s["checking_balance"], "profile": s["profile"],
                    "merchants": data["merchants"], "purchases": s["purchases"]}
            ids = demo_data.seed_customer(seed, f"{s['last_name']}{random.randint(100, 999)}")
            snap = snapshot.get_financial_snapshot(ids["account_id"])
            verdicts = []
            for price in PRICES:
                aware = score.evaluate(snap, {"price": price}, AWARE)
                strict = score.evaluate(snap, {"price": price}, STRICT)
                verdicts.append(f"${price}: {aware['score_before']}->{aware['score_after']} "
                                f"aware={aware['action']} strict={strict['action']}")
            seeded.append((s, ids, snap, verdicts))
            print(f"Created Test {ids['last_name']} ({ids['customer_id']})")
    except nessie.NessieError as e:
        print(f"Couldn't reach Nessie ({e}); stopped after {len(seeded)} student(s).")
    finally:
        store.write_json(finances.NESSIE_IDS, original)

    print()
    for s, ids, snap, verdicts in seeded:
        print(f"Test {ids['last_name']}  customer {ids['customer_id']}")
        print(f"  {s['story']}")
        print(f"  balance ${snap['balance']:.2f} | budget ${snap['budget']:.2f} | spent ${snap['spent_this_month']:.2f}"
              f" | monthly bills ${snap['monthly_bills']:.2f}")
        for v in verdicts:
            print(f"  {v}")
    print(f"\nServer still points at Test {original.get('last_name', '')}. Switch in the popup's Customer dropdown.")


if __name__ == "__main__":
    main()
