#!/usr/bin/env python3
"""Fase 2 i18n: voeg form-errors, optgroup labels, footer.countries, sponsor-placeholders toe.
EN en NL krijgen handmatige vertalingen, rest valt terug op EN.
"""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
I18N = ROOT / "i18n"

# Structure: section -> key -> {lang: text}
NEW = {
    "form": {
        "optgroup_eu": {
            "en": "EU Member States",
            "nl": "EU-lidstaten",
        },
        "optgroup_other": {
            "en": "Other European Countries",
            "nl": "Overige Europese landen",
        },
        "err_too_fast": {
            "en": "Please take a moment to review the form before submitting.",
            "nl": "Neem even de tijd om het formulier te controleren voordat je het verstuurt.",
        },
        "err_required": {
            "en": "Please fill in all required fields.",
            "nl": "Vul alle verplichte velden in.",
        },
        "err_gdpr": {
            "en": "Please accept the privacy policy to continue.",
            "nl": "Accepteer het privacybeleid om door te gaan.",
        },
        "err_url": {
            "en": "Please enter a valid website URL starting with https:// or http://",
            "nl": "Voer een geldige website-URL in die begint met https:// of http://",
        },
        "err_email": {
            "en": "Please enter a valid email address.",
            "nl": "Voer een geldig e-mailadres in.",
        },
        "err_generic": {
            "en": "An error occurred. Please try again.",
            "nl": "Er is een fout opgetreden. Probeer het opnieuw.",
        },
        "err_network": {
            "en": "Network error — please check your connection and try again.",
            "nl": "Netwerkfout — controleer je verbinding en probeer het opnieuw.",
        },
        "submitting": {
            "en": "Submitting…",
            "nl": "Versturen…",
        },
    },
    "footer": {
        "countries": {
            "en": "Countries",
            "nl": "Landen",
        },
    },
    "sponsor": {
        "placeholder_org": {
            "en": "Your organisation",
            "nl": "Je organisatie",
        },
        "placeholder_message": {
            "en": "Tell us about your organisation and why you'd like to support ESRF.net…",
            "nl": "Vertel ons over je organisatie en waarom je ESRF.net wilt steunen…",
        },
        "sending": {
            "en": "Sending…",
            "nl": "Versturen…",
        },
    },
}

def main():
    files = sorted(I18N.glob("*.json"))
    added_total = 0
    for fp in files:
        lang = fp.stem
        data = json.loads(fp.read_text(encoding="utf-8"))
        changed = False
        for section, keys in NEW.items():
            if section not in data or not isinstance(data[section], dict):
                data[section] = data.get(section) or {}
                changed = True
            for k, translations in keys.items():
                if k in data[section]:
                    continue  # idempotent — al aanwezig
                # lang-specifieke vertaling, anders EN fallback
                val = translations.get(lang, translations["en"])
                data[section][k] = val
                changed = True
                added_total += 1
        if changed:
            fp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"  ✓ {lang}")
    print(f"Done. {added_total} keys added across {len(files)} files.")

if __name__ == "__main__":
    main()
