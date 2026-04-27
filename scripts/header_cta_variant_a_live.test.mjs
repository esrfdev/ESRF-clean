// Test: header CTA Variant A is live across all public pages (rolled out
// 2026-04-27). This guards the production rollout that promotes the
// command-card design out of header-cta-preview.html and into every
// public-facing masthead.
//
// What we guard:
//   1. Every public HTML page with a <nav class="mast"> contains a
//      Variant-A header CTA: a single <a class="mast-cta"> tagged with
//      data-mast-cta-share, carrying the rail / meta / action structure.
//   2. The CTA links to the combined intake form with ?lang=… and
//      explicitly NOT with mode=change_request — the header is a general
//      "share to connect" entry, not a listing-update shortcut.
//   3. The CTA action span carries data-i18n="nav.cta_action".
//   4. The CTA meta span carries data-i18n="nav.cta_meta".
//   5. The legacy pill markup ("Update or verify a listing" inside
//      <a class="mast-cta">) is gone from all public pages — and so is
//      any "Claim your listing" wording (regression guard).
//   6. The mobile treatment is testable: the mast-cta has the rail span
//      and the body span, so the responsive CSS can drive the full-width
//      layout under 900px without HTML changes per page.
//   7. style.css enforces a minimum tap area of >=44px on the mobile
//      command card (WCAG 2.2 AA / 2.5.8 minimum target size).
//   8. style.css declares the Variant-A class hooks so the markup is not
//      orphaned (mast-cta-rail, mast-cta-meta, mast-cta-line at minimum).
//   9. app.js syncs ?lang= for the new [data-mast-cta-share] anchor and
//      refreshes its aria-label on language change.
//  10. Every supported ESRF language (i18n/*.json) ships nav.cta_action
//      and nav.cta_meta — no fallback gaps.
//  11. submit-event and request-listing routing still works: the
//      submit-event.html and request-listing.html pages exist and have
//      their own primary action links.
//
// Run with: node scripts/header_cta_variant_a_live.test.mjs

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

// Public pages with a header masthead. Same list used by the rollout.
const PUBLIC_PAGES = [
  'index.html', 'about.html', 'analytics.html', 'directory.html',
  'editorial-emergency-capaciteit-europa-2026.html',
  'editorial-koningsdag-2026.html',
  'editorial-oil-shortage-2026.html',
  'editorial-rotterdam-weerbaarheid-2026.html',
  'editorials.html', 'events.html', 'fund.html', 'map.html', 'news.html',
  'privacy.html', 'request-listing.html', 'responsible-disclosure.html',
  'sponsor.html', 'submit-event.html', 'submit-news.html', 'terms.html',
  'countries/index.html',
];

// Helper: extract the masthead nav block (between first <nav class="mast"
// and its closing </nav>). The body CTAs in directory / request-listing /
// about must NOT be conflated with the header.
function extractHeader(html){
  const m = html.match(/<nav\s+class="mast[^"]*"[\s\S]*?<\/nav>/);
  return m ? m[0] : null;
}

/* 1. Every public page has a Variant-A header CTA. */
for (const page of PUBLIC_PAGES){
  check(`${page}: header contains Variant A CTA`, () => {
    const html = fs.readFileSync(path.join(repoRoot, page), 'utf8');
    const header = extractHeader(html);
    assert.ok(header, `no <nav class="mast"> found in ${page}`);
    assert.match(header, /<a class="mast-cta"[^>]*data-mast-cta-share/,
      `Variant A header CTA missing in ${page}`);
    assert.match(header, /class="mast-cta-rail"/,
      `mast-cta-rail span missing in ${page} header`);
    assert.match(header, /class="mast-cta-body"/,
      `mast-cta-body span missing in ${page} header`);
    assert.match(header, /class="mast-cta-meta"/,
      `mast-cta-meta span missing in ${page} header`);
    assert.match(header, /class="mast-cta-line"/,
      `mast-cta-line span missing in ${page} header`);
  });
}

/* 2. Header CTA href routes to /submit-news with ?lang and NO mode preset. */
for (const page of PUBLIC_PAGES){
  check(`${page}: header CTA href is /submit-news with ?lang= and no mode preset`, () => {
    const html = fs.readFileSync(path.join(repoRoot, page), 'utf8');
    const header = extractHeader(html) || '';
    const m = header.match(/<a class="mast-cta"[^>]*data-mast-cta-share[^>]*>/);
    assert.ok(m, 'header CTA tag not found in ' + page);
    const href = (m[0].match(/\bhref="([^"]+)"/) || [,''])[1];
    assert.match(href, /^\/submit-news\?/,
      'header CTA href should start with /submit-news?: ' + href);
    assert.match(href, /\blang=[a-z]{2}\b/,
      'header CTA href should carry ?lang=<2-letter>: ' + href);
    assert.ok(!/\bmode=/.test(href),
      'header CTA href must NOT carry a mode preset (this is general intake): ' + href);
  });
}

/* 3 + 4. i18n keys wired through inner spans. */
for (const page of PUBLIC_PAGES){
  check(`${page}: header CTA carries data-i18n="nav.cta_action" and "nav.cta_meta"`, () => {
    const html = fs.readFileSync(path.join(repoRoot, page), 'utf8');
    const header = extractHeader(html) || '';
    assert.match(header, /data-i18n="nav\.cta_action"/,
      'data-i18n="nav.cta_action" missing in ' + page);
    assert.match(header, /data-i18n="nav\.cta_meta"/,
      'data-i18n="nav.cta_meta" missing in ' + page);
  });
}

/* 5. Legacy pill markup eradicated; no "Claim" regressions. */
for (const page of PUBLIC_PAGES){
  check(`${page}: legacy "Update or verify a listing" header pill is gone`, () => {
    const html = fs.readFileSync(path.join(repoRoot, page), 'utf8');
    const header = extractHeader(html) || '';
    // The old pill was an <a class="mast-cta"> with the literal label as
    // its only content. Other pages may still legitimately reference the
    // label outside the masthead (in-page CTAs on directory / about /
    // request-listing) — those are not regressions.
    assert.ok(!/<a class="mast-cta"[^>]*>Update or verify a listing<\/a>/.test(header),
      'old pill still present in header of ' + page);
    assert.ok(!/Claim your listing/i.test(html),
      '"Claim your listing" must not return: ' + page);
    assert.ok(!/Claim je vermelding/i.test(html),
      '"Claim je vermelding" must not return: ' + page);
  });
}

/* 6. The mobile-friendly sub-spans exist so the responsive CSS can drive
      the full-width layout without per-page HTML changes. */
check('Variant A markup exposes the spans that responsive CSS drives', () => {
  const idx = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const header = extractHeader(idx) || '';
  // Order matters: rail must come before the body so the grid lays out
  // correctly. We assert their relative order.
  const railIdx = header.indexOf('class="mast-cta-rail"');
  const bodyIdx = header.indexOf('class="mast-cta-body"');
  assert.ok(railIdx > -1 && bodyIdx > -1, 'rail/body spans missing');
  assert.ok(railIdx < bodyIdx,
    'mast-cta-rail must precede mast-cta-body (CSS grid order)');
});

/* 7. CSS enforces minimum tap area >=44px (WCAG 2.2 AA / 2.5.8). */
check('style.css enforces min-height >= 44px on .mast-cta', () => {
  const css = fs.readFileSync(path.join(repoRoot, 'style.css'), 'utf8');
  // Look for any min-height declaration on .mast-cta and require it >=44px.
  // We accept the value either in the base rule or inside the responsive
  // override — both are valid as long as one of them lands on >=44.
  const matches = [...css.matchAll(/\.mast-cta\b[^{]*\{[^}]*min-height\s*:\s*(\d+)px/g)];
  assert.ok(matches.length > 0, 'no min-height declaration found on .mast-cta');
  const ok = matches.some(m => Number(m[1]) >= 44);
  assert.ok(ok, 'no min-height >= 44px on .mast-cta — found: '
    + matches.map(m => m[1] + 'px').join(', '));
});

/* 8. CSS declares the Variant-A class hooks. */
check('style.css declares Variant A class hooks (rail / meta / line / arrow)', () => {
  const css = fs.readFileSync(path.join(repoRoot, 'style.css'), 'utf8');
  for (const cls of ['.mast-cta-rail', '.mast-cta-meta', '.mast-cta-line', '.mast-cta-arrow']){
    assert.ok(css.includes(cls), 'style.css missing class hook: ' + cls);
  }
});

/* 9. app.js syncs ?lang on the new header CTA. */
check('app.js targets [data-mast-cta-share] and sets ?lang from current language', () => {
  const js = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
  assert.match(js, /\[data-mast-cta-share\]/,
    'app.js should query [data-mast-cta-share] anchors');
  // The sync must set lang on the URL.
  assert.match(js, /searchParams\.set\(['"]lang['"]/,
    'app.js should set the lang search param');
  // And it must NOT re-add mode for the share CTA.
  // (We only check that there is at least one searchParams.delete('mode')
  //  — the listing CTA still adds it for its branch.)
  assert.match(js, /searchParams\.delete\(['"]mode['"]\)/,
    'app.js should drop mode for the general share CTA');
  // It refreshes the aria-label from the localised action.
  assert.match(js, /aria-label/i,
    'app.js should refresh aria-label on the share CTA');
});

/* 10. Every supported ESRF language ships nav.cta_action / nav.cta_meta. */
const I18N_DIR = path.join(repoRoot, 'i18n');
const LANG_FILES = fs.readdirSync(I18N_DIR).filter(f => /^[a-z]{2}\.json$/.test(f));

check('i18n/*.json: every language defines nav.cta_action and nav.cta_meta', () => {
  const missing = [];
  for (const f of LANG_FILES){
    const data = JSON.parse(fs.readFileSync(path.join(I18N_DIR, f), 'utf8'));
    if (!data.nav || typeof data.nav.cta_action !== 'string' || !data.nav.cta_action.trim()){
      missing.push(f + ' (cta_action)');
    }
    if (!data.nav || typeof data.nav.cta_meta !== 'string' || !data.nav.cta_meta.trim()){
      missing.push(f + ' (cta_meta)');
    }
  }
  assert.deepEqual(missing, [], 'missing keys: ' + missing.join(', '));
});

check('i18n/en.json: nav.cta_action == "Share to connect"', () => {
  const en = JSON.parse(fs.readFileSync(path.join(I18N_DIR, 'en.json'), 'utf8'));
  assert.equal(en.nav.cta_action, 'Share to connect');
});

check('i18n/nl.json: nav.cta_action == "Draag bij aan verbinding"', () => {
  const nl = JSON.parse(fs.readFileSync(path.join(I18N_DIR, 'nl.json'), 'utf8'));
  assert.equal(nl.nav.cta_action, 'Draag bij aan verbinding');
});

check('expected language coverage: 27 ESRF locales', () => {
  // We don't pin the exact list (i18n.js is the source of truth), but we
  // at least guard that no major locale has been silently dropped.
  assert.ok(LANG_FILES.length >= 27,
    'expected >=27 language files in i18n/, found ' + LANG_FILES.length);
});

/* 11. submit-event and request-listing pages still exist with own actions. */
check('submit-event.html and request-listing.html still ship', () => {
  for (const f of ['submit-event.html', 'request-listing.html']){
    const p = path.join(repoRoot, f);
    assert.ok(fs.existsSync(p), 'missing public page: ' + f);
    const html = fs.readFileSync(p, 'utf8');
    // At least one anchor in the page targets /submit-news (the combined
    // intake form is now the destination for both flows).
    assert.match(html, /href="\/submit-news[^"]*"/,
      f + ' should still link to /submit-news intake');
  }
});

if (failures > 0) {
  console.log('\n' + failures + ' check(s) failed.');
  process.exit(1);
} else {
  console.log('\nAll header_cta_variant_a_live checks passed.');
}
