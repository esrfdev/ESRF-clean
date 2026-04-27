// Test: the donation/fund page is readable in every site locale.
//
// Background — 2026-04-27:
//   The user reported that fund.html only rendered in EN and NL; the
//   other 25 locales silently fell back to English because no fund.*
//   tree existed in their JSON. We authored native fund translations
//   for all 27 ESRF locales. This guard codifies the expectation so a
//   future locale or key addition cannot regress the page back to
//   English-only for non-EN/NL readers.
//
// Guarantees:
//   1. Every locale defines a fund.* tree.
//   2. Every locale's fund.* tree has full key parity with en.json
//      (no missing keys, no extra keys).
//   3. Every locale's fund.* values are non-empty strings.
//   4. Bank routing values (bank_iban_value, bank_bic_value) are
//      identical across every locale — payment routing must never
//      drift through translation.
//   5. fund.html anchors are intact (CTA email mailto, sponsor link)
//      — translations must not erase functional links.
//   6. Non-EN/NL locales render distinct content (i.e. the fund.*
//      tree is not a verbatim copy of en.json or nl.json), proving
//      the locale is not a fallback-only stub. Spot-check a handful
//      of key narrative strings.
//   7. Representative locales (de/fr/es/pl/uk) contain a translated
//      title, body, and CTA token from a known native vocabulary —
//      catches accidentally pasted English in those high-traffic
//      languages.
//   8. fund.html declares hreflang for all 27 locales.
//
// Run with: node scripts/fund_locales_complete.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const ESRF_LANGS = [
  'bg','cs','da','de','el','en','es','et','fi','fr',
  'ga','hr','hu','is','it','lt','lv','mt','nl','no',
  'pl','pt','ro','sk','sl','sv','uk',
];

const IBAN_LITERAL = 'NL33 INGB 0116 7972 23';
const BIC_LITERAL  = 'INGBNL2A';

let failures = 0;
function check(name, fn){
  try { fn(); console.log('  ok  — ' + name); }
  catch(e){ failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}

const NORM = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function loadLocale(code){
  const p = path.join(repoRoot, 'i18n', `${code}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const enFund = loadLocale('en').fund;
const nlFund = loadLocale('nl').fund;
const expectedKeys = new Set(Object.keys(enFund));

/* 1. fund.* exists everywhere. */
check('every locale defines a fund.* tree', () => {
  for (const code of ESRF_LANGS){
    const d = loadLocale(code);
    assert.ok(d.fund && typeof d.fund === 'object',
      `${code}.json: missing fund.* tree — donation page would fall back to English`);
  }
});

/* 2. Full key parity. */
check('fund.* key parity with en.json across all 27 locales', () => {
  for (const code of ESRF_LANGS){
    const fund = loadLocale(code).fund || {};
    const got = new Set(Object.keys(fund));
    const missing = [...expectedKeys].filter(k => !got.has(k));
    const extra   = [...got].filter(k => !expectedKeys.has(k));
    assert.deepStrictEqual(missing, [], `${code}.json fund.*: missing keys ${JSON.stringify(missing)}`);
    assert.deepStrictEqual(extra,   [], `${code}.json fund.*: extra keys ${JSON.stringify(extra)}`);
  }
});

/* 3. Non-empty strings. */
check('every fund.* value is a non-empty string', () => {
  for (const code of ESRF_LANGS){
    const fund = loadLocale(code).fund || {};
    for (const [k, v] of Object.entries(fund)){
      assert.ok(typeof v === 'string', `${code}.json fund.${k}: not a string`);
      assert.ok(v.trim().length > 0, `${code}.json fund.${k}: empty value`);
    }
  }
});

/* 4. Bank routing values are literal across every locale. */
check('bank IBAN/BIC values are identical across all 27 locales', () => {
  for (const code of ESRF_LANGS){
    const fund = loadLocale(code).fund || {};
    assert.strictEqual(fund.bank_iban_value, IBAN_LITERAL,
      `${code}.json fund.bank_iban_value: payment routing must not be translated`);
    assert.strictEqual(fund.bank_bic_value, BIC_LITERAL,
      `${code}.json fund.bank_bic_value: payment routing must not be translated`);
  }
});

/* 5. fund.html anchors intact. */
check('fund.html preserves CTA mailto + sponsor link', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'fund.html'), 'utf8');
  assert.ok(/mailto:hello@esrf\.net/i.test(html),
    'fund.html: CTA mailto link missing — translations or edits dropped it');
  assert.ok(/href="sponsor\.html"/i.test(html),
    'fund.html: sponsor.html link missing — translations or edits dropped it');
});

/* 6. Locales are not fallback-only stubs. Spot-check narrative keys. */
check('non-EN/NL locales render distinct fund.* content (not a copy of EN or NL)', () => {
  const probeKeys = ['hero_title_2','hero_deck','idea_pull_html','cta_title','faq1_a'];
  for (const code of ESRF_LANGS){
    if (code === 'en' || code === 'nl') continue;
    const fund = loadLocale(code).fund || {};
    let distinctFromEn = false, distinctFromNl = false;
    for (const k of probeKeys){
      if (NORM(fund[k]) !== NORM(enFund[k])) distinctFromEn = true;
      if (NORM(fund[k]) !== NORM(nlFund[k])) distinctFromNl = true;
    }
    assert.ok(distinctFromEn,
      `${code}.json fund.*: every probed key matches en.json verbatim — locale is a fallback-only stub`);
    assert.ok(distinctFromNl,
      `${code}.json fund.*: every probed key matches nl.json verbatim — locale is a fallback-only stub`);
  }
});

/* 7. Representative locales have native title/body/CTA vocabulary. */
const NATIVE_PROBES = {
  // For each locale, supply { titleKey, bodyKey, ctaKey } with at least one
  // lowercased token expected to appear in a native rendering. Catches the
  // "looks translated but is actually English pasted into a JSON value" bug.
  de: { hero_title_2: ['widerstandskraft','resilienz'], hero_deck: ['europäische','gemeinschaft'], cta_title: ['beizutragen','beitragen','bereit'] },
  fr: { hero_title_2: ['résilience'], hero_deck: ['européenne','communauté'], cta_title: ['contribuer','prêt'] },
  es: { hero_title_2: ['resiliencia'], hero_deck: ['europea','comunidad'], cta_title: ['contribuir','listo'] },
  pl: { hero_title_2: ['odporność'], hero_deck: ['europejsk','społeczność'], cta_title: ['gotow','wkład','wesprzeć','wnieść'] },
  uk: { hero_title_2: ['стійкість'], hero_deck: ['європейськ','спільнот'], cta_title: ['готові','внесок','внести'] },
};
check('representative locales (de/fr/es/pl/uk) use native vocabulary', () => {
  for (const [code, probes] of Object.entries(NATIVE_PROBES)){
    const fund = loadLocale(code).fund || {};
    for (const [key, tokens] of Object.entries(probes)){
      const v = NORM(fund[key]);
      assert.ok(v.length > 0, `${code}.json fund.${key}: empty`);
      const hit = tokens.some(t => v.includes(t));
      assert.ok(hit,
        `${code}.json fund.${key} = ${JSON.stringify(fund[key])} — none of the expected native tokens ${JSON.stringify(tokens)} are present (looks like English fallback)`);
    }
  }
});

/* 8. fund.html declares hreflang for all 27 locales. */
check('fund.html declares hreflang link for every locale', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'fund.html'), 'utf8');
  for (const code of ESRF_LANGS){
    const re = new RegExp(`<link[^>]+hreflang="${code}"`, 'i');
    assert.ok(re.test(html),
      `fund.html: missing <link rel="alternate" hreflang="${code}"> — search engines won't surface the localised page`);
  }
  assert.ok(/hreflang="x-default"/i.test(html),
    'fund.html: missing hreflang="x-default"');
});

if (failures){
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall fund-locales-complete checks passed');
