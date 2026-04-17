#!/usr/bin/env python3
"""Replace the three-split directory title keys with one hero_title_html per
language. Removes title_word_the, hero_title, title_word_of_practice.
"""
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
I18N = REPO / 'i18n'

TITLE_HTML = {
    'bg': 'Директория<br>на практиката.',
    'cs': 'Adresář <i>praxe</i>.',
    'da': '<i>Praksisregisteret</i>.',
    'de': 'Das <i>Verzeichnis</i><br>der Praxis.',
    'el': 'Το <i>ευρετήριο</i><br>της πρακτικής.',
    'en': 'The <i>directory</i><br>of practice.',
    'es': 'El <i>directorio</i><br>de la práctica.',
    'et': 'Praktika <i>kataloog</i>.',
    'fi': 'Käytännön <i>hakemisto</i>.',
    'fr': 'L’<i>annuaire</i><br>de la pratique.',
    'ga': '<i>Eolaire</i> na<br>gcleachtóirí.',
    'hr': '<i>Imenik</i> prakse.',
    'hu': 'A gyakorlat <i>jegyzéke</i>.',
    'is': 'Skrá <i>faglegrar</i><br>starfsemi.',
    'it': 'L’<i>elenco</i><br>della pratica.',
    'lt': 'Praktikos <i>katalogas</i>.',
    'lv': 'Prakses <i>katalogs</i>.',
    'mt': 'Id-<i>direttorju</i><br>tal-prattika.',
    'nl': 'De <i>directory</i><br>van de praktijk.',
    'no': '<i>Praksiskatalogen</i>.',
    'pl': '<i>Katalog</i> praktyki.',
    'pt': 'O <i>diretório</i><br>da prática.',
    'ro': '<i>Directorul</i> practicii.',
    'sk': 'Adresár <i>praxe</i>.',
    'sl': '<i>Imenik</i> prakse.',
    'sv': '<i>Praktikregister</i>.',
    'uk': '<i>Каталог</i> практики.',
}

# Keys to delete (replaced by hero_title_html)
OLD_KEYS = ['title_word_the', 'hero_title', 'title_word_of_practice']

def main():
    for lang_path in sorted(I18N.glob('*.json')):
        lang = lang_path.stem
        data = json.loads(lang_path.read_text(encoding='utf-8'))
        d = data.setdefault('directory', {})

        # Set new key
        d['hero_title_html'] = TITLE_HTML.get(lang, TITLE_HTML['en'])

        # Remove old keys
        for k in OLD_KEYS:
            if k in d:
                del d[k]

        lang_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'{lang}: set hero_title_html = {d["hero_title_html"]!r}')

if __name__ == '__main__':
    main()
