#!/usr/bin/env python3
"""Generate live counts from companies_extracted.json and refresh every
hardcoded fallback copy of those numbers across the site.

Source of truth: companies_extracted.json

Outputs:
  • data/counts.json — generated, machine-readable, consumed by CI /
    validators.  Structure:
      {
        "total": 2383,
        "countries": 30,
        "sectors": 10,
        "by_sector": {"Emergency & Crisis Response": 575, ...},
        "by_country": {"Netherlands": 187, ...},
        "by_country_sector": {"Netherlands||Security & Protection": 40, ...},
        "sectors_by_country": {"Netherlands": 10, ...},
        "generated_at": "2026-04-24"
      }

Refreshes:
  • counters.js                 — FALLBACK block (total/countries/sectors/bySector)
  • i18n/i18n.js                — TOKEN_FALLBACK constant
  • *.html                      — text inside <span data-count="KEY">N</span>
                                  and content="…" of meta[data-count-template]
                                  elements (recomputed from template).
  • countries/<slug>/index.html — per-country fallbacks for country,
                                  country-sector and country-sectors tokens.

These HTML fallbacks are what non-JS scrapers (search engines, WhatsApp,
Slack, social previews) see, so they must match the live dataset.

Why a script, not runtime-only?
  The site is static and must survive scrapers that never execute JS.
  Runtime interpolation via counters.js keeps the browser view live,
  but every scraper-visible copy needs to be baked in at publish time.

Run from repo root:
  python3 scripts/generate_counts.py
  python3 scripts/generate_counts.py --check   # CI-mode, fail if drift

Exit codes: 0 = success / no drift, 1 = drift detected (only in --check).
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DATA = REPO / "companies_extracted.json"
COUNTS_FILE = REPO / "data" / "counts.json"
COUNTERS_JS = REPO / "counters.js"
I18N_JS = REPO / "i18n" / "i18n.js"

# Files to scan for data-count spans and meta[data-count-template] tags.
# Keep this explicit — never walk .git, .well-known, etc.
HTML_GLOBS = [
    "*.html",
    "countries/*.html",
    "countries/*/*.html",
    "editorials/**/*.html",
]


# ────────────────────────────────────────────────────────────────
# Compute current counts from the source dataset
# ────────────────────────────────────────────────────────────────
def compute_counts() -> dict:
    orgs = json.loads(DATA.read_text(encoding="utf-8"))
    by_sector: Counter[str] = Counter()
    by_country: Counter[str] = Counter()
    by_country_sector: Counter[str] = Counter()
    sector_sets: dict[str, set[str]] = defaultdict(set)

    for o in orgs:
        s = o.get("sector_normalized") or o.get("sector") or "—"
        cn = o.get("country_name_en") or o.get("country") or "—"
        by_sector[s] += 1
        by_country[cn] += 1
        by_country_sector[f"{cn}||{s}"] += 1
        sector_sets[cn].add(s)

    return {
        "total": len(orgs),
        "countries": len(by_country),
        "sectors": len(by_sector),
        "by_sector": dict(sorted(by_sector.items(), key=lambda x: (-x[1], x[0]))),
        "by_country": dict(sorted(by_country.items())),
        "by_country_sector": dict(sorted(by_country_sector.items())),
        "sectors_by_country": {k: len(v) for k, v in sorted(sector_sets.items())},
        "generated_at": _dt.date.today().isoformat(),
    }


# ────────────────────────────────────────────────────────────────
# Formatters
# ────────────────────────────────────────────────────────────────
# The HTML fallbacks use en-US grouping (comma) because every single
# page is served as lang="en" in the source HTML; counters.js swaps the
# displayed locale at runtime. Keep the source of truth consistent.
def fmt_en(n: int) -> str:
    return f"{n:,}"


# ────────────────────────────────────────────────────────────────
# Refresh counters.js FALLBACK block
# ────────────────────────────────────────────────────────────────
def refresh_counters_js(counts: dict, dry: bool) -> tuple[bool, str | None]:
    text = COUNTERS_JS.read_text(encoding="utf-8")
    orig = text

    # total / countries / sectors scalar fields
    text = re.sub(
        r"(const FALLBACK\s*=\s*\{\s*\n\s*total:\s*)\d+",
        lambda m: m.group(1) + str(counts["total"]),
        text,
        count=1,
    )
    text = re.sub(
        r"(const FALLBACK\s*=\s*\{[^}]*?\n\s*countries:\s*)\d+",
        lambda m: m.group(1) + str(counts["countries"]),
        text,
        count=1,
        flags=re.DOTALL,
    )
    text = re.sub(
        r"(const FALLBACK\s*=\s*\{[^}]*?\n\s*sectors:\s*)\d+",
        lambda m: m.group(1) + str(counts["sectors"]),
        text,
        count=1,
        flags=re.DOTALL,
    )

    # bySector block — rewrite from canonical order (desc by count).
    by_sector_lines = [
        f"      {json.dumps(name)}: {n},"
        for name, n in counts["by_sector"].items()
    ]
    new_block = "    bySector: {\n" + "\n".join(by_sector_lines) + "\n    },"
    text = re.sub(
        r"    bySector:\s*\{[^}]*\},",
        new_block,
        text,
        count=1,
        flags=re.DOTALL,
    )

    if text == orig:
        return False, None
    if not dry:
        COUNTERS_JS.write_text(text, encoding="utf-8")
    return True, "counters.js"


# ────────────────────────────────────────────────────────────────
# Refresh i18n/i18n.js TOKEN_FALLBACK
# ────────────────────────────────────────────────────────────────
def refresh_i18n_js(counts: dict, dry: bool) -> tuple[bool, str | None]:
    text = I18N_JS.read_text(encoding="utf-8")
    orig = text
    new_line = (
        f"const TOKEN_FALLBACK = {{ total: {counts['total']}, "
        f"countries: {counts['countries']}, sectors: {counts['sectors']} }};"
    )
    text = re.sub(r"const TOKEN_FALLBACK\s*=\s*\{[^}]*\};", new_line, text, count=1)
    if text == orig:
        return False, None
    if not dry:
        I18N_JS.write_text(text, encoding="utf-8")
    return True, "i18n/i18n.js"


# ────────────────────────────────────────────────────────────────
# Refresh HTML data-count spans and meta[data-count-template] contents
# ────────────────────────────────────────────────────────────────
DATA_COUNT_ELEM = re.compile(
    r'(<(?:span|strong|div|p|td|li|b|em|h\d)[^>]*?\bdata-count="([^"]+)"[^>]*>)'
    r"([^<]*)"
    r"(</(?:span|strong|div|p|td|li|b|em|h\d)>)",
    flags=re.IGNORECASE,
)

META_TEMPLATE_ELEM = re.compile(
    r'(<meta\b[^>]*\bcontent=")([^"]*)("[^>]*\bdata-count-template=")([^"]*)("[^>]*/?>)',
    flags=re.IGNORECASE,
)
# Some files place data-count-template BEFORE content. Handle both orders.
META_TEMPLATE_ELEM_ALT = re.compile(
    r'(<meta\b[^>]*\bdata-count-template=")([^"]*)("[^>]*\bcontent=")([^"]*)("[^>]*/?>)',
    flags=re.IGNORECASE,
)

TOKEN_RE = re.compile(r"\{([^}]+)\}")


def resolve_token(token: str, counts: dict) -> str | None:
    """Resolve a single {token} against the generated counts.
    Returns None if unknown → caller should leave the token untouched."""
    t = token.strip()
    if t == "total":
        return fmt_en(counts["total"])
    if t == "countries":
        return fmt_en(counts["countries"])
    if t == "sectors":
        return fmt_en(counts["sectors"])
    if t.startswith("sector:"):
        name = t[len("sector:"):].strip()
        n = counts["by_sector"].get(name)
        return fmt_en(n) if n is not None else None
    if t.startswith("country-sectors:"):
        name = t[len("country-sectors:"):].strip()
        n = counts["sectors_by_country"].get(name)
        return fmt_en(n) if n is not None else None
    if t.startswith("country-sector:"):
        rest = t[len("country-sector:"):].strip()
        n = counts["by_country_sector"].get(rest)
        return fmt_en(n) if n is not None else None
    if t.startswith("country:"):
        name = t[len("country:"):].strip()
        n = counts["by_country"].get(name)
        return fmt_en(n) if n is not None else None
    return None


def interpolate_template(tpl: str, counts: dict) -> str:
    def _sub(m: re.Match) -> str:
        v = resolve_token(m.group(1), counts)
        return v if v is not None else m.group(0)
    return TOKEN_RE.sub(_sub, tpl)


def refresh_data_count_spans(html: str, counts: dict) -> str:
    def _sub(m: re.Match) -> str:
        open_tag, key, inner, close_tag = m.group(1), m.group(2), m.group(3), m.group(4)
        resolved = resolve_token(key, counts)
        if resolved is None:
            return m.group(0)
        # Preserve any whitespace pattern but replace the numeric body.
        # If the inner text contains nested HTML (rare — we matched
        # [^<]* so it shouldn't), skip.
        return f"{open_tag}{resolved}{close_tag}"
    return DATA_COUNT_ELEM.sub(_sub, html)


def refresh_meta_templates(html: str, counts: dict) -> str:
    def _sub(m: re.Match) -> str:
        before_content, _old_content, between, tpl, after = m.groups()
        new_content = interpolate_template(tpl, counts)
        return before_content + new_content + between + tpl + after

    def _sub_alt(m: re.Match) -> str:
        before_tpl, tpl, between, _old_content, after = m.groups()
        new_content = interpolate_template(tpl, counts)
        return before_tpl + tpl + between + new_content + after

    html = META_TEMPLATE_ELEM.sub(_sub, html)
    html = META_TEMPLATE_ELEM_ALT.sub(_sub_alt, html)
    return html


# Free-text phrases outside data-count/data-count-template. We only
# rewrite exact, narrow patterns — never blanket substitutions on
# editorial prose. Hand-maintained editorials can still cite historical
# numbers without us clobbering them.
FREEFORM_PATTERNS = [
    # "Showing 55 of <span data-count="country:X">N</span>" — the
    # 55 is the number of *rendered* cards on the page; don't touch it.
    # But any <span data-count=...>N</span> is already covered.
]


def refresh_html_file(path: Path, counts: dict, dry: bool) -> bool:
    orig = path.read_text(encoding="utf-8")
    text = orig
    text = refresh_data_count_spans(text, counts)
    text = refresh_meta_templates(text, counts)
    if text == orig:
        return False
    if not dry:
        path.write_text(text, encoding="utf-8")
    return True


# ────────────────────────────────────────────────────────────────
# Driver
# ────────────────────────────────────────────────────────────────
def iter_html_files() -> list[Path]:
    files: list[Path] = []
    for pattern in HTML_GLOBS:
        files.extend(sorted(REPO.glob(pattern)))
    # De-duplicate, skip obvious non-site files.
    seen: set[Path] = set()
    out: list[Path] = []
    for f in files:
        if f in seen:
            continue
        seen.add(f)
        if f.name == "index.html" and f.parent == REPO:
            out.append(f); continue
        out.append(f)
    return out


def write_counts_json(counts: dict, dry: bool) -> bool:
    COUNTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(counts, indent=2, ensure_ascii=False) + "\n"
    if COUNTS_FILE.exists():
        old = COUNTS_FILE.read_text(encoding="utf-8")
        if old == payload:
            return False
    if not dry:
        COUNTS_FILE.write_text(payload, encoding="utf-8")
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--check",
        action="store_true",
        help="Do not write files; exit 1 if any would change.",
    )
    ap.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress per-file output.",
    )
    args = ap.parse_args()

    counts = compute_counts()
    changed: list[str] = []

    if write_counts_json(counts, dry=args.check):
        changed.append("data/counts.json")

    c_changed, c_name = refresh_counters_js(counts, dry=args.check)
    if c_changed and c_name: changed.append(c_name)

    i_changed, i_name = refresh_i18n_js(counts, dry=args.check)
    if i_changed and i_name: changed.append(i_name)

    for f in iter_html_files():
        if refresh_html_file(f, counts, dry=args.check):
            changed.append(str(f.relative_to(REPO)))

    summary = (
        f"total={counts['total']} countries={counts['countries']} "
        f"sectors={counts['sectors']}"
    )
    if args.check:
        if changed:
            print(f"[counts] drift detected ({summary}):", file=sys.stderr)
            for f in changed:
                print(f"  ✗ {f}", file=sys.stderr)
            print(
                "Run: python3 scripts/generate_counts.py",
                file=sys.stderr,
            )
            return 1
        if not args.quiet:
            print(f"[counts] OK — {summary}, no drift.")
        return 0

    if not args.quiet:
        if changed:
            print(f"[counts] refreshed ({summary}):")
            for f in changed:
                print(f"  ✓ {f}")
        else:
            print(f"[counts] already current — {summary}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
