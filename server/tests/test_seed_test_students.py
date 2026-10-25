import importlib.util
from pathlib import Path

import finances

SCRIPT = Path(__file__).parent.parent / "scripts" / "seed_test_students.py"


def test_seeds_five_distinct_students_and_keeps_the_current_customer(bank, capsys):
    before = finances.nessie_ids()
    spec = importlib.util.spec_from_file_location("seed_test_students", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.main()
    out = capsys.readouterr().out

    assert finances.nessie_ids() == before  # the server still points at the same customer
    assert len(bank.customers) == 1 + 5
    for name in ("SteadySaver", "RentCrunch", "OverBudget", "ImpulseShopper", "FreshPaycheck"):
        assert f"Test {name}" in out
    # The situations really differ: the comfortable student is approved at $180, the crunched one is held in Strict.
    steady = next(line for line in out.splitlines() if "SteadySaver" in line and "customer" in line)
    lines = out.splitlines()
    i = lines.index(steady)
    assert "$180" in lines[i + 4] and "medium=inform" in lines[i + 4]
    crunch_i = next(j for j, line in enumerate(lines) if "RentCrunch" in line and "customer" in line)
    assert "harsh=block" in lines[crunch_i + 3]
