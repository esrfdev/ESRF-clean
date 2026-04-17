#!/usr/bin/env python3
"""Add news.section_national and news.section_european keys to all 27 locale files."""
import json
import os

TRANSLATIONS = {
    "bg": ("От вашата страна", "От континента"),
    "cs": ("Z vaší země", "Z kontinentu"),
    "da": ("Fra dit land", "Fra kontinentet"),
    "de": ("Aus Ihrem Land", "Vom Kontinent"),
    "el": ("Από τη χώρα σας", "Από την ήπειρο"),
    "en": ("From your country", "From the continent"),
    "es": ("Desde su país", "Desde el continente"),
    "et": ("Teie riigist", "Kontinendilt"),
    "fi": ("Maastasi", "Mantereelta"),
    "fr": ("De votre pays", "Du continent"),
    "ga": ("Ó do thír", "Ón mór-roinn"),
    "hr": ("Iz vaše zemlje", "S kontinenta"),
    "hu": ("Az Ön országából", "A kontinensről"),
    "is": ("Frá þínu landi", "Frá álfunni"),
    "it": ("Dal vostro paese", "Dal continente"),
    "lt": ("Iš jūsų šalies", "Iš žemyno"),
    "lv": ("No jūsu valsts", "No kontinenta"),
    "mt": ("Minn pajjiżek", "Mill-kontinent"),
    "nl": ("Uit uw land", "Van het continent"),
    "no": ("Fra ditt land", "Fra kontinentet"),
    "pl": ("Z Twojego kraju", "Z kontynentu"),
    "pt": ("Do seu país", "Do continente"),
    "ro": ("Din țara dumneavoastră", "De pe continent"),
    "sk": ("Z vašej krajiny", "Z kontinentu"),
    "sl": ("Iz vaše države", "S celine"),
    "sv": ("Från ditt land", "Från kontinenten"),
    "uk": ("З вашої країни", "З континенту"),
}

BASE = os.path.join(os.path.dirname(__file__), "..", "i18n")
BASE = os.path.abspath(BASE)

for lang, (nat, eur) in TRANSLATIONS.items():
    path = os.path.join(BASE, f"{lang}.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    news = data.setdefault("news", {})
    news["section_national"] = nat
    news["section_european"] = eur
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"[{lang}] {nat!r} / {eur!r}")

print(f"\nDone. Updated {len(TRANSLATIONS)} locales.")
