"""Print everything Nessie stores for the current demo customer (read-only):  python scripts/show_nessie.py

Same as `nessie_customer.py show <id>` for the customer in data/nessie_ids.json, plus the demo merchant.
"""

import nessie_customer as nc

ids = nc.current()
nc.show(ids["customer_id"])
if ids.get("merchant_id"):
    nc._print("Merchant used for simulated purchases", nc.nessie._get(f"/merchants/{ids['merchant_id']}"))
