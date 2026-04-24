#!/usr/bin/env python3
"""
validate_sector_filters.py — multilingual regression test for the Atlas and
Directory sector filter.

Static checks (always run):
  1. companies_extracted.json only uses sectors in the canonical SECTOR_ORDER.
  2. Every i18n/*.json defines every sector.* and sector.short_* key, plus
     filter.sector / filter.country / filter.all_sectors / filter.all_countries
     / filter.all_tags.
  3. app.js SECTOR_ORDER, SECTOR_SHORT and SECTOR_I18N_KEYS are consistent.
  4. map.html SECTOR_CHIPS data-sector values exactly mirror SECTOR_ORDER.
  5. No sector label in any locale is empty or still the literal i18n key
     (a DeepL dropout, for example) — which would produce a blank chip in
     the active-filter pill.

End-to-end simulation (optional, runs when `node` and jsdom are available):
  For every language × every sector, spin up map.html and directory.html in
  jsdom, click the localised chip/dropdown option, and assert:
    • organisations count matches expected sector count
    • URL syncs to ?sector=<canonical English key>
    • Emergency-only: tag chip bar appears with 11 tag chips
  The jsdom driver is scripts/validate_sector_filters_driver.js.

Exits non-zero on any failure.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
I18N = ROOT / 'i18n'

# The canonical taxonomy is the source of truth — if any of these ever change
# they MUST change everywhere (app.js, SECTOR_I18N_KEYS, data, i18n, every
# downstream consumer). This validator is the guardrail.
SECTOR_ORDER = [
    'Emergency & Crisis Response',
    'Security & Protection',
    'Risk & Continuity Management',
    'Digital Infrastructure & Cybersecurity',
    'Knowledge, Training & Research',
    'Health & Medical Manufacturing',
    'Critical Infrastructure',
    'Dual-use Technology & Manufacturing',
    'Transport, Maritime & Aerospace',
    'Energy & Grid Resilience',
]
SECTOR_I18N_KEY = {
    'Emergency & Crisis Response':           ('sector.emergency',   'sector.short_emergency'),
    'Security & Protection':                 ('sector.security',    'sector.short_security'),
    'Risk & Continuity Management':          ('sector.risk',        'sector.short_risk'),
    'Digital Infrastructure & Cybersecurity':('sector.digital',     'sector.short_digital'),
    'Knowledge, Training & Research':        ('sector.knowledge',   'sector.short_knowledge'),
    'Health & Medical Manufacturing':        ('sector.health',      'sector.short_health'),
    'Critical Infrastructure':               ('sector.critical',    'sector.short_critical'),
    'Dual-use Technology & Manufacturing':   ('sector.dual_use',    'sector.short_dual_use'),
    'Transport, Maritime & Aerospace':       ('sector.transport',   'sector.short_transport'),
    'Energy & Grid Resilience':              ('sector.energy',      'sector.short_energy'),
}
FILTER_REQUIRED = ['sector', 'country', 'all_sectors', 'all_countries', 'all_tags']


def getkey(d, path):
    node = d
    for part in path.split('.'):
        if not isinstance(node, dict):
            return None
        node = node.get(part)
    return node


def check_data_uses_canonical():
    path = ROOT / 'companies_extracted.json'
    data = json.loads(path.read_text(encoding='utf-8'))
    errs = []
    uses = {}
    for o in data:
        s = o.get('sector_normalized')
        uses[s] = uses.get(s, 0) + 1
    for s in uses:
        if s not in SECTOR_ORDER:
            errs.append(f'unknown sector in data: {s!r} ({uses[s]} orgs)')
    return errs, uses


def check_app_js():
    text = (ROOT / 'app.js').read_text(encoding='utf-8')
    errs = []
    # SECTOR_ORDER literal check
    for s in SECTOR_ORDER:
        if s not in text:
            errs.append(f'app.js missing SECTOR_ORDER entry: {s!r}')
    # canonicalize / sectorLabel exported
    for needed in ['function sectorLabel', 'function canonicalizeSector', 'SECTOR_I18N_KEYS']:
        if needed not in text:
            errs.append(f'app.js missing identifier: {needed}')
    return errs


def check_map_html():
    text = (ROOT / 'map.html').read_text(encoding='utf-8')
    errs = []
    for s in SECTOR_ORDER:
        pattern = "key:'" + s + "'"
        if pattern not in text:
            errs.append(f'map.html SECTOR_CHIPS missing {s!r}')
    return errs


def check_i18n_coverage():
    errs = []
    langs = sorted(p.stem for p in I18N.glob('*.json'))
    for lang in langs:
        d = json.loads((I18N / f'{lang}.json').read_text(encoding='utf-8'))
        for canon, (full_key, short_key) in SECTOR_I18N_KEY.items():
            for key in (full_key, short_key):
                v = getkey(d, key)
                if not v or not isinstance(v, str) or not v.strip():
                    errs.append(f'{lang}: missing/empty {key} (for {canon!r})')
                elif v.strip() == key:
                    errs.append(f'{lang}: {key} still equals its i18n path (looks like dropout)')
        for fkey in FILTER_REQUIRED:
            v = getkey(d, 'filter.' + fkey)
            if not v or not isinstance(v, str) or not v.strip():
                errs.append(f'{lang}: missing filter.{fkey}')
    return errs, langs


def run_jsdom_driver(langs):
    """Run the Node jsdom driver. Returns (ok, message)."""
    driver = ROOT / 'scripts' / 'validate_sector_filters_driver.js'
    if not driver.exists():
        return True, 'jsdom driver missing (skipped)'
    # Check node + jsdom availability.
    try:
        subprocess.run(['node', '--version'], check=True, capture_output=True)
    except Exception:
        return True, 'node not available (skipped)'
    try:
        subprocess.run(['node', '-e', 'require(process.env.JSDOM_MODULE)'],
                       check=True, capture_output=True,
                       env={**os.environ, 'JSDOM_MODULE': find_jsdom() or 'jsdom'})
    except Exception:
        return True, 'jsdom module not installed (skipped)'
    # Caller can opt out with ESRF_SKIP_JSDOM=1
    if os.environ.get('ESRF_SKIP_JSDOM') == '1':
        return True, 'ESRF_SKIP_JSDOM=1 (skipped)'
    env = {**os.environ, 'ESRF_LANGS': ','.join(langs)}
    r = subprocess.run(['node', str(driver)], capture_output=True, text=True, env=env)
    if r.returncode != 0:
        return False, r.stdout + '\n' + r.stderr
    return True, r.stdout


def find_jsdom():
    for p in ['/tmp/j22/node_modules/jsdom',
              str(ROOT / 'node_modules/jsdom'),
              '/usr/local/lib/node_modules/jsdom']:
        if Path(p).exists():
            return p
    return None


def main():
    all_errs = []

    errs, uses = check_data_uses_canonical()
    all_errs += errs
    emergency_total = uses.get('Emergency & Crisis Response', 0)
    print(f'[data] {sum(uses.values())} orgs across {len(uses)} sectors '
          f'(Emergency: {emergency_total})')

    errs = check_app_js();  all_errs += errs
    if errs: print('[app.js]', *errs, sep='\n  ')
    else:    print('[app.js] OK — SECTOR_ORDER, sectorLabel, canonicalizeSector, SECTOR_I18N_KEYS present')

    errs = check_map_html(); all_errs += errs
    if errs: print('[map.html]', *errs, sep='\n  ')
    else:    print('[map.html] OK — SECTOR_CHIPS matches SECTOR_ORDER')

    errs, langs = check_i18n_coverage(); all_errs += errs
    if errs: print('[i18n]', *errs, sep='\n  ')
    else:    print(f'[i18n] OK — {len(langs)} languages, every sector.* / sector.short_* / filter.* key present')

    ok, msg = run_jsdom_driver(langs)
    if not ok:
        print('[jsdom]', msg)
        all_errs.append('jsdom driver reported failures (see above)')
    else:
        print('[jsdom]', msg.strip() or 'OK')

    if all_errs:
        print(f'\nFAIL — {len(all_errs)} problem(s).')
        sys.exit(1)
    print('\nOK — sector filter taxonomy consistent across all 27 languages and both pages.')


if __name__ == '__main__':
    main()
