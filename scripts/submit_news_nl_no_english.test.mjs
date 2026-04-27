// Test: the Dutch (NL) variant of submit-news.html must contain zero
// visible English copy. The English form (data-form-lang="en") may
// remain English, but a visitor at /submit-news?lang=nl (or
// /submit-news.html?lang=nl) must see Dutch only — no bilingual hero
// courtesy lines, no English <em> sentences under success messages, no
// English step labels, no English mode labels, no English placeholders,
// validation messages, button labels, mailto subjects, or buildBody
// headings.
//
// Background: an audit found that the NL hero, the API-success container
// and the mailto-fallback success container all carried bilingual <em>
// English sentences in addition to the Dutch copy. NL visitors saw
// English text on the visible Dutch page. This test guards against
// regressions by hard-failing if any well-known English string reappears
// inside the data-hero-lang="nl" / data-form-lang="nl" containers or the
// NL handler IIFE that drives the NL form.
//
// Run with: node scripts/submit_news_nl_no_english.test.mjs

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

/* ── Slice the NL container, NL hero, and NL handler ──────────────── */
function sliceNlContainer(){
  const re = /<div\s+data-form-lang="nl"[\s\S]*?<!-- \/data-form-lang="nl" -->/;
  const m = html.match(re);
  assert.ok(m, 'data-form-lang="nl" container missing');
  return m[0];
}
function sliceNlHero(){
  const re = /<section[^>]*data-hero-lang="nl"[\s\S]*?<\/section>/;
  const m = html.match(re);
  assert.ok(m, 'data-hero-lang="nl" hero missing');
  return m[0];
}
function sliceNlHandler(){
  // The NL IIFE wires to #sv-form (NOT #sv-form-en) and runs separately
  // from the EN one. Slice from getElementById('sv-form') up to the
  // FIRST "})();" that closes it.
  const m = html.match(/getElementById\('sv-form'\)[\s\S]*?^}\)\(\);/m);
  assert.ok(m, 'NL form handler IIFE missing');
  return m[0];
}

const nlBlock = sliceNlContainer();
const nlHero = sliceNlHero();
const nlHandler = sliceNlHandler();

/* Visible-text view of the NL form container: strip HTML attribute
   values so that things like data-en-label="Share your information" on
   the submit button (a metadata attribute, never rendered as text) do
   not trip a forbidden-substring check. We do this by removing every
   attribute of the form name="..." or name='...'. The attribute remains
   in nlBlock for the structural assertion below; this `nlVisible` view
   is only used for the forbidden-English-phrase scans that target text
   nodes a visitor would actually read. */
const nlVisible = nlBlock.replace(/\s[a-zA-Z_:-]+="[^"]*"/g, '')
                          .replace(/\s[a-zA-Z_:-]+='[^']*'/g, '');

/* ── Forbidden English phrases inside NL-rendered surfaces ────────── */
/* Each entry is a literal substring that must NEVER appear inside the
   NL hero, NL form-container visible text, or the NL handler IIFE. They
   are the exact phrases the user reported as leaking, plus close
   neighbours that cover the same regression class. */
const FORBIDDEN_ENGLISH = [
  // Hero / page-level English copy
  'Share your information',
  'Use this form to submit',
  'request an update or removal',
  'All submissions are reviewed',
  'Nothing is published automatically',
  'Every submission is reviewed manually',
  'Received by the ESRF editorial team',
  "We've opened your mail client",
  // Step / fieldset legends in English
  'Step 1',
  'Step 2',
  'Step 3',
  '1. What would you like to do',
  '2. Contact & organisation',
  '2. Contact &amp; organisation',
  '3A. Organisation details',
  '3B. Editorial contribution',
  '3C. What should happen to the existing listing',
  '3D. Authority to request this change',
  '3E. Event details',
  '4. Privacy & submit',
  '4. Privacy &amp; submit',
  // Mode-picker labels
  'List an organisation',
  'Story from practice',
  'Update or verify',
  'Hide / delete',
  'Submit an event',
  'Organisation + story',
  // Form labels
  'Additional tags',
  'Country',
  'Phone (optional)',
  'Region / province',
  'Working title',
  'Short summary',
  'Short description',
  'Lessons learned',
  'In the spotlight',
  'Regional angle',
  'Sources',
  'Event name',
  'Organiser',
  'Start date',
  'End date',
  'Location',
  'Audience',
  'Event details',
  'Authority to request this change',
  // Buttons / submit copy
  'Share your story',
  'Send your change request',
  'Send your hide or delete request',
  'Submit your event',
  // Validation messages (EN handler style)
  'Please enter your name',
  'Please enter your organisation',
  'Please enter your role',
  'Please enter your email',
  'Please choose a country',
  'Please choose an ESRF sector',
  'Please consent to the privacy policy',
  // Success / fallback copy
  'Your mail client has opened',
  'Back to ESRF.net',
  // BuildBody / mailto headings
  '▸ ORGANISATION',
  '▸ EDITORIAL CONTRIBUTION',
  '▸ CHANGE REQUEST',
  '▸ AUTHORITY',
  'GDPR consent: YES',
  'ESRF.net — Share your information',
  // Mailto subject map (EN)
  '"List an organisation"',
  '"Story from practice"',
  '"Change request"',
  '"Hide / delete request"',
  '"Event submission"',
];

for (const term of FORBIDDEN_ENGLISH) {
  check(`NL hero has no English phrase ${JSON.stringify(term)}`, () => {
    assert.ok(!nlHero.includes(term), `NL hero contains "${term}"`);
  });
  check(`NL form container has no English phrase ${JSON.stringify(term)}`, () => {
    assert.ok(!nlVisible.includes(term), `NL form container contains "${term}"`);
  });
  check(`NL handler script has no English phrase ${JSON.stringify(term)}`, () => {
    assert.ok(!nlHandler.includes(term), `NL handler contains "${term}"`);
  });
}

/* ── Step / section labels rendered in NL must be Dutch ───────────── */
const REQUIRED_NL_LABELS = [
  '1. Wat wil je doen?',
  '2. Contact &amp; organisatie',
  '3A. Organisatie-gegevens',
  '3B. Editorial bijdrage',
  '3C. Wat moet er aan de bestaande vermelding gebeuren?',
  '3D. Bevoegdheid om wijziging aan te vragen',
  '3E. Event-gegevens',
  '4. Privacy &amp; verzending',
];
for (const label of REQUIRED_NL_LABELS) {
  check(`NL container has Dutch step label ${JSON.stringify(label)}`, () => {
    assert.ok(nlBlock.includes(label), `NL container missing "${label}"`);
  });
}

/* ── NL hero must be Dutch only (no bilingual <em> English line) ──── */
check('NL hero has the Dutch title "Deel je informatie."', () => {
  assert.match(nlHero, /Deel je informatie\./);
});
check('NL hero has the Dutch review sentence', () => {
  const DUTCH_REVIEW_SENTENCE = 'Alle inzendingen worden door de redactie van ESRF.net beoordeeld. Niets wordt automatisch gepubliceerd.';
  assert.ok(nlHero.includes(DUTCH_REVIEW_SENTENCE),
    'NL hero missing canonical Dutch review sentence');
});
check('NL hero does NOT have a bilingual <em> English courtesy line', () => {
  // The hero has been observed to render an <em>…English…</em> line
  // under the Dutch sentence. That line must not exist.
  assert.ok(!/<em>[^<]*All submissions are reviewed[^<]*<\/em>/.test(nlHero),
    'NL hero still has the bilingual <em> English courtesy line');
  assert.ok(!/<em>[^<]*Nothing is published[^<]*<\/em>/.test(nlHero),
    'NL hero still has an English <em> sentence');
});

/* ── NL success containers (auto + mailto fallback) — Dutch only ──── */
check('NL auto-success container has the Dutch headline', () => {
  assert.match(nlBlock, /Ontvangen door ESRF-redactie/);
});
check('NL auto-success container has NO English <em> translation line', () => {
  assert.ok(!/<em>[^<]*Received by the ESRF[^<]*<\/em>/.test(nlBlock),
    'NL auto-success still leaks an English <em> sentence');
  assert.ok(!/<em>[^<]*every submission is reviewed manually[^<]*<\/em>/i.test(nlBlock),
    'NL auto-success still leaks an English <em> sentence');
});
check('NL mailto-fallback success has the Dutch headline', () => {
  assert.match(nlBlock, /Je e-mailprogramma is geopend/);
});
check('NL mailto-fallback success has NO English <em> translation line', () => {
  assert.ok(!/<em>[^<]*opened your mail client[^<]*<\/em>/i.test(nlBlock),
    'NL mailto-fallback still leaks an English <em> sentence');
  assert.ok(!/<em>[^<]*reach the ESRF editorial team[^<]*<\/em>/i.test(nlBlock),
    'NL mailto-fallback still leaks an English <em> sentence');
});

/* ── NL submit button visible label is Dutch ──────────────────────── */
check('NL submit button visible label is "Deel je informatie"', () => {
  assert.match(nlBlock, /id="sv-submit-btn"[^>]*>\s*Deel je informatie\s*</);
});

/* ── NL handler: validation messages, submit-button labels and
   buildBody headings are Dutch. ───────────────────────────────────── */
check('NL handler validate() messages start with Dutch "Vul a.u.b." or "Kies a.u.b."', () => {
  const samples = [
    'Vul a.u.b. je naam in.',
    'Vul a.u.b. je organisatie in.',
    'Vul a.u.b. je functie in.',
    'Vul a.u.b. je e-mailadres in.',
    'Kies a.u.b. een land.',
    'Kies a.u.b. een sector.',
    'Geef a.u.b. toestemming voor het privacybeleid.',
  ];
  for (const s of samples) {
    assert.ok(nlHandler.includes(s), `NL validation message missing: "${s}"`);
  }
});
check('NL handler submit-button labels are Dutch', () => {
  for (const lab of [
    'Deel je praktijkverhaal',
    'Deel je informatie en praktijkverhaal',
    'Deel je wijzigingsverzoek',
    'Deel je verberg- of verwijderverzoek',
    'Meld je event aan',
    'Deel je informatie',
  ]) {
    assert.ok(nlHandler.includes(lab), `NL submit-btn label missing: ${lab}`);
  }
});
check('NL handler mailto subject map is Dutch', () => {
  for (const lab of [
    'Organisatie aanmelden',
    'Praktijkverhaal',
    'Organisatie + praktijkverhaal',
    'Wijzigingsverzoek',
    'Verberg-/verwijderverzoek',
    'Event aanmelden',
  ]) {
    assert.ok(nlHandler.includes(lab), `NL subject label missing: ${lab}`);
  }
});
check('NL handler buildBody headings are Dutch', () => {
  for (const head of [
    'ESRF.net — Deel je informatie',
    '▸ CONTACT',
    '▸ ORGANISATIE',
    '▸ PRAKTIJKVERHAAL',
    '▸ WIJZIGINGSVERZOEK',
    '▸ BEVOEGDHEID',
  ]) {
    assert.ok(nlHandler.includes(head), `NL buildBody heading missing: ${head}`);
  }
});

if (failures > 0) {
  console.log('\n' + failures + ' check(s) failed.');
  process.exit(1);
} else {
  console.log('\nAll submit_news_nl_no_english checks passed.');
}
