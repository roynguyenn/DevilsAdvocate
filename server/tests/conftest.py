import sys
from pathlib import Path

# Let tests `import score` the same way app.py does.
sys.path.insert(0, str(Path(__file__).parent.parent))
