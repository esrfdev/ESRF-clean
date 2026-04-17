#!/usr/bin/env python3
"""Reconstruct the 10 small/corrupted language files.
Pulls flat-dotted main version, converts to nested, drops banned keys, applies phase-3 translations.
"""
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
I18N = REPO / 'i18n'

SMALL_LANGS = ['bg', 'el', 'et', 'ga', 'hr', 'lt', 'lv', 'mt', 'sl', 'uk']

BANNED_ABOUT = {
    'name_note', 'name_note_html',
    'pillar1_sectors', 'pillar2_sectors', 'pillar3_sectors',
    'pillar4_sectors', 'pillar5_sectors',
}

def flat_to_nested(flat):
    root = {}
    for key, value in flat.items():
        parts = key.split('.')
        cur = root
        for p in parts[:-1]:
            if p not in cur or not isinstance(cur[p], dict):
                cur[p] = {}
            cur = cur[p]
        cur[parts[-1]] = value
    return root

def drop_banned(data):
    if 'about' in data and isinstance(data['about'], dict):
        for k in list(data['about'].keys()):
            if k in BANNED_ABOUT:
                del data['about'][k]

def apply_p3(data, translations):
    for dotted_key, value in translations.items():
        parts = dotted_key.split('.')
        cur = data
        for p in parts[:-1]:
            if p not in cur or not isinstance(cur[p], dict):
                cur[p] = {}
            cur = cur[p]
        cur[parts[-1]] = value

def load_main_flat(lang):
    r = subprocess.run(
        ['git', 'show', f'main:i18n/{lang}.json'],
        capture_output=True, text=True, cwd=str(REPO), check=True,
    )
    return json.loads(r.stdout)

def reconstruct(lang, p3_translations):
    flat = load_main_flat(lang)
    # drop banned dotted keys before nesting (faster)
    for bk in list(flat.keys()):
        if bk.startswith('about.') and bk.split('.', 1)[1] in BANNED_ABOUT:
            del flat[bk]
    nested = flat_to_nested(flat)
    drop_banned(nested)
    apply_p3(nested, p3_translations)
    with open(I18N / f'{lang}.json', 'w', encoding='utf-8') as f:
        json.dump(nested, f, ensure_ascii=False, indent=2)
    return len(nested.get('about', {})), sum(1 for _ in json.dumps(nested))

if __name__ == '__main__':
    translations_file = Path(sys.argv[1])
    all_translations = json.loads(translations_file.read_text(encoding='utf-8'))
    for lang in SMALL_LANGS:
        tr = all_translations.get(lang)
        if not tr:
            print(f'SKIP {lang}: no translations')
            continue
        about_keys, size = reconstruct(lang, tr)
        print(f'{lang}: OK ({about_keys} about keys, {size} chars)')
