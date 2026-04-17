#!/usr/bin/env python3
"""Fase 3 i18n: verwijder pijler-bedrijfsclassificatie en Grenoble-tekst.

Acties per taal-bestand:
  - about.what_body_2_html → nieuwe zin (zonder "pillars")
  - about.pillar{1..5}_body_html → nieuwe zin (zonder bedrijfsaantal)
  - about.pillar{1..5}_sectors → VERWIJDEREN
  - about.name_note / name_note_html → VERWIJDEREN
  - sponsor.tier2_tagline → nieuwe tekst
  - sponsor.tier2_benefit1 → nieuwe tekst
  - sponsor.faq3_a → nieuwe tekst

EN en NL krijgen handmatige vertalingen. Andere talen vallen terug op EN,
en worden later door een subagent correct vertaald. Reden: we laten de
oude (waarschijnlijk correct vertaalde) tekst staan totdat de subagent
ze aanpast, behalve EN/NL die we hier authoritatief zetten.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
I18N = ROOT / "i18n"

# Nieuwe waarden (handmatig NL + EN). Overige talen krijgen EN als placeholder
# die later door een batch-vertaler wordt opgepakt.
UPDATES = {
    "about": {
        "what_body_2_html": {
            "en": "Where governments set policy and international bodies coordinate, ESRF.net unites the <strong>entrepreneurs, institutions and first responders</strong> whose daily practice is the actual substrate of resilience. We classify organisations across ten vital sectors — aligned with the EU NIS2 Directive.",
            "nl": "Waar overheden beleid maken en internationale organen coördineren, verbindt ESRF.net de <strong>ondernemers, instellingen en hulpverleners</strong> wier dagelijkse praktijk de werkelijke grondslag van weerbaarheid vormt. We classificeren organisaties over tien vitale sectoren — conform de EU NIS2-richtlijn.",
        },
        "pillar1_body_html": {
            "en": "To notice before it is loud. The first pillar is the patient, structural attention to signals, scenarios and systemic risks — intelligence that arrives a day too early and never a minute too late.",
            "nl": "Opmerken voordat het luid wordt. De eerste pijler is de geduldige, structurele aandacht voor signalen, scenario’s en systemische risico’s — inzicht dat een dag te vroeg komt en nooit een minuut te laat.",
        },
        "pillar2_body_html": {
            "en": "To guard what sustains us. The second pillar is the discipline of defending physical, digital and institutional perimeters. Stewardship means one does not own what one protects; one holds it for everyone who depends on it.",
            "nl": "Bewaken wat ons draagt. De tweede pijler is de discipline van het verdedigen van fysieke, digitale en institutionele grenzen. Rentmeesterschap betekent dat je niet bezit wat je beschermt; je houdt het vast voor iedereen die erop steunt.",
        },
        "pillar3_body_html": {
            "en": "To stand ready, together. The third pillar is the cultivation of optionality — the capacity to act with confidence when a plan meets weather. Preparedness is not stockpiling; it is the shared competence to adapt.",
            "nl": "Samen paraat staan. De derde pijler is het cultiveren van wendbaarheid — het vermogen om met vertrouwen te handelen wanneer een plan op de werkelijkheid stuit. Voorbereiding is geen voorraad; het is de gedeelde bekwaamheid om te adapteren.",
        },
        "pillar4_body_html": {
            "en": "To act as one when it matters. The fourth pillar is the virtue of arriving — reliably, quickly, together. Solidarity is not a sentiment; it is a practice that must be rehearsed long before it is required.",
            "nl": "Als één handelen wanneer het ertoe doet. De vierde pijler is de deugd van het arriveren — betrouwbaar, snel, samen. Solidariteit is geen gevoel; het is een praktijk die lang voor ze nodig is moet worden geoefend.",
        },
        "pillar5_body_html": {
            "en": "To rise stronger than before. The fifth pillar is the discipline of absorbing shocks and restarting systems. Renewal treats every recovery as an opportunity to fix what the last crisis revealed.",
            "nl": "Sterker opstaan dan voorheen. De vijfde pijler is de discipline van het opvangen van schokken en het herstarten van systemen. Vernieuwing behandelt elk herstel als kans om te repareren wat de vorige crisis blootlegde.",
        },
    },
    "sponsor": {
        "tier2_tagline": {
            "en": "\"Aligned with a vital sector of your choice.\"",
            "nl": "\"Gekoppeld aan een vitale sector naar keuze.\"",
        },
        "tier2_benefit1": {
            "en": "Logo on the sector pages you select",
            "nl": "Logo op de sectorpagina's die je kiest",
        },
        "faq3_a": {
            "en": "Yes — Programme Partner sponsorships can be aligned to a specific vital sector of your choice. If your organisation operates in, say, Critical Infrastructure or Health &amp; Medical Manufacturing, your logo will appear on those section pages. Discuss this in your enquiry and we will tailor the arrangement accordingly.",
            "nl": "Ja — Programme Partner-sponsoring kan worden gekoppeld aan een specifieke vitale sector naar keuze. Als je organisatie actief is in bijvoorbeeld Kritieke Infrastructuur of Gezondheid &amp; Medische Productie, verschijnt je logo op die sectorpagina's. Bespreek dit in je aanvraag en we stemmen de regeling daarop af.",
        },
    },
}

# Keys to DELETE from every language file (pillar sector lines + Grenoble note)
DELETE_KEYS = [
    ("about", "pillar1_sectors"),
    ("about", "pillar2_sectors"),
    ("about", "pillar3_sectors"),
    ("about", "pillar4_sectors"),
    ("about", "pillar5_sectors"),
    ("about", "name_note"),
    ("about", "name_note_html"),
]


def main():
    files = sorted(I18N.glob("*.json"))
    for fp in files:
        lang = fp.stem
        data = json.loads(fp.read_text(encoding="utf-8"))

        # Update existing keys with lang-specific or EN fallback
        for section, keys in UPDATES.items():
            if section not in data:
                data[section] = {}
            for k, trans in keys.items():
                val = trans.get(lang, trans["en"])
                data[section][k] = val

        # Delete pillar_sectors and name_note keys
        for section, key in DELETE_KEYS:
            if section in data and key in data[section]:
                del data[section][key]

        fp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"  ✓ {lang}")

    print(f"Done. Updated {len(files)} files.")


if __name__ == "__main__":
    main()
