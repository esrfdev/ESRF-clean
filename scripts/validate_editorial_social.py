#!/usr/bin/env python3
"""
validate_editorial_social.py

Structural guardrail for editorial social-share metadata.

For every editorial page (editorial-*.html at repo root) verifies that the
metadata used to generate link previews on LinkedIn, X, Facebook, WhatsApp
and email is present, absolute, on the canonical host, and references an
asset that actually exists in the repo:

  - <link rel="canonical">       — absolute, https://esrf.net (no www)
  - <meta property="og:url">     — same as canonical
  - <meta property="og:image">   — absolute, https://esrf.net, file exists
  - <meta name="twitter:image">  — absolute, https://esrf.net, file exists
  - <meta name="twitter:card">   — present (summary_large_image expected)
  - <meta property="og:title">, og:description, og:type — present, non-empty

assets/share.js builds the share URL from
  document.querySelector('link[rel="canonical"]').href
so a missing canonical is *also* a share-URL bug, not only an OG bug.

Usage:
    python3 scripts/validate_editorial_social.py            # validate all editorials
    python3 scripts/validate_editorial_social.py --page editorial-foo-2026.html

Exit codes:
    0 — all editorials pass
    1 — at least one editorial is missing/has invalid social metadata
    2 — misconfiguration (no editorials found)
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CANONICAL_HOST = "https://esrf.net"

REQUIRED_TAGS = [
    ("canonical", re.compile(r'<link\s+rel="canonical"\s+href="([^"]+)"', re.IGNORECASE)),
    ("og:url", re.compile(r'<meta\s+property="og:url"\s+content="([^"]+)"', re.IGNORECASE)),
    ("og:image", re.compile(r'<meta\s+property="og:image"\s+content="([^"]+)"', re.IGNORECASE)),
    ("twitter:image", re.compile(r'<meta\s+name="twitter:image"\s+content="([^"]+)"', re.IGNORECASE)),
    ("og:title", re.compile(r'<meta\s+property="og:title"\s+content="([^"]+)"', re.IGNORECASE)),
    ("og:description", re.compile(r'<meta\s+property="og:description"\s+content="([^"]+)"', re.IGNORECASE)),
    ("og:type", re.compile(r'<meta\s+property="og:type"\s+content="([^"]+)"', re.IGNORECASE)),
    ("twitter:card", re.compile(r'<meta\s+name="twitter:card"\s+content="([^"]+)"', re.IGNORECASE)),
]

URL_TAGS = {"canonical", "og:url", "og:image", "twitter:image"}
ASSET_TAGS = {"og:image", "twitter:image"}


def validate_editorial(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    errors: list[str] = []

    found: dict[str, str] = {}
    for name, pattern in REQUIRED_TAGS:
        m = pattern.search(text)
        if not m:
            errors.append(f"{path.name}: missing <{name}>")
            continue
        value = m.group(1).strip()
        if not value:
            errors.append(f"{path.name}: <{name}> is empty")
            continue
        found[name] = value

        if name in URL_TAGS:
            if not value.startswith("https://"):
                errors.append(f"{path.name}: <{name}> must be absolute https URL, got {value!r}")
            elif not value.startswith(CANONICAL_HOST + "/") and value != CANONICAL_HOST:
                errors.append(
                    f"{path.name}: <{name}> must use canonical host {CANONICAL_HOST}, "
                    f"got {value!r}"
                )

        if name in ASSET_TAGS and value.startswith(CANONICAL_HOST + "/"):
            rel = value[len(CANONICAL_HOST) + 1:]
            asset = REPO_ROOT / rel
            if not asset.exists():
                errors.append(
                    f"{path.name}: <{name}> references missing asset {rel!r}"
                )

    canonical = found.get("canonical")
    og_url = found.get("og:url")
    if canonical and og_url and canonical != og_url:
        errors.append(
            f"{path.name}: canonical ({canonical!r}) and og:url ({og_url!r}) must match"
        )

    if canonical:
        expected = f"{CANONICAL_HOST}/{path.name}"
        if canonical != expected:
            errors.append(
                f"{path.name}: canonical should be {expected!r}, got {canonical!r}"
            )

    og_image = found.get("og:image")
    twitter_image = found.get("twitter:image")
    if og_image and twitter_image and og_image != twitter_image:
        errors.append(
            f"{path.name}: og:image and twitter:image differ "
            f"({og_image!r} vs {twitter_image!r})"
        )

    return errors


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--page", help="Validate a single editorial filename")
    args = p.parse_args()

    if args.page:
        candidates = [REPO_ROOT / args.page]
    else:
        candidates = sorted(REPO_ROOT.glob("editorial-*.html"))

    candidates = [c for c in candidates if c.exists()]
    if not candidates:
        print("No editorial-*.html pages found at repo root.", file=sys.stderr)
        return 2

    all_errors: list[str] = []
    for path in candidates:
        errs = validate_editorial(path)
        if errs:
            all_errors.extend(errs)
        else:
            print(f"OK  {path.name}")

    if all_errors:
        print("", file=sys.stderr)
        for e in all_errors:
            print(f"FAIL {e}", file=sys.stderr)
        print(f"\n{len(all_errors)} editorial social-metadata error(s).", file=sys.stderr)
        return 1

    print(f"\nAll {len(candidates)} editorial(s) have valid social-share metadata.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
