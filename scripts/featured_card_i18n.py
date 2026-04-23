#!/usr/bin/env python3
"""
featured_card_i18n.py

Populate featured.title_html, featured.deck and featured.meta in every
i18n/*.json locale, reusing existing editorial translations where possible.

Strategy:
  - title_html = "{hero_title_1} <i>{hero_title_2}</i>."
    (taken from editorial_rotterdam_weerbaarheid_2026.hero_title_1/2 —
     guaranteed present by a previous translation pass across 27 locales)
  - deck       = editorial_rotterdam_weerbaarheid_2026.hero_subtitle
  - meta       = localized "23 Apr 2026 · ESRF.net Editorial · Reading time ±9 min"
    with per-locale "Reading time ±9 min" snippet (see META_READ below).

Safe to re-run: idempotent, preserves key order by merging into existing dict.
"""
from __future__ import annotations

import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
I18N = REPO / "i18n"

# Localized "Reading time ±9 min" (or documented EN fallback).
META_READ = {
    "bg": "Време за четене ±9 мин",
    "cs": "Doba čtení ±9 min",
    "da": "Læsetid ±9 min",
    "de": "Lesezeit ±9 Min.",
    "el": "Χρόνος ανάγνωσης ±9 λεπτά",
    "en": "Reading time ±9 min",
    "es": "Tiempo de lectura ±9 min",
    "et": "Lugemisaeg ±9 min",
    "fi": "Lukuaika ±9 min",
    "fr": "Temps de lecture ±9 min",
    "ga": "Reading time ±9 min",  # EN fallback (DeepL-unsupported)
    "hr": "Reading time ±9 min",  # EN fallback
    "hu": "Olvasási idő ±9 perc",
    "is": "Reading time ±9 min",  # EN fallback
    "it": "Tempo di lettura ±9 min",
    "lt": "Skaitymo laikas ±9 min.",
    "lv": "Lasīšanas laiks ±9 min.",
    "mt": "Reading time ±9 min",  # EN fallback
    "nl": "Leestijd ±9 min",
    "no": "Lesetid ±9 min",
    "pl": "Czas czytania ±9 min",
    "pt": "Tempo de leitura ±9 min",
    "ro": "Timp de lectură ±9 min",
    "sk": "Čas čítania ±9 min",
    "sl": "Čas branja ±9 min",
    "sv": "Lästid ±9 min",
    "uk": "Час читання ±9 хв",
}

DATE = "23 Apr 2026"
PUBLISHER = "ESRF.net Editorial"


def build_featured(locale: str, data: dict) -> dict:
    ed = data.get("editorial_rotterdam_weerbaarheid_2026", {}) or {}
    t1 = ed.get("hero_title_1", "").strip()
    t2 = ed.get("hero_title_2", "").strip()
    subtitle = ed.get("hero_subtitle", "").strip()

    if not t1 or not t2:
        raise SystemExit(
            f"{locale}: missing editorial_rotterdam_weerbaarheid_2026.hero_title_1/2"
        )
    if not subtitle:
        raise SystemExit(
            f"{locale}: missing editorial_rotterdam_weerbaarheid_2026.hero_subtitle"
        )

    # Mirror the editorial page's italic styling: italicize the tail phrase.
    title_html = f"{t1} <i>{t2}</i>."
    meta = f"{DATE} · {PUBLISHER} · {META_READ[locale]}"

    existing = data.get("featured", {}) or {}
    merged = {
        "kicker": existing.get("kicker"),
        "title_html": title_html,
        "deck": subtitle,
        "meta": meta,
        "cta": existing.get("cta"),
    }
    # Drop Nones (in case a locale is missing kicker/cta unexpectedly)
    return {k: v for k, v in merged.items() if v is not None}


def main() -> int:
    locales = sorted(p.stem for p in I18N.glob("*.json"))
    locales = [l for l in locales if l != "i18n"]

    if set(locales) != set(META_READ.keys()):
        missing = set(locales) - set(META_READ.keys())
        extra = set(META_READ.keys()) - set(locales)
        raise SystemExit(
            f"locale set mismatch: missing from META_READ={missing}, "
            f"extra in META_READ={extra}"
        )

    for locale in locales:
        p = I18N / f"{locale}.json"
        with p.open(encoding="utf-8") as f:
            data = json.load(f)
        data["featured"] = build_featured(locale, data)
        with p.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"  updated {locale}.json")

    print(f"\n{len(locales)} locales updated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
