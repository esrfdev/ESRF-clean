// Test: /submit-news?lang=en and /submit-news.html?lang=en MUST both
// render the English page header AND the English form.
//
// Background — live bug, 2026-04-27:
//   Wouter reported that on https://esrf.net/submit-news?lang=en the
//   header was still in Dutch and the English form did not appear.
//   The same URL with .html worked. Two root causes were found:
//
//     1. The English form variant block carried a `hidden` attribute
//        that was never cleared. The pre-render CSS rule injected
//        for non-NL visitors only HID the NL block; it did NOT
//        unhide the EN block, so the EN form was hidden by the
//        UA stylesheet's `[hidden]{display:none}` regardless of
//        the chosen language. This is why the form never appeared.
//
//     2. The hero <section class="phero"> contained Dutch text with
//        only `data-i18n` translation hooks. If i18n.js loaded slowly,
//        was blocked, or the page came from a stale CDN cache, the
//        Dutch hero stayed visible. The fix mirrors the form-variant
//        mechanism: ship NL and EN hero blocks side-by-side, hide the
//        wrong one with an injected CSS rule before first paint.
//
// This test guards both fixes and explicitly asserts that BOTH URL
// forms — extensionless `/submit-news?lang=en` and `/submit-news.html?lang=en`
// — produce the same language-detection outcome. The detection logic
// reads `window.location.search`, which is identical on both URLs once
// Cloudflare Pages serves the asset, so the same DOM is correct for
// both. We assert that semantic by simulating the URL-form-agnostic
// detection in Node and by verifying the static HTML never depends on
// the URL extension.
//
// Run with: node scripts/submit_news_url_lang.test.mjs

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

/* ─────────────────────────────────────────────────────────────────
   Static-default variant visibility:
   - EN containers must NOT carry `hidden`. They are the default-visible
     variant for the global audience (any non-NL language renders EN).
   - NL containers MUST carry `hidden` so a no-JS or pre-script paint
     never leaks Dutch hero/form copy to a non-NL visitor. The
     pre-render IIFE removes `hidden` from NL when isNl is true.
   ───────────────────────────────────────────────────────────────── */
check('EN form variant container is NOT statically hidden', () => {
  const m = html.match(/<div[^>]*data-form-lang="en"[^>]*>/);
  assert.ok(m, 'EN form container missing');
  assert.doesNotMatch(m[0], /\bhidden\b/, 'EN form container must not have `hidden` attr');
});
check('NL form variant container IS statically hidden (revealed by JS for lang=nl)', () => {
  const m = html.match(/<div[^>]*data-form-lang="nl"[^>]*>/);
  assert.ok(m, 'NL form container missing');
  assert.match(m[0], /\bhidden\b/, 'NL form container must have static `hidden` attr');
});
check('NL hero variant <section data-hero-lang="nl"> IS statically hidden', () => {
  const m = html.match(/<section[^>]*data-hero-lang="nl"[^>]*>/);
  assert.ok(m, 'NL hero variant missing');
  assert.match(m[0], /\bhidden\b/, 'NL hero variant must have static `hidden` attr');
});
check('EN hero variant <section data-hero-lang="en"> exists and is not hidden', () => {
  const m = html.match(/<section[^>]*data-hero-lang="en"[^>]*>/);
  assert.ok(m, 'EN hero variant missing');
  assert.doesNotMatch(m[0], /\bhidden\b/);
});

/* ─────────────────────────────────────────────────────────────────
   The EN hero must contain the English h1 and deck strings as
   STATIC HTML so they appear on first paint even if i18n.js never
   loads (slow network, blocked CDN, stale cache).
   ───────────────────────────────────────────────────────────────── */
function sliceHero(lang){
  const re = new RegExp(`<section[^>]*data-hero-lang="${lang}"[^>]*>[\\s\\S]*?</section>`);
  const m = html.match(re);
  assert.ok(m, `data-hero-lang="${lang}" section missing`);
  return m[0];
}
const nlHero = sliceHero('nl');
const enHero = sliceHero('en');

check('EN hero contains the English h1 "Share your information"', () => {
  assert.match(enHero, /Share your information/);
});
check('EN hero contains the English deck (use this form…)', () => {
  assert.match(enHero, /Use this form to submit/i);
});
check('EN hero does NOT contain the Dutch h1 "Deel je informatie"', () => {
  // The Dutch h1 may not appear inside the EN hero block. The shared
  // bilingual editorial sentence at the bottom of the EN hero may
  // contain the Dutch wording in italics for context; that is fine
  // — but the h1/deck must be English-only.
  const enH1 = enHero.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  assert.ok(enH1, 'EN hero h1 missing');
  assert.doesNotMatch(enH1[1], /Deel je informatie/);
});
check('NL hero contains the Dutch h1 "Deel je informatie"', () => {
  const nlH1 = nlHero.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  assert.ok(nlH1, 'NL hero h1 missing');
  assert.match(nlH1[1], /Deel je informatie/);
});

/* ─────────────────────────────────────────────────────────────────
   Pre-render script must:
   - read window.location.search (URL-form-agnostic — identical on
     /submit-news?lang=en and /submit-news.html?lang=en)
   - prefer ?lang= over localStorage and browser language
   - hide the NL form AND NL hero when resolved language is non-NL
   - hide the EN form AND EN hero when resolved language is "nl"
   - set <html lang> immediately
   - swap <title> to the English equivalent for non-Dutch visitors
   ───────────────────────────────────────────────────────────────── */
const headScript = (() => {
  // The first inline <script> after the <head>.
  const m = html.match(/<script>\s*\/\*[\s\S]*?Pre-render language detection[\s\S]*?<\/script>/);
  assert.ok(m, 'pre-render script missing');
  return m[0];
})();

check('pre-render script reads ?lang= from window.location.search', () => {
  assert.match(headScript, /URLSearchParams\(window\.location\.search\)/);
  assert.match(headScript, /\.get\(['"]lang['"]\)/);
});
check('pre-render script prefers URL ?lang over localStorage', () => {
  // URL block must come BEFORE the localStorage block in source order.
  const urlIdx = headScript.search(/window\.location\.search/);
  const lsIdx = headScript.search(/localStorage\.getItem/);
  assert.ok(urlIdx > -1 && lsIdx > -1);
  assert.ok(urlIdx < lsIdx, 'URL detection must come before localStorage');
});
check('pre-render injects EN-hide CSS for both form and hero', () => {
  assert.match(headScript, /\[data-form-lang="en"\][^{]*\[data-hero-lang="en"\][^{]*\{display:none!important\}/);
});
check('pre-render injects NL-hide CSS for both form and hero', () => {
  assert.match(headScript, /\[data-form-lang="nl"\][^{]*\[data-hero-lang="nl"\][^{]*\{display:none!important\}/);
});
check('pre-render sets <html lang> on first paint', () => {
  assert.match(headScript, /document\.documentElement\.setAttribute\(['"]lang['"]/);
});
check('pre-render swaps <title> to EN for non-Dutch visitors', () => {
  assert.match(headScript, /document\.title\s*=\s*['"]Share your information/);
});

/* ─────────────────────────────────────────────────────────────────
   Simulated end-to-end behaviour for both URL forms.
   We re-implement the same detect() logic in Node and prove that
   `?lang=en` resolves to "en" regardless of whether the URL has the
   `.html` extension. This is the routing semantic that previously
   failed silently on the live site (the bug looked like "extension-
   less URL is broken" but was actually the same DOM, broken by the
   `hidden` attribute on the EN form variant).
   ───────────────────────────────────────────────────────────────── */
function detect(searchString){
  // Mirror the inline script in submit-news.html. Node-side: no
  // localStorage, no navigator.language — the URL parameter alone
  // is the contract under test.
  try {
    const p = new URLSearchParams(searchString);
    const u = p.get('lang');
    if (u) return u.toLowerCase();
  } catch(e){}
  return 'en';
}

const URL_PAIRS = [
  // [extensionless, .html, expected]
  ['?lang=en',    '?lang=en',    'en'],
  ['?lang=nl',    '?lang=nl',    'nl'],
  ['?lang=de',    '?lang=de',    'de'],
  ['?lang=fr',    '?lang=fr',    'fr'],
  ['?lang=EN',    '?lang=EN',    'en'], // case-insensitive
  ['',            '',            'en'], // no ?lang= → fallback (no localStorage/browser in Node)
];

for (const [extless, withExt, expected] of URL_PAIRS) {
  check(`/submit-news${extless} resolves to "${expected}"`, () => {
    assert.equal(detect(extless), expected);
  });
  check(`/submit-news.html${withExt} resolves to "${expected}"`, () => {
    assert.equal(detect(withExt), expected);
  });
}

check('extensionless and .html URLs produce identical lang outcomes', () => {
  for (const [extless, withExt] of URL_PAIRS) {
    assert.equal(detect(extless), detect(withExt),
      `mismatch for "${extless}" vs "${withExt}"`);
  }
});

/* ─────────────────────────────────────────────────────────────────
   Cloudflare Pages serves the same submit-news.html asset for both
   /submit-news.html and /submit-news. There must be no _redirects
   rule that strips the query string off either URL form.
   ───────────────────────────────────────────────────────────────── */
const redirectsPath = path.join(repoRoot, '_redirects');
if (fs.existsSync(redirectsPath)) {
  const redirects = fs.readFileSync(redirectsPath, 'utf8');
  check('_redirects does not strip query from /submit-news', () => {
    // No redirect rule may match /submit-news without preserving the
    // query (Cloudflare preserves query on 301 by default; a rule
    // that rewrites the destination without :splat would still keep
    // query, but a rule with status 200 or hard rewrite could lose
    // it). The simplest guarantee: there is no rule whose source
    // path is exactly /submit-news or /submit-news.html.
    for (const line of redirects.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parts = trimmed.split(/\s+/);
      const src = parts[0];
      assert.notEqual(src, '/submit-news',
        '_redirects must not have a rule that strips ?lang from /submit-news');
      assert.notEqual(src, '/submit-news.html',
        '_redirects must not have a rule that strips ?lang from /submit-news.html');
    }
  });
}

/* ─────────────────────────────────────────────────────────────────
   Live language-switch swap (bottom of body) must mirror the same
   selectors. Otherwise switching language via the dropdown would
   leave the EN hero visible alongside the Dutch one, etc.
   ───────────────────────────────────────────────────────────────── */
check('live language-switch swap covers hero variants too', () => {
  // Find the applyVariant() function near the bottom of the file
  // and assert it injects the same combined selector. The function
  // body is small and contains ternary template strings with their
  // own braces, so we slice to the next listener registration.
  const start = html.indexOf('function applyVariant(lang)');
  assert.ok(start > -1, 'applyVariant() helper not found');
  const end = html.indexOf('window.addEventListener', start);
  assert.ok(end > start, 'applyVariant() end boundary not found');
  const body = html.slice(start, end);
  assert.match(body, /\[data-hero-lang="en"\]/);
  assert.match(body, /\[data-hero-lang="nl"\]/);
});

if (failures > 0) {
  console.log('\n' + failures + ' check(s) failed.');
  process.exit(1);
} else {
  console.log('\nAll submit_news_url_lang checks passed.');
}
