#!/usr/bin/env python3
"""Validate companies_extracted.json and the i18n tag taxonomy.

Checks:
  - JSON parses; every org is a dict; required fields present (name, country).
  - Every sector_normalized is a known canonical sector.
  - Every Emergency & Crisis Response org has a non-empty secondary_tags list.
  - No non-Emergency org carries secondary_tags (keep scope clean).
  - Every tag value is in the canonical taxonomy; no duplicates per org.
  - en.json and nl.json carry a label for every canonical tag under tag.*.

Exits non-zero on any issue. Run from repo root:
  python3 scripts/validate_atlas_data.py
"""
from __future__ import annotations
import json
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DATA = REPO / "companies_extracted.json"
I18N = REPO / "i18n"

CANONICAL_TAGS = [
    "Humanitarian aid",
    "Disaster relief",
    "Civil protection",
    "Search & rescue",
    "Shelter & evacuation",
    "Food & basic needs",
    "Volunteer response",
    "Psychosocial support",
    "Community resilience",
    "Crisis response",
]

CANONICAL_SECTORS = {
    "Emergency & Crisis Response",
    "Security & Protection",
    "Risk & Continuity Management",
    "Digital Infrastructure & Cybersecurity",
    "Knowledge, Training & Research",
    "Health & Medical Manufacturing",
    "Critical Infrastructure",
    "Dual-use Technology & Manufacturing",
    "Transport, Maritime & Aerospace",
    "Energy & Grid Resilience",
}

TAG_I18N_KEY = {
    "Humanitarian aid":     "humanitarian_aid",
    "Disaster relief":      "disaster_relief",
    "Civil protection":     "civil_protection",
    "Search & rescue":      "search_rescue",
    "Shelter & evacuation": "shelter_evacuation",
    "Food & basic needs":   "food_basic_needs",
    "Volunteer response":   "volunteer_response",
    "Psychosocial support": "psychosocial_support",
    "Community resilience": "community_resilience",
    "Crisis response":      "crisis_response",
}


def main() -> int:
    problems: list[str] = []

    try:
        data = json.loads(DATA.read_text(encoding="utf-8"))
    except Exception as e:  # pragma: no cover
        print(f"FATAL: companies_extracted.json does not parse: {e}")
        return 2

    if not isinstance(data, list):
        print("FATAL: expected top-level list in companies_extracted.json")
        return 2

    emergency_tagged = 0
    stats: Counter[str] = Counter()

    for i, org in enumerate(data):
        if not isinstance(org, dict):
            problems.append(f"row {i}: not a dict")
            continue
        if not org.get("name"):
            problems.append(f"row {i}: missing name")
        if not org.get("country"):
            problems.append(f"row {i} ({org.get('name','?')}): missing country")
        sector = org.get("sector_normalized")
        if sector not in CANONICAL_SECTORS:
            problems.append(f"row {i} ({org.get('name','?')}): unknown sector {sector!r}")

        tags = org.get("secondary_tags")
        if sector == "Emergency & Crisis Response":
            if not isinstance(tags, list) or not tags:
                problems.append(f"row {i} ({org.get('name','?')}): Emergency org missing secondary_tags")
                continue
            seen: set[str] = set()
            for t in tags:
                if t not in CANONICAL_TAGS:
                    problems.append(f"row {i} ({org.get('name','?')}): unknown tag {t!r}")
                if t in seen:
                    problems.append(f"row {i} ({org.get('name','?')}): duplicate tag {t!r}")
                seen.add(t)
                stats[t] += 1
            emergency_tagged += 1
        else:
            if tags not in (None, [], ()):
                problems.append(
                    f"row {i} ({org.get('name','?')}): non-Emergency org carries secondary_tags"
                )

    # i18n checks
    for lang in ("en", "nl"):
        p = I18N / f"{lang}.json"
        try:
            js = json.loads(p.read_text(encoding="utf-8"))
        except Exception as e:
            problems.append(f"i18n/{lang}.json does not parse: {e}")
            continue
        tag_sec = js.get("tag") or {}
        for canonical, key in TAG_I18N_KEY.items():
            if not tag_sec.get(key):
                problems.append(f"i18n/{lang}.json: missing tag.{key} for {canonical!r}")

    print(f"Orgs total: {len(data)}")
    print(f"Emergency orgs with tags: {emergency_tagged}")
    print("Tag counts:")
    for t in CANONICAL_TAGS:
        print(f"  {stats.get(t,0):>4}  {t}")

    if problems:
        print("")
        print(f"FAILED with {len(problems)} problem(s):")
        for p in problems[:30]:
            print(f"  - {p}")
        if len(problems) > 30:
            print(f"  … and {len(problems)-30} more")
        return 1

    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
