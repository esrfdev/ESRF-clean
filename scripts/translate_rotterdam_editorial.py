#!/usr/bin/env python3
"""
Translate the `editorial_rotterdam_weerbaarheid_2026` long-form block into
every supported locale's i18n JSON file.

Source of truth: Dutch (nl.json).
Canonical intermediate: English (EN).

Strategy:
  - nl         → left untouched (source language).
  - en, de, fr, es, it, pt → full native translations for every key
    (body + chrome). Files live under scripts/rotterdam_translations/<lang>.json.
  - all other locales (bg cs da el et fi ga hr hu is lt lv mt no pl
    ro sk sl sv uk) → native chrome only (hero / meta / tags / byline /
    join row); body keys fall back to English, matching the repo's own
    publish_editorial.py convention when DeepL is unavailable.
    Chrome for these locales lives in scripts/rotterdam_translations/_chrome.json.

Running the script is idempotent: it writes each locale's sub-block in place,
preserving every other key in the i18n JSON and preserving insertion order.

Usage:
    python3 scripts/translate_rotterdam_editorial.py
"""

from __future__ import annotations

import json
import os
import sys
from collections import OrderedDict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
I18N_DIR = os.path.join(ROOT, "i18n")
TRANS_DIR = os.path.join(ROOT, "scripts", "rotterdam_translations")
BLOCK_KEY = "editorial_rotterdam_weerbaarheid_2026"

LANGS = [
    "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "ga",
    "hr", "hu", "is", "it", "lt", "lv", "mt", "nl", "no", "pl", "pt",
    "ro", "sk", "sl", "sv", "uk",
]

FULLY_TRANSLATED = {"en", "de", "fr", "es", "it", "pt"}

# Keys that must stay native (not fall back to English) for locales that only
# carry chrome translations.
CHROME_KEYS = {
    "title_tag", "meta_desc", "kicker",
    "hero_title_1", "hero_title_2", "hero_subtitle", "hero_deck",
    "tag_stewardship", "byline", "h2_refs",
    "join_title_html", "join_sub", "join_cta",
    "tag_1", "tag_2", "tag_3", "tag_4",
}


def load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh, object_pairs_hook=OrderedDict)


def dump_json(path: str, data) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def build_locale_block(lang: str, nl_block: OrderedDict,
                       en_block: OrderedDict, lang_data: dict) -> OrderedDict:
    """Produce the full sub-block for `lang`, preserving nl key order."""
    out = OrderedDict()
    for key in nl_block.keys():
        if lang == "nl":
            out[key] = nl_block[key]
            continue

        # Full-translation locales: use their native value for every key.
        if lang in FULLY_TRANSLATED:
            if key in lang_data:
                out[key] = lang_data[key]
            else:
                # Missing key in translation file — fall back to EN then NL.
                out[key] = en_block.get(key, nl_block[key])
            continue

        # Chrome-only locales: native for chrome keys, EN for everything else.
        if key in CHROME_KEYS and key in lang_data:
            out[key] = lang_data[key]
        else:
            out[key] = en_block.get(key, nl_block[key])

    return out


def validate_block(lang: str, block: OrderedDict, nl_block: OrderedDict) -> list:
    """Sanity checks. Returns a list of issues (empty = OK)."""
    issues: list[str] = []

    # Every nl key must exist.
    for key in nl_block.keys():
        if key not in block:
            issues.append(f"{lang}.{key}: missing")
            continue

        value = block[key]
        nl_value = nl_block[key]

        # HTML footnote marker must survive in p_html_* keys.
        if "<sup><a href=\"#ref-1\">" in nl_value and \
                "<sup><a href=\"#ref-1\">" not in value:
            issues.append(f"{lang}.{key}: lost footnote sup/a markup")

        # join_title_html <br> and <i> tags must survive.
        if key == "join_title_html":
            for tag in ("<br>", "<i>", "</i>"):
                if tag in nl_value and tag not in value:
                    issues.append(f"{lang}.{key}: lost {tag}")

    return issues


def main() -> int:
    nl_path = os.path.join(I18N_DIR, "nl.json")
    nl_full = load_json(nl_path)
    nl_block = nl_full[BLOCK_KEY]

    # Load full-translation files.
    full_translations: dict[str, dict] = {}
    for lang in FULLY_TRANSLATED:
        path = os.path.join(TRANS_DIR, f"{lang}.json")
        if not os.path.exists(path):
            print(f"ERROR: missing translation file {path}", file=sys.stderr)
            return 1
        full_translations[lang] = load_json(path)

    en_block = full_translations["en"]

    # Load chrome translations for partial locales.
    chrome_path = os.path.join(TRANS_DIR, "_chrome.json")
    chrome_data: dict[str, dict] = load_json(chrome_path)

    all_issues: list[str] = []

    for lang in LANGS:
        i18n_path = os.path.join(I18N_DIR, f"{lang}.json")
        data = load_json(i18n_path)

        if lang in FULLY_TRANSLATED:
            lang_data = full_translations[lang]
        elif lang == "nl":
            lang_data = {}
        else:
            lang_data = chrome_data.get(lang, {})
            if not lang_data:
                print(f"WARN: no chrome data for {lang}", file=sys.stderr)

        new_block = build_locale_block(lang, nl_block, en_block, lang_data)

        issues = validate_block(lang, new_block, nl_block)
        if issues:
            all_issues.extend(issues)

        data[BLOCK_KEY] = new_block
        dump_json(i18n_path, data)
        print(f"  ✓ {lang}: wrote {len(new_block)} keys")

    if all_issues:
        print("\nValidation issues:", file=sys.stderr)
        for issue in all_issues:
            print(f"  - {issue}", file=sys.stderr)
        return 2

    print(f"\n✓ Updated {len(LANGS)} locales with no structural issues.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
