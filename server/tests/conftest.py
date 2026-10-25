import sys
from pathlib import Path

import pytest

# Let tests `import score` the same way app.py does.
sys.path.insert(0, str(Path(__file__).parent.parent))

import demo_data  # noqa: E402
import finances  # noqa: E402
import nessie  # noqa: E402
import snapshot  # noqa: E402
import store  # noqa: E402
from fake_nessie import FakeNessie  # noqa: E402


def pytest_configure(config):
    config.addinivalue_line("markers", "live: talks to the real Nessie sandbox (run with NESSIE_LIVE=1)")


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    # Keep every test off the real data/ files, and away from Claude.
    monkeypatch.setattr(store, "STATE", tmp_path / "state.json")
    monkeypatch.setattr(store, "COMMITMENTS", tmp_path / "commitments.json")
    monkeypatch.setattr(finances, "NESSIE_IDS", tmp_path / "nessie_ids.json")
    monkeypatch.setattr(snapshot, "_merchants", {})
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)


@pytest.fixture
def bank(monkeypatch) -> FakeNessie:
    """A fake Nessie seeded from data/seed_data.json exactly like scripts/seed_nessie.py does."""
    fake = FakeNessie()
    monkeypatch.setattr(nessie, "_request", fake.request)
    monkeypatch.setenv("NESSIE_KEY", "test-key")
    # Seeding clamps purchases into the current month, so "spent this month" is $150 whatever today is.
    fake.ids = demo_data.seed_customer(demo_data.load_seed(), "StudentTest")
    return fake
