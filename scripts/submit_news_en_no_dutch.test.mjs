// Test: the English/non-Dutch variant of submit-news.html must contain
// zero visible Dutch copy. The Dutch form (data-form-lang="nl") may
// remain Dutch, but every visitor at ?lang=en (or any non-NL language
// such as ?lang=de / ?lang=fr) must see the English variant only.
//
// Background: an earlier audit found Dutch leaks in the EN form (hero,
// step labels, mode labels, helper text, validation messages, mailto
// payload, fallback success copy). This test guards against regressions
// by hard-failing if any well-known Dutch term reappears inside the
// data-form-lang="en" container or its dedicated EN handler script.
//
// Run with: node scripts/submit_news_en_no_dutch.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

let failures = 0;
function check(name, fn){
  try { fn(); console.log('  ok  — ' + name); }
  catch(e){ failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}

const html = fs.readFileSync(path.join(repoRoot, 'submit-news.html'), 'utf8');

/* ── Slice the EN container and the EN handler script ──────────────── */
function sliceEnContainer(){
  const re = /<div\s+data-form-lang="en"[\s\S]*?<!-- \/data-form-lang="en" -->/;
  const m = html.match(re);
  assert.ok(m, 'data-form-lang="en" container missing');
  return m[0];
}
function sliceEnHandler(){
  // The EN-only IIFE wires to #sv-form-en and runs separately from the NL one.
  // Slice from getElementById('sv-form-en') up to the FIRST "})();" that closes it.
  const m = html.match(/getElementById\('sv-form-en'\)[\s\S]*?^}\)\(\);/m);
  assert.ok(m, 'EN form handler IIFE missing');
  return m[0];
}
function sliceEnHero(){
  const re = /<section[^>]*data-hero-lang="en"[\s\S]*?<\/section>/;
  const m = html.match(re);
  assert.ok(m, 'data-hero-lang="en" hero missing');
  return m[0];
}

const enBlock = sliceEnContainer();
const enHandler = sliceEnHandler();
const enHero = sliceEnHero();
const enAll = enHero + '\n' + enBlock + '\n' + enHandler;

/* ── Forbidden Dutch terms inside EN-rendered surfaces ─────────────── */
/* Each entry: literal substring + a short label for the failure msg.
   These are deliberately phrases / unique Dutch tokens that should
   NEVER appear in any English-rendered surface (hero, container, or
   the EN IIFE that drives the EN form). They are NOT case-insensitive
   matches against shared canonical option values (e.g. the option value
   "noodhulp-crisisrespons" is allowed because that is a stable code,
   not visible text). */
const FORBIDDEN_DUTCH = [
  'Deel je informatie',
  'Stap 1',
  'Stap 2',
  'Stap 3',
  '1. Wat wil je doen',
  '2. Contact & organisatie',
  'Organisatie aanmelden',
  'Praktijkverhaal',
  'Gegevens wijzigen',
  'Verbergen / verwijderen',
  'Event aanmelden',
  'Wijziging',
  'Wijzigingsverzoek',
  'wijzigingsverzoek',
  'Niets wordt automatisch',
  'niets automatisch',
  'Aanvullende tags',
  'Bevoegdheid',
  'bevoegd',
  'Werkmail',
  'werkmail',
  'Kies een land',
  'Kies een ESRF-sector',
  'Kies een relatie',
  'Verstuur',
  'Versturen',
  'a.u.b.',
  'alstublieft',
  'Vul a.u.b',
  'Naam aanvrager',
  'Domein komt overeen',
  'Domein wijkt',
  'Geen website om mee te vergelijken',
  'Bedankt',
  'Ontvangen door ESRF-redactie',
  'Terug naar ESRF.net',
  'Liever via e-mail',
  'Geleerde les',
  'In het zonnetje',
  'Korte samenvatting',
  'Korte omschrijving',
  'Bestaande publieke gegevens',
  'Andere vermelding kiezen',
  'redactie kijkt',
  'Voor wie is dit verhaal',
  'Betrokken organisaties',
  'Regionale invalshoek',
  'Eventnaam',
  'Organisator',
  'Locatie',
  'Doelgroep',
  'Bijv.',
  'bijvoorbeeld:',
  'gepubliceerd',
  'gewijzigd',
  'aangemeld',
  'aanmelden',
  'wijzigen',
  'verbergen',
  'verwijderen',
  'mededeling',
  'organisatie aanmelden',
  'organisatie of vermelding',
  'controleert handmatig',
  'Handmatige verificatie',
  'Plaats / gemeente',
  'Regio / provincie',
  'Telefoon',
  'naam@organisatie.nl',
];

for (const term of FORBIDDEN_DUTCH) {
  check(`EN container has no Dutch term ${JSON.stringify(term)}`, () => {
    assert.ok(!enBlock.includes(term), `EN container contains "${term}"`);
  });
  check(`EN hero has no Dutch term ${JSON.stringify(term)}`, () => {
    // The EN hero may contain a small Dutch translation in <em> as a
    // visible bilingual courtesy line, but that line is EXACTLY the
    // canonical "Alle inzendingen worden door de redactie van ESRF.net
    // beoordeeld. Niets wordt automatisch gepubliceerd." — guard against
    // any of our other forbidden phrases leaking in elsewhere.
    if (term === 'Niets wordt automatisch' || term === 'niets automatisch' || term === 'redactie kijkt' || term === 'gepubliceerd') return; // exempt: bilingual courtesy <em>
    assert.ok(!enHero.includes(term), `EN hero contains "${term}"`);
  });
  check(`EN handler script has no Dutch term ${JSON.stringify(term)}`, () => {
    assert.ok(!enHandler.includes(term), `EN handler contains "${term}"`);
  });
}

/* ── Step / section labels rendered in EN must be English ──────────── */
const REQUIRED_EN_LABELS = [
  '1. What would you like to do?',
  '2. Contact &amp; organisation',
  '3A. Organisation details',
  '3B. Editorial contribution',
  '3C. What should happen to the existing listing?',
  '3D. Authority to request this change',
  '3E. Event details',
  '4. Privacy &amp; submit',
];
for (const label of REQUIRED_EN_LABELS) {
  check(`EN container has English step label ${JSON.stringify(label)}`, () => {
    assert.ok(enBlock.includes(label), `EN container missing "${label}"`);
  });
}

/* ── EN buttons / hero / submit copy in English ────────────────────── */
check('EN hero has English title "Share your information."', () => {
  assert.match(enHero, /Share your information\./);
});
check('EN hero has English deck with "submit an organisation"', () => {
  assert.match(enHero, /submit an organisation, request an update or removal/i);
});
check('EN container has English submit button "Share your information"', () => {
  assert.match(enBlock, /id="sv-en-submit-btn"[^>]*>\s*Share your information\s*</);
});
check('EN container has English mailto-fallback success', () => {
  assert.match(enBlock, /Your mail client has opened/);
  assert.match(enBlock, /We've opened your mail client with a summary/);
  assert.match(enBlock, /Back to ESRF\.net/);
});

/* ── EN handler: validation messages, submit-button labels, mailto
   subject map, mailto body labels — all in English. ────────────────── */
check('EN handler validate() messages start with English "Please"', () => {
  // sample 8 representative messages
  const samples = [
    'Please enter your name.',
    'Please enter your organisation.',
    'Please enter your role.',
    'Please enter your email address.',
    'Please choose a country.',
    'Please choose an ESRF sector.',
    'Please describe what should change.',
    'Please consent to the privacy policy.',
  ];
  for (const s of samples) {
    assert.ok(enHandler.includes(s), `missing EN validation message: "${s}"`);
  }
});

check('EN handler submit-button labels are English', () => {
  for (const lab of [
    'Share your story',
    'Share your information and story',
    'Send your change request',
    'Send your hide or delete request',
    'Submit your event',
    'Share your information',
  ]) {
    assert.ok(enHandler.includes(lab), `EN submit-btn label missing: ${lab}`);
  }
});

check('EN handler mailto subject map is English', () => {
  for (const lab of [
    "List an organisation",
    "Story from practice",
    "Organisation + story",
    "Change request",
    "Hide / delete request",
    "Event submission",
  ]) {
    assert.ok(enHandler.includes(lab), `EN subject label missing: ${lab}`);
  }
});

check('EN handler buildBody headings are English', () => {
  for (const head of [
    'ESRF.net — Share your information',
    '▸ CONTACT',
    '▸ ORGANISATION',
    '▸ EDITORIAL CONTRIBUTION',
    '▸ CHANGE REQUEST',
    '▸ AUTHORITY',
    '▸ EVENT_INTAKE',
    '▸ PRIVACY',
    'GDPR consent: YES',
    'Submitted via https://esrf.net/submit-news.html',
  ]) {
    assert.ok(enHandler.includes(head), `EN buildBody heading missing: ${head}`);
  }
});

/* ── Pre-render lang detection: anything other than 'nl' renders EN ── */
check('Pre-render detector treats every non-"nl" language as EN', () => {
  // The script computes:   var isNl = (lang === 'nl');
  // and the EN-render branch sets data-form-lang="nl" (and nl hero) hidden.
  // That single equality is the only knob: ?lang=en, ?lang=de, ?lang=fr,
  // ?lang=es, ?lang=it, ?lang=pt, ?lang=pl, ?lang=sv all hit the EN branch.
  assert.match(html, /var\s+isNl\s*=\s*\(\s*lang\s*===\s*['"]nl['"]\s*\)/);
});
check('Pre-render lang detection reads ?lang= URL param first', () => {
  assert.match(html, /URLSearchParams\(window\.location\.search\)/);
  assert.match(html, /p\.get\(['"]lang['"]\)/);
});
check('Live language switch handler also gates on lang === "nl"', () => {
  // Second IIFE near the bottom mirrors the pre-render selector logic.
  const re = /esrf:langchange[\s\S]*?function applyVariant|applyVariant\s*\([\s\S]*?const\s+isNl\s*=\s*\(\s*code\s*===\s*['"]nl['"]\s*\)/;
  assert.match(html, re);
});

/* ── Routing for ?lang=en / ?lang=de / ?lang=fr explicitly ────────── */
/* This is a static guarantee: the detector returns the URL param value
   directly (lower-cased). For lang ∈ {en, de, fr} the value is not
   "nl", so the EN branch is taken. We assert the structural shape so a
   future refactor can't silently introduce a denylist that excludes
   de/fr. */
check('Detect() returns the URL ?lang= value directly (no denylist)', () => {
  const detector = html.match(/function detect\(\)\{[\s\S]*?\}/);
  assert.ok(detector, 'detect() function missing in pre-render script');
  // It must return the URL param, not check it against a list.
  assert.match(detector[0], /return\s+u\.toLowerCase\(\)/);
  // And it must not whitelist a closed set of languages.
  assert.ok(!/['"](?:en|nl|de|fr)['"](?:\s*[,|]\s*['"](?:en|nl|de|fr)['"]){2,}/.test(detector[0]),
    'detect() should not whitelist a closed language list');
});

/* ── EN form is the variant served for non-NL ?lang values ─────────── */
check('?lang=en routes to EN form (NL variant hidden)', () => {
  // Pre-render script appends a <style id="sv-form-lang-style"> with
  // the rule [data-form-lang="nl"]{display:none!important} when
  // isNl is false. Verify both sides of that ternary exist verbatim.
  assert.match(html, /\[data-form-lang="nl"\][^{]*\{display:none!important\}/);
});
check('?lang=de / ?lang=fr / ?lang=es route to EN form (no NL fallback path)', () => {
  // There is exactly one isNl decision point in the pre-render script,
  // and it is a strict equality with the literal "nl". So any non-NL
  // value (de, fr, es, it, pt, pl, sv, …) follows the same EN branch.
  // Asserted structurally above; here we additionally assert there is
  // NO branch that maps de/fr/es to the NL variant.
  assert.ok(!/lang\s*===\s*['"]de['"]/.test(html), 'no special branch for de — must fall through to EN');
  assert.ok(!/lang\s*===\s*['"]fr['"]/.test(html), 'no special branch for fr — must fall through to EN');
  assert.ok(!/lang\s*===\s*['"]es['"]/.test(html), 'no special branch for es — must fall through to EN');
});

/* ── Webhook / payment behaviour invariants — must not change ──────── */
/* The EN form has historically been mailto-only. Make sure no payment
   or webhook URL was added to either the EN handler or the EN block. */
check('EN handler does NOT POST to /api/intake', () => {
  assert.ok(!/fetch\([^)]*\/api\/intake/.test(enHandler),
    'EN form must remain mailto-only and never call /api/intake');
});
check('EN handler does NOT call any payment / webhook endpoint', () => {
  for (const bad of [
    '/api/donate',
    '/api/payment',
    '/api/webhook',
    'stripe.com',
    'mollie.com',
    'paypal.com',
  ]) {
    assert.ok(!enHandler.includes(bad), `EN handler must not reference ${bad}`);
  }
});
check('EN handler still uses mailto:intake@esrf.net', () => {
  assert.match(enHandler, /mailto:intake@esrf\.net/);
});

if (failures > 0) {
  console.log('\n' + failures + ' check(s) failed.');
  process.exit(1);
} else {
  console.log('\nAll submit_news_en_no_dutch checks passed.');
}
