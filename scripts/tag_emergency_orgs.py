#!/usr/bin/env python3
"""Attach secondary_tags to organisations classified under the 'Emergency & Crisis Response' sector.

Tags are assigned conservatively from keyword signals in the organisation name and
English description. The primary sector classification is never changed here.

Canonical tag keys (English, used verbatim in companies_extracted.json):
  - Humanitarian aid
  - Disaster relief
  - Civil protection
  - Search & rescue
  - Shelter & evacuation
  - Food & basic needs
  - Volunteer response
  - Psychosocial support
  - Community resilience
  - Crisis response

Run from repo root:
  python3 scripts/tag_emergency_orgs.py
"""
from __future__ import annotations
import json
import re
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DATA = REPO / "companies_extracted.json"

PRIMARY_SECTOR = "Emergency & Crisis Response"

# Ordered list of canonical secondary tags.
TAGS = [
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

# Keyword rules per tag. Matched case-insensitively against "name + ' ' + description_en".
# Patterns are deliberately conservative; we err on the side of fewer tags per org.
RULES: dict[str, list[str]] = {
    "Humanitarian aid": [
        r"\bhumanitarian\b", r"\bhumanitaire\b", r"\bhumanitair[eä]?\b",
        r"\bred cross\b", r"\bcroix[- ]rouge\b", r"\brode kruis\b",
        r"\bcruz roja\b", r"\bcroce rossa\b", r"\brotes kreuz\b",
        r"\bred crescent\b", r"\bczerwony krzyż\b", r"\bcrveni križ\b",
        r"\bcervenikriz\b", r"\bcervenykriz\b", r"\bcervena hviezda\b",
        r"\bpunane rist\b", r"\bpunainen risti\b", r"\bröda korset\b",
        r"\bчервоний\b",
        r"\bngo\b", r"\brelief society\b",
    ],
    "Disaster relief": [
        r"\bdisaster\b", r"\bcatastroph[ey]\b", r"\bkatastroph[ae]\b",
        r"\bcalamit\w*\b", r"\bramp(?:en)?\b", r"\bflood\b", r"\boverstroming\b",
        r"\bearthquake\b", r"\baardbeving\b", r"\bwildfire\b", r"\bbosbrand\b",
        r"\bforest fire\b", r"\brural fire\b",
        r"\brelief\b", r"\bkriz(?:n\w+)?\b", r"\bkrise\b", r"\bkrizov\w+\b",
    ],
    "Civil protection": [
        r"\bcivil protection\b", r"\bcivil defen[cs]e\b",
        r"\bprotecci[oó]n civil\b", r"\bprotezione civile\b",
        r"\bprotection civile\b", r"\bzivilschutz\b", r"\bbevolkingsbescherming\b",
        r"\bobrana\b", r"\bobrona cywilna\b", r"\bziži\w+ ochrana\b",
        r"\bcivile bescherming\b",
    ],
    "Search & rescue": [
        r"\bsearch[- ]and[- ]rescue\b", r"\bsearch & rescue\b", r"\bsar\b",
        r"\brescue\b", r"\breddings?\b", r"\brettung\b", r"\bsauvetage\b",
        r"\bsocorro\b", r"\bsoccorso\b", r"\bratowni\w+\b", r"\bzachran\w+\b",
        r"\bsvaznamh\b", r"\bpelast\w+\b", r"\bredning\b", r"\blifeboat\b",
        r"\blifeguard\b", r"\bnáufrag\w+\b", r"\bcoast guard\b",
    ],
    "Shelter & evacuation": [
        r"\bshelter\b", r"\bopvang\b", r"\bevacuat\w+\b", r"\bevacué\w*\b",
        r"\bschuilplaats\b", r"\bnotunterkunft\b", r"\bonderdak\b",
        r"\brefuge\b", r"\brefugee\b", r"\basylum\b",
    ],
    "Food & basic needs": [
        r"\bfood bank\b", r"\bfoodbank\b", r"\bvoedselbank\b",
        r"\bbanco alimentare\b", r"\bbanque alimentaire\b",
        r"\btafel\b",  # German Tafel = food bank
        r"\bsoup kitchen\b", r"\bessential supplies\b",
        r"\bbasic needs\b", r"\bbasisbehoeften\b",
    ],
    "Volunteer response": [
        r"\bvolunteer\b", r"\bvolunteering\b", r"\bvrijwillig\w+\b",
        r"\bfreiwillig\w+\b", r"\bbenévol\w+\b", r"\bvolunt[aá]ri\w+\b",
        r"\bfrivillig\w*\b", r"\bochotnic\w+\b", r"\bdobrovoln\w+\b",
        r"\bvapaaehtois\w+\b",
    ],
    "Psychosocial support": [
        r"\bpsychosocial\b", r"\bpsychosoci\w+\b", r"\bmental health\b",
        r"\bgeestelijke gezondheid\b", r"\btrauma\b", r"\bgrief\b",
        r"\bcounselling\b", r"\bcounseling\b", r"\bhelpline\b", r"\bhulplijn\b",
        r"\bcrisis line\b", r"\bsuicide\b", r"\bsuicid\w+\b",
        r"\bdomestic violence\b", r"\bhuiselijk geweld\b",
        r"\bvictim support\b", r"\bslachtofferhulp\b",
        r"\bhuman trafficking\b", r"\bmensenhandel\b",
    ],
    "Community resilience": [
        r"\bcommunity resilience\b", r"\bcommunity-based\b",
        r"\bgemeenschapsweerbaarheid\b", r"\blokale weerbaarheid\b",
        r"\bneighbourhood\b", r"\bbuurthulp\b", r"\bcommunity preparedness\b",
        r"\bresiliencia comunit\w+\b", r"\bresilienza di comunit\w+\b",
        r"\blokalna odporno\w+\b",
    ],
    "Crisis response": [
        r"\bcrisis\b", r"\bcriz[ae]\b", r"\bkriz\w+\b", r"\bemergency response\b",
        r"\bcrisis management\b", r"\bcrisisbeheer\b", r"\bkrisenmanagement\b",
        r"\bgestion de crise\b",
        r"\b112\b",  # European emergency number signifies crisis response
        r"\bemergency services\b", r"\bhulpdiensten\b",
        r"\bnotfall\w+\b", r"\bnoodcentrale\b",
    ],
}

# Pre-compile per tag.
COMPILED = {tag: [re.compile(p, re.IGNORECASE | re.UNICODE) for p in pats]
            for tag, pats in RULES.items()}


# Universal default: every org in Emergency & Crisis Response is by definition part
# of the crisis response umbrella. We still apply specific tags on top.
UNIVERSAL_TAGS = ["Crisis response"]

# Fire services are very common; they are core civil protection + search&rescue.
FIRE_PATTERN = re.compile(
    r"\b(fire (?:brigade|department|service|rescue|zone)|firefight\w+|"
    r"feuerwehr|brandweer|sapeurs[- ]pompiers|pompiers|"
    r"straż pożarna|vigili del fuoco|bomberos|bombeiros|"
    r"hasič\w+|pelastus\w*|brann(?:v[ae]sen)?|brandvæsen|"
    r"razatovarka|tuletor\w+)\b",
    re.IGNORECASE | re.UNICODE,
)


def tags_for(org: dict) -> list[str]:
    hay = " ".join(str(org.get(k, "")) for k in ("name", "description_en")).lower()
    picked: list[str] = []
    for tag, regs in COMPILED.items():
        for r in regs:
            if r.search(hay):
                picked.append(tag)
                break

    # Fire/rescue organisations: ensure Civil protection + Search & rescue.
    if FIRE_PATTERN.search(hay):
        if "Civil protection" not in picked:
            picked.append("Civil protection")
        if "Search & rescue" not in picked:
            picked.append("Search & rescue")

    for t in UNIVERSAL_TAGS:
        if t not in picked:
            picked.append(t)

    # Preserve canonical tag order for determinism.
    order = {t: i for i, t in enumerate(TAGS)}
    picked.sort(key=lambda t: order.get(t, 999))
    return picked


def main() -> int:
    data = json.loads(DATA.read_text(encoding="utf-8"))
    tagged = 0
    stats: Counter[str] = Counter()

    for org in data:
        sector = org.get("sector_normalized")
        if sector != PRIMARY_SECTOR:
            # Do not alter non-Emergency orgs. Remove any stale secondary_tags just in case.
            if "secondary_tags" in org:
                del org["secondary_tags"]
            continue
        picked = tags_for(org)
        # Validate: every tag must be a known canonical value.
        for t in picked:
            if t not in TAGS:
                raise SystemExit(f"Unknown tag produced: {t!r}")
        org["secondary_tags"] = picked
        tagged += 1
        for t in picked:
            stats[t] += 1

    DATA.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    print(f"Tagged {tagged} Emergency organisations")
    print("Tag counts:")
    for t in TAGS:
        print(f"  {stats.get(t,0):>4}  {t}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
