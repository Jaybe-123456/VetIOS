"""CLI wrapper for the VetIOS flywheel exporter."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))
from vetios_ml.flywheel.aggregate import run_export  # noqa: E402


if __name__ == "__main__":
    print(json.dumps(run_export(), indent=2, sort_keys=True))
