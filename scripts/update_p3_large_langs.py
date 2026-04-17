#!/usr/bin/env python3
"""Update the 9 phase-3 translated keys in the 15 large-file languages.
Assumes target files already have correct nested structure; only sets the 9 keys.
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
I18N = REPO / 'i18n'

LARGE_LANGS = ['de', 'fr', 'es', 'it', 'pt', 'pl', 'cs', 'sk', 'hu', 'ro', 'da', 'sv', 'no', 'fi', 'is']

BANNED_ABOUT = {
    'name_note', 'name_note_html',
    'pillar1_sectors', 'pillar2_sectors', 'pillar3_sectors',
    'pillar4_sectors', 'pillar5_sectors',
}

def set_path(data, dotted, value):
    parts = dotted.split('.')
    cur = data
    for p in parts[:-1]:
        if p not in cur or not isinstance(cur[p], dict):
            cur[p] = {}
        cur = cur[p]
    cur[parts[-1]] = value

def clean_banned(data):
    if 'about' in data and isinstance(data['about'], dict):
        for k in list(data['about'].keys()):
            if k in BANNED_ABOUT:
                del data['about'][k]
    # also strip any flat-top dotted keys just in case
    for k in list(data.keys()):
        if '.' in k:
            del data[k]

def main(translations_file):
    all_tr = json.loads(Path(translations_file).read_text(encoding='utf-8'))
    for lang in LARGE_LANGS:
        tr = all_tr.get(lang)
        if not tr:
            print(f'SKIP {lang}: no translations')
            continue
        path = I18N / f'{lang}.json'
        data = json.loads(path.read_text(encoding='utf-8'))
        clean_banned(data)
        for dotted, val in tr.items():
            set_path(data, dotted, val)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f'{lang}: updated 9 keys, about-keys={len(data.get("about", {}))}')

if __name__ == '__main__':
    main(sys.argv[1])
