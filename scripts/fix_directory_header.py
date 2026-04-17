#!/usr/bin/env python3
"""Fix two header bugs in directory.html across all 27 i18n files.

Bug 1: directory.hero_title contains the FULL sentence (e.g. "The directory
of practice.") while the HTML template separately renders title_word_the +
hero_title + title_word_of_practice. Result: "The The directory of practice.
of practice."
Fix: hero_title = just the center word ("directory") per language.

Bug 2: directory.hero_deck says "One thousand eight hundred and ninety-two
organisations" (1,892) while every other count on the page says 1,890.
Fix: replace the written-out number with the digit "1,890" per locale.
"""
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
I18N = REPO / 'i18n'

# Center word for directory header per language
HERO_TITLE = {
    'bg': 'Директория',
    'cs': 'adresář',
    'da': 'Praksisregisteret',
    'de': 'Verzeichnis',
    'el': 'Ευρετήριο',
    'en': 'directory',
    'es': 'directorio',
    'et': 'kataloog',
    'fi': 'Hakemisto',
    'fr': 'annuaire',
    'ga': 'eolaire',
    'hr': 'Imenik',
    'hu': 'Jegyzék',
    'is': 'Skráin',
    'it': 'Elenco',
    'lt': 'Sąrašas',
    'lv': 'Reģistrs',
    'mt': 'Direttorju',
    'nl': 'praktijkdirectory',
    'no': 'praksisregisteret',
    'pl': 'Katalog',
    'pt': 'Diretório',
    'ro': 'Directorul',
    'sk': 'Adresár',
    'sl': 'Imenik',
    'sv': 'Praktikregister',
    'uk': 'Каталог',
}

# hero_deck replacements: old written-out number → "1,890" (use thousands
# separator consistent with the rest of the page, which uses "1,890").
# Mapping: lang → (old_phrase, new_prefix_before_— organisations)
DECK_OLD_TO_NEW = {
    'bg': ('Хиляда осемстотин деветдесет и две организации', '1890 организации'),
    'cs': ('Tisíc osm set devadesát dvě organizace',        '1 890 organizací'),
    'da': ('Et tusinde ottehundrede og to og halvfems organisationer', '1.890 organisationer'),
    'de': ('Tausendachthundertzweiundneunzig Organisationen', '1.890 Organisationen'),
    'el': ('Χίλιοι οκτακόσιοι ενενήντα δύο οργανισμοί',     '1.890 οργανισμοί'),
    'en': ('One thousand eight hundred and ninety-two organisations', '1,890 organisations'),
    'es': ('Mil ochocientas noventa y dos organizaciones',  '1.890 organizaciones'),
    'et': ('Üks tuhat kaheksasada üheksakümmend kaks organisatsiooni', '1890 organisatsiooni'),
    'fi': ('Tuhat kahdeksansataayhdeksänkymmentäkaksi organisaatiota', '1 890 organisaatiota'),
    'fr': ('Mille huit cent quatre-vingt-douze organisations', '1 890 organisations'),
    'ga': ('Míle ocht gcéad nócha dó eagraíocht',           '1,890 eagraíocht'),
    'hr': ('Tisuću osiamsto devedeset i dvije organizacije', '1.890 organizacija'),
    'hu': ('Egyezernyolcszázkilencvenkettő szervezet',      '1890 szervezet'),
    'is': ('Þúsund og níu hundruð og níutíu og tvær stofnanir', '1.890 stofnanir'),
    'it': ('Milleottocentonovantadue organizzazioni',       '1.890 organizzazioni'),
    'lt': ('Tūkstantis aštuoni šimtai devyniasdešimt dvi organizacijos', '1 890 organizacijų'),
    'lv': ('Tūkstoš astoņi simti deviņdesmit divas organizācijas', '1890 organizācijas'),
    'mt': ('Elf u tmien mitt u tnejn u disgħin organizzazzjoni', '1,890 organizzazzjoni'),
    'nl': ('Eenduizend achthonderdtweeënnegentig organisaties', '1.890 organisaties'),
    'no': ('Et tusen åtte hundre og nittito organisasjoner', '1 890 organisasjoner'),
    'pl': ('Tysiąc osiemset dziewięćdziesiąt dwie organizacje', '1890 organizacji'),
    'pt': ('Mil oitocentas e noventa e duas organizações',  '1.890 organizações'),
    'ro': ('O mie opt sute nouăzeci și două de organizații', '1.890 de organizații'),
    'sk': ('Tisíc osemsto deväťdesiatdvě organizácií',      '1 890 organizácií'),
    'sl': ('Tisoč osemsto dvaindevetdeset organizacij',     '1.890 organizacij'),
    'sv': ('Et tusen åttahundra nittiotvå organisationer',  '1 890 organisationer'),
    'uk': ("Тисяча вісімсот дев'яносто дві організації",    '1890 організацій'),
}

def main():
    for lang_path in sorted(I18N.glob('*.json')):
        lang = lang_path.stem
        data = json.loads(lang_path.read_text(encoding='utf-8'))

        # Fix hero_title
        if lang in HERO_TITLE and 'directory' in data:
            before = data['directory'].get('hero_title')
            data['directory']['hero_title'] = HERO_TITLE[lang]
            if before != HERO_TITLE[lang]:
                print(f'{lang}: hero_title {before!r} → {HERO_TITLE[lang]!r}')

        # Fix hero_deck
        if lang in DECK_OLD_TO_NEW and 'directory' in data:
            old_phrase, new_phrase = DECK_OLD_TO_NEW[lang]
            deck = data['directory'].get('hero_deck', '')
            if old_phrase in deck:
                data['directory']['hero_deck'] = deck.replace(old_phrase, new_phrase)
                print(f'{lang}: hero_deck — replaced written-out 1892 with {new_phrase!r}')
            else:
                print(f'{lang}: hero_deck — OLD PHRASE NOT FOUND; deck starts with {deck[:60]!r}')

        lang_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')

if __name__ == '__main__':
    main()
