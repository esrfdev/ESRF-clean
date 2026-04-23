#!/usr/bin/env python3
"""
validate_featured_card.py

Guardrail against Dutch leaking into the featured-editorial card on
news.html / index.html (the pages that surface the current featured
editorial to readers in every locale).

Checks:
  1. Neither news.html nor index.html contains the hardcoded Dutch
     fingerprints from the original featured card
     (HARDCODED_DUTCH).
  2. Every locale JSON defines featured.title_html, featured.deck
     and featured.meta, and each value is a non-empty string.
  3. For non-NL locales, the featured.* body values are not identical
     to the NL source (DUTCH_LEAKAGE) — proper-noun / date-only values
     are allowed through a small fingerprint.

Exit codes:
  0 — clean
  1 — one or more violations
  2 — misconfig (missing files / locales)
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
I18N = REPO / "i18n"

# Pages that embed the featured-editorial card.
EMBED_PAGES = ["news.html", "index.html"]

# Dutch phrases that should never appear in source markup on the embed
# pages once the card is bound to i18n keys. Matched literally (case
# sensitive) in the raw HTML, not after rendering.
HARDCODED_DUTCH = [
    "Als het misgaat",
    "Wat Rotterdam Europese steden",
    "niet alleen",   # featured-card-specific italic fragment
    "voor",          # only flagged via the structural literal block below
]

# A tighter regex: the ORIGINAL hardcoded title block inside a
# featured-editorial-title element — catches any re-introduction of the
# Dutch source even if someone tweaks single words.
TITLE_LITERAL_RE = re.compile(
    r'class="featured-editorial-title"[^>]*>\s*<span>[^<]*misgaat[^<]*</span>',
    re.IGNORECASE,
)

# Required i18n keys for the featured-editorial card.
REQUIRED_KEYS = ("featured.title_html", "featured.deck", "featured.meta")


def lookup(obj: dict, dotted: str):
    cur = obj
    for p in dotted.split("."):
        if not isinstance(cur, dict) or p not in cur:
            return None
        cur = cur[p]
    return cur


def check_embed_pages(errors: list[str]) -> None:
    for name in EMBED_PAGES:
        p = REPO / name
        if not p.exists():
            errors.append(f"[MISCONFIG] embed page missing: {name}")
            continue
        text = p.read_text(encoding="utf-8")

        # Narrow to the featured-editorial section only — avoids false
        # positives from other page content that might legitimately
        # contain one of these common Dutch words.
        m = re.search(
            r'(?P<block><section[^>]*class="featured-editorial"[^>]*>.*?</section>)',
            text,
            flags=re.DOTALL,
        )
        block = m.group("block") if m else text

        if TITLE_LITERAL_RE.search(block):
            errors.append(
                f"[HARDCODED_DUTCH] {name}: featured-editorial-title still "
                f"contains the Dutch source literal (matched 'misgaat')."
            )

        for phrase in HARDCODED_DUTCH:
            # 'voor' is a common word — only flag it when it appears
            # as a standalone <span>voor</span>, the original markup.
            if phrase == "voor":
                if re.search(r"<span>\s*voor\s*</span>\s*\.", block):
                    errors.append(
                        f"[HARDCODED_DUTCH] {name}: '<span>voor</span>.' "
                        f"featured-card fragment is still in source markup."
                    )
                continue
            if phrase in block:
                errors.append(
                    f"[HARDCODED_DUTCH] {name}: Dutch fragment found in "
                    f"featured-editorial block: {phrase!r}"
                )


def check_locale_keys(errors: list[str]) -> None:
    if not I18N.exists():
        errors.append(f"[MISCONFIG] i18n dir missing: {I18N}")
        return

    locale_paths = sorted(I18N.glob("*.json"))
    if not locale_paths:
        errors.append(f"[MISCONFIG] no locale JSON in {I18N}")
        return

    nl_path = I18N / "nl.json"
    if not nl_path.exists():
        errors.append("[MISCONFIG] source locale nl.json missing")
        return

    nl = json.loads(nl_path.read_text(encoding="utf-8"))
    nl_vals = {k: lookup(nl, k) for k in REQUIRED_KEYS}

    for p in locale_paths:
        locale = p.stem
        if locale == "i18n":
            continue
        data = json.loads(p.read_text(encoding="utf-8"))

        for key in REQUIRED_KEYS:
            val = lookup(data, key)
            if val is None:
                errors.append(f"[KEY_MISSING] {locale}:{key}")
                continue
            if not isinstance(val, str) or not val.strip():
                errors.append(f"[KEY_EMPTY] {locale}:{key}")
                continue

            # DUTCH_LEAKAGE: non-nl locale repeating nl source verbatim
            if locale != "nl":
                src = nl_vals.get(key)
                if isinstance(src, str) and val.strip() == src.strip():
                    errors.append(
                        f"[DUTCH_LEAKAGE] {locale}:{key} is identical to NL source"
                    )


def main() -> int:
    errors: list[str] = []
    check_embed_pages(errors)
    check_locale_keys(errors)

    print("featured-card i18n validator")
    print(f"  pages checked: {', '.join(EMBED_PAGES)}")
    print(f"  required keys: {', '.join(REQUIRED_KEYS)}")
    print()
    if not errors:
        print("  OK — no violations.")
        return 0

    # Separate misconfig (exit 2) from violations (exit 1)
    misconfig = any(e.startswith("[MISCONFIG]") for e in errors)
    for e in errors:
        print(" ", e)
    print()
    print(f"  total violations: {len(errors)}")
    return 2 if misconfig else 1


if __name__ == "__main__":
    raise SystemExit(main())
