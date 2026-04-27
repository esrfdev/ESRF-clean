// Test: header donation button (nav.fund → fund.html) carries a
// donation-specific label in every i18n locale, distinct from the
// Variant A "Share to connect" CTA (nav.cta_action).
//
// Background — 2026-04-27:
//   The Variant A CTA "Share to connect" / "Draag bij aan verbinding"
//   shipped sitewide. Several locales used a generic "contribute"
//   equivalent for the donation button, which collided semantically
//   with the new share/connect CTA — readers could not tell which
//   button takes them to fund.html and which opens the intake. nl
//   was renamed "Bijdragen" → "Doneer" first; this guard codifies the
//   fix across all 27 ESRF locales.
//
// Guarantees:
//   1. Every locale defines nav.fund (no English-fallback exposure
//      in non-EN headers).
//   2. nav.fund is non-empty.
//   3. nav.fund differs from nav.cta_action (case- and
//      whitespace-insensitive). Same applies to nav.support and
//      nav.request_listing — donation must be its own thing.
//   4. nav.fund does not share the same root token with
//      nav.cta_action — i.e. the donation label cannot be a simple
//      morphological variant of the share/connect CTA (e.g. NL
//      "Bijdragen" vs "Draag bij" both share the "draag/bijdrag"
//      root and would still look like the same action).
//   5. Specific anchors:
//        nl.nav.fund ∈ {"Doneer","Geef"} (donation-specific)
//        en.nav.fund === "Donate" (donation-specific, not "Contribute")
//   6. The English donation button never reverts to "Contribute".
//
// Run with: node scripts/donation_cta_label_distinction.test.mjs

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

let failures = 0;
function check(name, fn){
  try { fn(); console.log('  ok  — ' + name); }
  catch(e){ failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}

const NORM = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Lowercase root tokens that appear in the Variant A "Share to connect"
// family and that, if also present in nav.fund, would make the two
// labels look like the same action to readers. Curated per-language
// from the round-5 cta_action translations.
const SHARE_ROOTS = {
  bg: ['споделете','свържем'],
  cs: ['sdílejte','propojme'],
  da: ['del ','skab forbindelse','knyt'],
  de: ['teilen','verbindet'],
  el: ['μοιραστείτε','συνδεθούμε'],
  en: ['share','connect','contribute'],
  es: ['comparte','conecta'],
  et: ['jaga','ühenda'],
  fi: ['jaa','yhdistä'],
  fr: ['partagez','reliez'],
  ga: ['roinn','nascadh'],
  hr: ['podijelite','povežite'],
  hu: ['ossza meg','kapcsoljon'],
  is: ['deildu','tengdu'],
  it: ['condividi','connettere'],
  lt: ['dalinkitės','junkime'],
  lv: ['dalieties','savienotu'],
  mt: ['aqsam','tgħaqqad'],
  nl: ['draag','bijdrag','verbind','deel'],
  no: ['del ','knytt'],
  pl: ['dziel','łącz'],
  pt: ['partilhe','conectar'],
  ro: ['împărtășiți','conectați'],
  sk: ['zdieľajte','prepojme'],
  sl: ['delite','povežite'],
  sv: ['dela','förbind'],
  uk: ['діліться',"об'єдн"],
};

function loadLocale(code){
  const p = path.join(repoRoot, 'i18n', `${code}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/* 1+2. nav.fund present and non-empty in every locale. */
check('every locale defines a non-empty nav.fund', () => {
  for (const code of ESRF_LANGS){
    const d = loadLocale(code);
    const nav = d.nav || {};
    assert.ok(typeof nav.fund === 'string' && nav.fund.trim().length > 0,
      `${code}.json: nav.fund missing or empty (got ${JSON.stringify(nav.fund)})`);
  }
});

/* 3. nav.fund is distinct from nav.cta_action / support / request_listing. */
check('nav.fund differs from cta_action / support / request_listing in every locale', () => {
  for (const code of ESRF_LANGS){
    const d = loadLocale(code);
    const nav = d.nav || {};
    const fund = NORM(nav.fund);
    for (const other of ['cta_action','support','request_listing']){
      const v = NORM(nav[other]);
      if (!v) continue;
      assert.notStrictEqual(fund, v,
        `${code}.json: nav.fund (${JSON.stringify(nav.fund)}) collides with nav.${other} (${JSON.stringify(nav[other])})`);
    }
  }
});

/* 4. nav.fund does not share a share/connect root token with cta_action. */
check('nav.fund shares no share/connect root with nav.cta_action', () => {
  for (const code of ESRF_LANGS){
    const d = loadLocale(code);
    const nav = d.nav || {};
    const fund = NORM(nav.fund);
    const roots = SHARE_ROOTS[code] || [];
    for (const r of roots){
      assert.ok(!fund.includes(r),
        `${code}.json: nav.fund (${JSON.stringify(nav.fund)}) contains share/connect root "${r}" — reads like the Variant A CTA, not a donation`);
    }
  }
});

/* 5a. nl anchor — donation-specific. */
check('nl.nav.fund is "Doneer" or "Geef"', () => {
  const d = loadLocale('nl');
  const fund = (d.nav && d.nav.fund) || '';
  assert.ok(['Doneer','Geef'].includes(fund),
    `nl.json nav.fund expected to be "Doneer" or "Geef", got ${JSON.stringify(fund)}`);
});

/* 5b. en anchor — donation-specific. */
check('en.nav.fund is "Donate" (donation-specific, not "Contribute")', () => {
  const d = loadLocale('en');
  const fund = (d.nav && d.nav.fund) || '';
  assert.strictEqual(fund, 'Donate',
    `en.json nav.fund expected to be "Donate", got ${JSON.stringify(fund)}`);
});

/* 6. en never regresses to "Contribute". */
check('en.nav.fund is never "Contribute"', () => {
  const d = loadLocale('en');
  const fund = (d.nav && d.nav.fund) || '';
  assert.notStrictEqual(NORM(fund), 'contribute',
    `en.json nav.fund regressed to "Contribute" — clashes with Variant A "Share to connect"`);
});

if (failures){
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall donation-vs-CTA label distinction checks passed');
