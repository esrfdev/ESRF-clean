#!/usr/bin/env python3
"""Validate that every hardcoded count across the site matches the live
counts computed from companies_extracted.json.

Runs generate_counts.py in --check mode and reports drift. Intended for
CI / pre-publish pipelines.

Exit codes:
  0 — no drift; every visible count matches the dataset.
  1 — drift detected (see generate_counts.py output for details).

Run from repo root:
  python3 scripts/validate_counts.py
"""
from __future__ import annotations
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def main() -> int:
    cmd = [sys.executable, str(REPO / "scripts" / "generate_counts.py"), "--check"]
    result = subprocess.run(cmd, cwd=REPO)
    if result.returncode != 0:
        print(
            "\n✗ counts drift detected. Fix with:\n"
            "    python3 scripts/generate_counts.py\n"
            "then commit the refreshed files.",
            file=sys.stderr,
        )
        return 1
    print("✓ all hardcoded counts match companies_extracted.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
