// Test: hard-fail if the canonical Dutch editorial-review sentence (or any
// of its key fragments) can appear on the submit-news page for non-NL
// visitors WITHOUT JavaScript running. Regression guard for the live
// "Dutch sentence visible on /submit-news?lang=en" report.
//
// Approach: parse submit-news.html and verify that the canonical Dutch
// sentence "Alle inzendingen worden door de redactie van ESRF.net
// beoordeeld. Niets wordt automatisch gepubliceerd." appears ONLY inside
// containers that are gated to NL (data-hero-lang="nl" / data-form-lang="nl"),
// and that those NL containers carry the static `hidden` attribute so the
// sentence is invisible until the pre-render script flips it for NL
// visitors. This is a STATIC test — no browser or DOM is rendered.
//
// Run with: node scripts/submit_news_dutch_review_leak.test.mjs

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

const DUTCH_REVIEW_SENTENCE = 'Alle inzendingen worden door de redactie van ESRF.net beoordeeld. Niets wordt automatisch gepubliceerd.';
const DUTCH_FRAGMENTS = [
  'Alle inzendingen worden door de redactie',
  'Niets wordt automatisch gepubliceerd',
  'redactie van ESRF.net beoordeeld',
];

/* ─── 1. Static-default invariant: the NL hero/form must be hidden by
   default in the HTML, so a visitor at ?lang=en never sees the Dutch
   sentence even before the inline pre-render script runs. ─────────── */
check('NL hero <section data-hero-lang="nl"> has the static `hidden` attribute', () => {
  const re = /<section[^>]*\bdata-hero-lang="nl"[^>]*\bhidden\b[^>]*>/;
  assert.match(html, re);
});
check('NL form <div data-form-lang="nl"> has the static `hidden` attribute', () => {
  const re = /<div[^>]*\bdata-form-lang="nl"[^>]*\bhidden\b[^>]*>/;
  assert.match(html, re);
});

/* ─── 2. EN hero/form must NOT carry the static hidden attribute — they
   are the default-visible variant. ─────────────────────────────────── */
check('EN hero <section data-hero-lang="en"> does NOT have the static `hidden` attribute', () => {
  const re = /<section[^>]*\bdata-hero-lang="en"[^>]*>/;
  const m = html.match(re);
  assert.ok(m, 'EN hero section missing');
  assert.ok(!/\bhidden\b/.test(m[0]), `EN hero has hidden attribute: ${m[0]}`);
});
check('EN form <div data-form-lang="en"> does NOT have the static `hidden` attribute', () => {
  const re = /<div[^>]*\bdata-form-lang="en"[^>]*>/;
  const m = html.match(re);
  assert.ok(m, 'EN form div missing');
  assert.ok(!/\bhidden\b/.test(m[0]), `EN form div has hidden attribute: ${m[0]}`);
});

/* ─── 3. Containment: every occurrence of the Dutch sentence (and each
   key fragment) in the rendered body must live inside a NL-gated
   container (NL hero, NL form, or the build-body lines NL handler). ── */
function sliceBody(){
  const m = html.match(/<body[\s\S]*<\/body>/);
  assert.ok(m, '<body> missing');
  return m[0];
}
function sliceNlHero(){
  const m = html.match(/<section[^>]*data-hero-lang="nl"[\s\S]*?<\/section>/);
  assert.ok(m, 'NL hero missing');
  return m[0];
}
function sliceNlForm(){
  const m = html.match(/<div[^>]*data-form-lang="nl"[\s\S]*?<!-- \/data-form-lang="nl" -->/);
  assert.ok(m, 'NL form container missing');
  return m[0];
}
function sliceNlHandler(){
  // NL form IIFE: from getElementById('sv-form') (id=sv-form belongs to
  // the NL form) up to the start of the EN handler. Everything in this
  // script powers the NL submission only and never produces visible
  // body copy at lang!=nl.
  const startIdx = html.indexOf("getElementById('sv-form')");
  assert.ok(startIdx >= 0, 'NL form handler IIFE start missing');
  const endIdx = html.indexOf("getElementById('sv-form-en')", startIdx);
  assert.ok(endIdx > startIdx, 'NL form handler IIFE end (= EN handler start) missing');
  return html.slice(startIdx, endIdx);
}
function sliceEnHero(){
  const m = html.match(/<section[^>]*data-hero-lang="en"[\s\S]*?<\/section>/);
  assert.ok(m, 'EN hero missing');
  return m[0];
}
function sliceEnForm(){
  const m = html.match(/<div[^>]*data-form-lang="en"[\s\S]*?<!-- \/data-form-lang="en" -->/);
  assert.ok(m, 'EN form container missing');
  return m[0];
}

const body       = sliceBody();
const nlHero     = sliceNlHero();
const nlForm     = sliceNlForm();
const nlHandler  = sliceNlHandler();
const enHero     = sliceEnHero();
const enForm     = sliceEnForm();

// Body content with NL-gated regions removed; what remains must not
// contain the Dutch review sentence or any key fragment.
const bodyOutsideNl = body
  .replace(nlHero, '')
  .replace(nlForm, '')
  .replace(nlHandler, '');

check('Canonical Dutch review sentence appears nowhere outside NL-gated regions', () => {
  assert.ok(!bodyOutsideNl.includes(DUTCH_REVIEW_SENTENCE),
    `Dutch sentence leaked outside NL containers: "${DUTCH_REVIEW_SENTENCE}"`);
});

for (const frag of DUTCH_FRAGMENTS) {
  check(`Key Dutch fragment ${JSON.stringify(frag)} appears nowhere outside NL-gated regions`, () => {
    assert.ok(!bodyOutsideNl.includes(frag),
      `Fragment leaked outside NL containers: "${frag}"`);
  });
}

/* ─── 4. EN hero / EN form / EN handler must contain the English
   editorial review sentence (positive assertion). ──────────────────── */
const EN_REVIEW_SENTENCE = 'All submissions are reviewed by the ESRF.net editorial team. Nothing is published automatically.';
check('EN hero contains the English editorial review sentence', () => {
  assert.ok(enHero.includes(EN_REVIEW_SENTENCE),
    `EN hero missing English review sentence`);
});
check('EN hero does NOT contain ANY key Dutch fragment', () => {
  for (const frag of DUTCH_FRAGMENTS) {
    assert.ok(!enHero.includes(frag), `EN hero leaks: "${frag}"`);
  }
});
check('EN form does NOT contain ANY key Dutch fragment', () => {
  for (const frag of DUTCH_FRAGMENTS) {
    assert.ok(!enForm.includes(frag), `EN form leaks: "${frag}"`);
  }
});

/* ─── 5. Pre-render script invariant: the synchronous head script MUST
   inject CSS that hides the wrong variant for the resolved language,
   and the unhide path for NL must remove the static `hidden` attr. ── */
check('Pre-render script injects CSS that hides the NL variant when lang!=nl', () => {
  assert.match(html, /\[data-form-lang="nl"\][^{]*\{display:none!important\}/);
});
check('Pre-render script removes hidden from NL containers when isNl is true', () => {
  // applyHidden() reads: if (isNl) nlEl.removeAttribute('hidden')
  assert.match(html, /removeAttribute\(\s*['"]hidden['"]\s*\)/);
});

/* ─── 6. Sister pages (defence-in-depth): the same Dutch fragment must
   not appear in EN-rendered surfaces of submit-event.html or
   request-listing.html either. We're only enforcing the "outside NL
   regions" rule here when NL/EN variants exist; otherwise we just
   check that pages whose primary copy is English don't accidentally
   contain the sentence. ─────────────────────────────────────────── */
function checkSister(filename){
  const p = path.join(repoRoot, filename);
  if (!fs.existsSync(p)) return;
  const txt = fs.readFileSync(p, 'utf8');
  // Slice NL-gated regions if present, otherwise treat whole file as bodyish.
  let scrubbed = txt;
  for (const re of [
    /<section[^>]*data-hero-lang="nl"[\s\S]*?<\/section>/g,
    /<div[^>]*data-form-lang="nl"[\s\S]*?<!--\s*\/data-form-lang="nl"\s*-->/g,
  ]) {
    scrubbed = scrubbed.replace(re, '');
  }
  // Also strip the <head> meta description (it can legitimately be
  // Dutch on a Dutch-default page; we're only guarding visible body).
  scrubbed = scrubbed.replace(/<head[\s\S]*?<\/head>/, '');
  check(`${filename}: no canonical Dutch review sentence outside NL-gated regions`, () => {
    assert.ok(!scrubbed.includes(DUTCH_REVIEW_SENTENCE),
      `${filename} leaks the Dutch review sentence outside NL regions`);
  });
}
checkSister('submit-event.html');
checkSister('request-listing.html');

if (failures > 0) {
  console.log('\n' + failures + ' check(s) failed.');
  process.exit(1);
} else {
  console.log('\nAll submit_news_dutch_review_leak checks passed.');
}
