// Test: regression for the live bug where ?lang=en showed neither the
// English nor the Dutch form on https://esrf.net/submit-news.html?lang=en.
//
// Root cause was the EN container carrying a `hidden` HTML attribute as
// a no-JS safety net. CSS `display:none` for [data-form-lang="nl"] hid
// the Dutch form, but the `hidden` attribute on the EN container kept
// it invisible regardless. Result: blank page for non-Dutch visitors.
//
// This file does NOT just check string presence — it extracts the
// actual pre-paint script from submit-news.html, executes it inside a
// minimal DOM stub, and asserts the resolved visibility of both
// containers for ?lang=en, ?lang=de, ?lang=nl, and the no-?lang case.
//
// Run with: node scripts/submit_news_visibility.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(repoRoot, 'submit-news.html'), 'utf8');

let failures = 0;
function check(name, fn){
  try { fn(); console.log('  ok  — ' + name); }
  catch(e){ failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}

/* ── 1. Static HTML guarantees ─────────────────────────────────────── */

// The EN container must NOT carry a `hidden` attribute in the static
// HTML — that was the live bug. The pre-paint script is responsible
// for hiding the wrong variant based on the resolved language.
check('static HTML: EN container has no `hidden` attribute', () => {
  const m = html.match(/<div\s+data-form-lang="en"[^>]*>/);
  assert.ok(m, 'EN container open tag missing');
  assert.ok(!/\bhidden\b/.test(m[0]),
    'data-form-lang="en" must not have a `hidden` attribute (live bug regression)');
});

// The NL container must also not carry a `hidden` attribute — the JS
// is the single source of truth for visibility.
check('static HTML: NL container has no `hidden` attribute', () => {
  const m = html.match(/<div\s+data-form-lang="nl"[^>]*>/);
  assert.ok(m, 'NL container open tag missing');
  assert.ok(!/\bhidden\b/.test(m[0]),
    'data-form-lang="nl" must not have a `hidden` attribute');
});

// Visible manual fallback link so a visitor can always force a variant.
check('static HTML: visible manual language fallback links present', () => {
  assert.match(html, /id="sv-lang-fallback"/);
  assert.match(html, /href="\?lang=nl"/);
  assert.match(html, /href="\?lang=en"/);
});

/* ── 2. Extract the pre-paint script and run it under each lang ─── */

// Pull out the inline script that defines window.__esrfFormLang. It
// runs synchronously in <head>, so we can re-execute it in a stub DOM.
const prePaintMatch = html.match(
  /<script>\s*\/\* ── Pre-render language detection[\s\S]*?<\/script>/
);
assert.ok(prePaintMatch, 'pre-paint detection script missing');
// Strip <script> tags so vm.runInContext gets pure JS.
const prePaintSrc = prePaintMatch[0]
  .replace(/^<script>/, '')
  .replace(/<\/script>$/, '');

function makeDom({ search = '', stored = null, navLang = 'en' } = {}){
  /* Minimal DOM stub: enough to run the pre-paint script. We track
     style elements in the head, the two variant containers, and their
     `hidden` attribute state. */
  const styles = [];
  const containers = {
    nl: makeEl('nl'),
    en: makeEl('en'),
  };
  function makeEl(lang){
    const attrs = {};
    return {
      _attrs: attrs,
      _lang: lang,
      removeAttribute(k){ delete attrs[k]; },
      setAttribute(k, v){ attrs[k] = String(v); },
      getAttribute(k){ return attrs[k] === undefined ? null : attrs[k]; },
      hasAttribute(k){ return Object.prototype.hasOwnProperty.call(attrs, k); },
    };
  }
  const headById = {};
  const document = {
    readyState: 'loading',
    head: {
      appendChild(node){ styles.push(node); if (node.id) headById[node.id] = node; },
    },
    createElement(tag){
      if (tag === 'style') {
        return { tagName: 'STYLE', id: '', textContent: '' };
      }
      return { tagName: tag.toUpperCase() };
    },
    querySelector(sel){
      if (sel === '[data-form-lang="nl"]') return containers.nl;
      if (sel === '[data-form-lang="en"]') return containers.en;
      return null;
    },
    getElementById(id){ return headById[id] || null; },
    addEventListener(){},
  };
  const localStorage = {
    _data: stored ? { esrfnetLang: stored } : {},
    getItem(k){ return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
    setItem(k, v){ this._data[k] = String(v); },
  };
  const window = {
    location: { search },
    __esrfFormLang: undefined,
  };
  const navigator = { language: navLang };
  return { window, document, localStorage, navigator, styles, containers, headById };
}

function runPrePaint(opts){
  const env = makeDom(opts);
  const ctx = vm.createContext({
    window: env.window,
    document: env.document,
    localStorage: env.localStorage,
    navigator: env.navigator,
    URLSearchParams,
    console,
  });
  vm.runInContext(prePaintSrc, ctx);
  return env;
}

/* `effectivelyVisible` mirrors what a real browser would render:
   - `hidden` HTML attribute → not visible.
   - matching style rule with display:none → not visible.
   Otherwise visible. */
function effectivelyVisible(env, lang){
  const el = env.containers[lang];
  if (el.hasAttribute('hidden')) return false;
  const style = env.headById['sv-form-lang-style'];
  const css = style ? (style.textContent || '') : '';
  // The injected stylesheet is a single rule of the form
  //   [data-form-lang="X"]{display:none!important}
  const m = css.match(/\[data-form-lang="(nl|en)"\]\{display:none/);
  if (m && m[1] === lang) return false;
  return true;
}

/* ── 3. Resolved visibility per ?lang= scenario ──────────────────── */

check('?lang=en → EN visible, NL hidden', () => {
  const env = runPrePaint({ search: '?lang=en' });
  assert.equal(env.window.__esrfFormLang, 'en');
  assert.equal(effectivelyVisible(env, 'en'), true,  'EN must be visible');
  assert.equal(effectivelyVisible(env, 'nl'), false, 'NL must be hidden');
});

check('?lang=de → EN visible, NL hidden (any non-nl renders EN)', () => {
  const env = runPrePaint({ search: '?lang=de' });
  assert.equal(env.window.__esrfFormLang, 'de');
  assert.equal(effectivelyVisible(env, 'en'), true);
  assert.equal(effectivelyVisible(env, 'nl'), false);
});

check('?lang=fr → EN visible, NL hidden', () => {
  const env = runPrePaint({ search: '?lang=fr' });
  assert.equal(effectivelyVisible(env, 'en'), true);
  assert.equal(effectivelyVisible(env, 'nl'), false);
});

check('?lang=nl → NL visible, EN hidden', () => {
  const env = runPrePaint({ search: '?lang=nl' });
  assert.equal(env.window.__esrfFormLang, 'nl');
  assert.equal(effectivelyVisible(env, 'nl'), true);
  assert.equal(effectivelyVisible(env, 'en'), false);
});

check('?lang=EN (uppercase) → EN visible, NL hidden', () => {
  const env = runPrePaint({ search: '?lang=EN' });
  assert.equal(env.window.__esrfFormLang, 'en');
  assert.equal(effectivelyVisible(env, 'en'), true);
  assert.equal(effectivelyVisible(env, 'nl'), false);
});

check('no ?lang= but localStorage=nl → NL visible', () => {
  const env = runPrePaint({ search: '', stored: 'nl', navLang: 'en' });
  assert.equal(effectivelyVisible(env, 'nl'), true);
  assert.equal(effectivelyVisible(env, 'en'), false);
});

check('no ?lang= and no localStorage, navigator=en → EN visible', () => {
  const env = runPrePaint({ search: '', stored: null, navLang: 'en-US' });
  assert.equal(effectivelyVisible(env, 'en'), true);
  assert.equal(effectivelyVisible(env, 'nl'), false);
});

check('no ?lang= and no localStorage, navigator=nl-NL → NL visible', () => {
  const env = runPrePaint({ search: '', stored: null, navLang: 'nl-NL' });
  assert.equal(effectivelyVisible(env, 'nl'), true);
  assert.equal(effectivelyVisible(env, 'en'), false);
});

check('?lang=en wins over localStorage=nl', () => {
  const env = runPrePaint({ search: '?lang=en', stored: 'nl' });
  assert.equal(effectivelyVisible(env, 'en'), true);
  assert.equal(effectivelyVisible(env, 'nl'), false);
});

/* ── 4. The injected style tag has the expected id and rule ──────── */

check('pre-paint script injects #sv-form-lang-style', () => {
  const env = runPrePaint({ search: '?lang=en' });
  const s = env.headById['sv-form-lang-style'];
  assert.ok(s, 'style tag must be appended to head');
  assert.match(s.textContent, /\[data-form-lang="nl"\]\{display:none!important\}/);
});

if (failures > 0) {
  console.log('\n' + failures + ' check(s) failed.');
  process.exit(1);
} else {
  console.log('\nAll submit_news_visibility checks passed.');
}
