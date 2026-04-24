#!/usr/bin/env python3
"""Validate companies_extracted.json and the i18n tag taxonomy.

Checks:
  - JSON parses; every org is a dict; required fields present (name, country).
  - Every sector_normalized is a known canonical sector.
  - Every Emergency & Crisis Response org has a non-empty secondary_tags list.
  - No non-Emergency org carries secondary_tags (keep scope clean).
  - Every tag value is in the canonical taxonomy; no duplicates per org.
  - en.json and nl.json carry a label for every canonical tag under tag.*.
  - No org carries forbidden operationally-sensitive fields (capacity,
    inventory, roster, deployment_status, private_phone, private_email,
    critical_dependency, etc.) — see FORBIDDEN_FIELDS.
  - Free-text description_en does not contain obvious operational intel
    markers (stockpile counts, exact bed/vehicle capacity, private phone
    numbers, private emails, single-point-of-failure language).

Exits non-zero on any issue. Run from repo root:
  python3 scripts/validate_atlas_data.py
"""
from __future__ import annotations
import json
import re
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

# Fields that must never appear on an org record. The Atlas publishes
# organisation-level public information only — no operational intelligence.
FORBIDDEN_FIELDS = {
    "capacity",
    "capacity_beds",
    "capacity_vehicles",
    "inventory",
    "stockpile",
    "stockpile_count",
    "roster",
    "deployment_roster",
    "deployment_status",
    "readiness",
    "readiness_level",
    "on_call",
    "volunteer_count",
    "staff_count",
    "personnel_count",
    "private_phone",
    "private_email",
    "contact_person",
    "contact_chain",
    "critical_dependency",
    "dependencies",
    "vulnerability",
    "vulnerabilities",
    "single_point_of_failure",
    "facility_access",
    "access_codes",
}

# Sensitive markers in free-text descriptions. These patterns flag
# organisationally-sensitive wording rather than normal public prose.
# The goal is to catch accidental leaks (a well-meaning contributor
# pasting "we hold 500 cots in our warehouse") without blocking normal
# org descriptions that mention founding years, member counts, etc.
SENSITIVE_TEXT_PATTERNS = [
    (re.compile(
        r"\b(deployment\s+roster|on-?call\s+roster|stockpile\s+count"
        r"|readiness\s+level|single\s+point\s+of\s+failure"
        r"|critical\s+dependency|key\s+vulnerability|access\s+code)\b",
        re.I,
    ), "operational_intel_term"),
    # Require a leading quantifier phrase so "Mi-24 helicopters" (model)
    # doesn't match but "holds 200 cots" or "stockpile of 50 ventilators" do.
    (re.compile(
        r"\b(?:stockpile(?:s|d)?\s+of|holds?|stores?|maintains?\s+a\s+"
        r"stockpile\s+of|capacity\s+of|with\s+capacity\s+for)\s+\d{2,}\s+"
        r"(cots|stretchers|body\s*bags|ventilators|ambulances|"
        r"helicopters|patrol\s+boats)\b",
        re.I,
    ), "exact_capacity_number"),
    # Private phone: bare E.164 with no country/org website context nearby
    # is almost always a personal line. Well-known public numbers like 112,
    # 113, 116 000 helplines are short and don't match this pattern.
    (re.compile(r"\+\d{2,3}\s?\d{2,3}\s?\d{3,}\s?\d{3,}"), "private_phone_number"),
    (re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"), "private_email"),
]

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

        # Reject any forbidden operational-intel field on any org row.
        forbidden_here = set(org.keys()) & FORBIDDEN_FIELDS
        if forbidden_here:
            problems.append(
                f"row {i} ({org.get('name','?')}): forbidden sensitive field(s): "
                + ", ".join(sorted(forbidden_here))
            )

        # Scan free-text description for obvious operational intel leaks.
        desc = org.get("description_en") or ""
        if isinstance(desc, str) and desc:
            for rx, kind in SENSITIVE_TEXT_PATTERNS:
                m = rx.search(desc)
                if m:
                    problems.append(
                        f"row {i} ({org.get('name','?')}): description flagged "
                        f"[{kind}]: {m.group(0)!r}"
                    )

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
