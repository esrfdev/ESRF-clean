#!/usr/bin/env python3
"""Assert that every footer rendering of the organisations total is
derived from companies_extracted.json.

Three independent checks, all comparing to len(companies_extracted.json):

  1. data/counts.json     — "total" field
  2. counters.js          — FALLBACK.total literal
  3. i18n/i18n.js         — TOKEN_FALLBACK.total literal
  4. *.html               — every <span data-count="total">N</span>
                            inside or outside a <footer>…</footer>

This is the runtime+build-time safety net requested in the footer-count
regression: the footer number must derive from the same source of truth
the directory/atlas uses to render organisation cards.

Exit codes: 0 = all totals consistent, 1 = mismatch detected.

Run from repo root:
  python3 scripts/test_footer_count.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DATA = REPO / "companies_extracted.json"
COUNTS_JSON = REPO / "data" / "counts.json"
COUNTERS_JS = REPO / "counters.js"
I18N_JS = REPO / "i18n" / "i18n.js"

HTML_GLOBS = [
    "*.html",
    "countries/*.html",
    "countries/*/*.html",
    "editorials/**/*.html",
]

FOOTER_SPAN_RE = re.compile(
    r'<span[^>]*\bdata-count="total"[^>]*>\s*([\d,\.\s]+)\s*</span>',
    flags=re.IGNORECASE,
)
FOOTER_STRONG_RE = re.compile(
    r'<strong[^>]*\bdata-count="total"[^>]*>\s*([\d,\.\s]+)\s*</strong>',
    flags=re.IGNORECASE,
)


def _parse_int(s: str) -> int:
    return int(re.sub(r"[^\d]", "", s))


def main() -> int:
    orgs = json.loads(DATA.read_text(encoding="utf-8"))
    truth = len(orgs)
    failures: list[str] = []

    # 1. data/counts.json
    counts = json.loads(COUNTS_JSON.read_text(encoding="utf-8"))
    if counts.get("total") != truth:
        failures.append(
            f"data/counts.json total={counts.get('total')} != dataset {truth}"
        )

    # 2. counters.js FALLBACK.total
    m = re.search(
        r"const FALLBACK\s*=\s*\{\s*\n\s*total:\s*(\d+)",
        COUNTERS_JS.read_text(encoding="utf-8"),
    )
    if not m:
        failures.append("counters.js: FALLBACK.total literal not found")
    elif int(m.group(1)) != truth:
        failures.append(
            f"counters.js FALLBACK.total={m.group(1)} != dataset {truth}"
        )

    # 3. i18n/i18n.js TOKEN_FALLBACK.total
    m = re.search(
        r"const TOKEN_FALLBACK\s*=\s*\{\s*total:\s*(\d+)",
        I18N_JS.read_text(encoding="utf-8"),
    )
    if not m:
        failures.append("i18n/i18n.js: TOKEN_FALLBACK.total literal not found")
    elif int(m.group(1)) != truth:
        failures.append(
            f"i18n/i18n.js TOKEN_FALLBACK.total={m.group(1)} != dataset {truth}"
        )

    # 4. every <span|strong data-count="total">N</span> across HTML
    files: list[Path] = []
    for pat in HTML_GLOBS:
        files.extend(sorted(REPO.glob(pat)))
    seen: set[Path] = set()
    unique_files = [f for f in files if not (f in seen or seen.add(f))]

    bad_spans: list[tuple[str, int, int]] = []  # (file, line, value)
    for f in unique_files:
        text = f.read_text(encoding="utf-8")
        for rx in (FOOTER_SPAN_RE, FOOTER_STRONG_RE):
            for m in rx.finditer(text):
                val = _parse_int(m.group(1))
                if val != truth:
                    line = text[: m.start()].count("\n") + 1
                    bad_spans.append((str(f.relative_to(REPO)), line, val))
    for fname, line, val in bad_spans:
        failures.append(
            f"{fname}:{line} <*** data-count=\"total\">{val}</***> != dataset {truth}"
        )

    if failures:
        print(
            f"✗ footer-count drift — dataset has {truth} organisations "
            f"but {len(failures)} reference(s) disagree:",
            file=sys.stderr,
        )
        for msg in failures:
            print(f"    {msg}", file=sys.stderr)
        print(
            "\nFix with: python3 scripts/generate_counts.py\n",
            file=sys.stderr,
        )
        return 1

    print(
        f"✓ footer-count consistent — {truth} organisations matches "
        f"data/counts.json, counters.js FALLBACK, i18n/i18n.js "
        f"TOKEN_FALLBACK, and every <… data-count=\"total\"> span."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
