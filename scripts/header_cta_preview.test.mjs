// Test: header-cta-preview.html is a hidden internal artifact (round 4).
//
// Background — 2026-04-27 (round 4):
//   Wouter chose Variant A (command card) in round 3 and asked whether
//   that form can also work on mobile. Round 4 carries Variant A through
//   to mobile in a single unified design: same accent-rail / mono meta /
//   serif italic action line, restructured into a full-width tappable
//   bar below the header. No pill, generous tap area (>= 44px / WCAG).
//   The preview is NOT public, NOT linked anywhere, and MUST NOT modify
//   the production header.
//
// This test guards:
//   1. The preview file exists.
//   2. <meta name="robots" content="noindex,nofollow"> is declared.
//   3. <meta http-equiv="X-Robots-Tag" content="noindex,..."> is declared.
//   4. The preview is absent from sitemap.xml.
//   5. No production HTML/JS/JSON/XML/TXT links to it.
//   6. The live overlay masthead in index.html still uses the current
//      "Update or verify a listing" CTA — i.e. the preview did not leak.
//   7. The preview presents the three concept variants plus a mobile
//      treatment (v-a, v-b, v-c, v-d), each rendered inside a real
//      .mast.overlay nav.
//   8. Exactly one variant is marked as recommended.
//   9. The preview never uses the retired "Claim your listing" wording.
//  10. The preview includes both Dutch and English candidate labels.
//  11. A mobile/compact variant is present.
//  12. The required new label paradigm is present:
//      "Share to connect" (EN) and "Draag bij aan verbinding" (NL).
//
// Run with: node scripts/header_cta_preview.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const PREVIEW = 'header-cta-preview.html';
const previewPath = path.join(repoRoot, PREVIEW);

let failures = 0;
function check(name, fn){
  try { fn(); console.log('  ok  — ' + name); }
  catch(e){ failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}

/* 1. File exists. */
check('header-cta-preview.html exists at repo root', () => {
  assert.ok(fs.existsSync(previewPath), PREVIEW + ' not found');
});

const previewHtml = fs.readFileSync(previewPath, 'utf8');

/* 2. noindex,nofollow declared. */
check('preview declares <meta name="robots" content="noindex,nofollow,...">', () => {
  const m = previewHtml.match(
    /<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i);
  assert.ok(m, 'no <meta name="robots"> tag');
  assert.match(m[1], /noindex/i, 'robots meta missing noindex: ' + m[1]);
  assert.match(m[1], /nofollow/i, 'robots meta missing nofollow: ' + m[1]);
});

/* 3. X-Robots-Tag belt-and-braces. */
check('preview also declares X-Robots-Tag noindex (belt-and-braces)', () => {
  assert.match(previewHtml,
    /<meta\s+http-equiv=["']X-Robots-Tag["']\s+content=["'][^"']*noindex/i,
    'X-Robots-Tag noindex meta missing');
});

/* 4. Absent from sitemap. */
check('sitemap.xml does not reference header-cta-preview', () => {
  const sm = fs.readFileSync(path.join(repoRoot, 'sitemap.xml'), 'utf8');
  assert.ok(!/header-cta-preview/.test(sm),
    'sitemap.xml unexpectedly references the preview file');
});

/* 5. Not linked from any production HTML/JS/JSON/XML/TXT. */
check('no public file links to header-cta-preview.html', () => {
  const offenders = [];
  for (const f of fs.readdirSync(repoRoot)){
    const full = path.join(repoRoot, f);
    if (!fs.statSync(full).isFile()) continue;
    if (full === previewPath) continue;
    if (!/\.(html|js|json|xml|txt)$/.test(f)) continue;
    const txt = fs.readFileSync(full, 'utf8');
    if (/header-cta-preview/.test(txt)) offenders.push(f);
  }
  for (const sub of ['countries', 'editorials', 'assets', 'i18n', 'functions', 'worker']){
    const dir = path.join(repoRoot, sub);
    if (!fs.existsSync(dir)) continue;
    walk(dir, full => {
      if (full === previewPath) return;
      if (!/\.(html|js|mjs|json|xml|txt)$/.test(full)) return;
      const txt = fs.readFileSync(full, 'utf8');
      if (/header-cta-preview/.test(txt)){
        offenders.push(path.relative(repoRoot, full));
      }
    });
  }
  // The preview's own test obviously mentions the filename — exclude it.
  const filtered = offenders.filter(p => !/header_cta_preview\.test\.mjs$/.test(p));
  assert.deepEqual(filtered, [],
    'preview is referenced from public files: ' + filtered.join(', '));
});

function walk(dir, visit){
  for (const entry of fs.readdirSync(dir)){
    const full = path.join(dir, entry);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, visit);
    else visit(full);
  }
}

/* 6. Live masthead in index.html now ships Variant A (rolled out 2026-04-27).
      The preview file remains as an internal archive; it is the production
      header that must reflect Variant A — not the legacy pill. */
check('live index.html masthead ships Variant A (data-mast-cta-share)', () => {
  const idx = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const m = idx.match(/<a class="mast-cta"[^>]*data-mast-cta-share[^>]*>/);
  assert.ok(m, 'Variant A header CTA <a data-mast-cta-share> not found in index.html');
});

check('preview itself is marked IMPLEMENTED in its banner', () => {
  // Round 5 cleanup: when the variant ships live, the preview gains a
  // status banner so future readers know it is archival, not a backlog item.
  assert.match(previewHtml, /IMPLEMENTED/i,
    'preview should contain an IMPLEMENTED status marker');
});

/* 7. Three concepts + mobile treatment, each inside a .mast.overlay nav. */
check('preview presents three concepts + mobile (.variant.v-a/.v-b/.v-c/.v-d)', () => {
  for (const slug of ['v-a','v-b','v-c','v-d']){
    const re = new RegExp('class=["\']variant ' + slug + '["\']');
    assert.match(previewHtml, re, 'variant block missing: ' + slug);
  }
  // And each variant block contains its own .mast.overlay nav.
  const navs = previewHtml.match(/<nav\b[^>]*class=["']mast overlay["'][^>]*>/g) || [];
  assert.ok(navs.length >= 4,
    'expected at least 4 .mast.overlay navs (one per variant), found ' + navs.length);
});

/* 8. Exactly one recommended marker. */
check('exactly one variant carries the .recommended tag', () => {
  const matches = previewHtml.match(/class=["']variant-tag recommended["']/g) || [];
  assert.equal(matches.length, 1,
    'expected exactly one .variant-tag.recommended, found ' + matches.length);
});

/* 9. No retired "Claim your listing" wording anywhere in the preview. */
check('preview does not use retired "Claim your listing" wording', () => {
  assert.ok(!/claim\s+your\s+listing/i.test(previewHtml),
    'preview unexpectedly contains "Claim your listing"');
  assert.ok(!/claim\s+je\s+vermelding/i.test(previewHtml),
    'preview unexpectedly contains Dutch claim phrasing');
});

/* 10. Both NL and EN candidate labels are present. */
check('preview shows both Dutch and English candidate labels', () => {
  // The Dutch labels we explicitly explore in this round.
  const nlLabels = [
    'Werk mee aan de atlas',
    'Draag bij aan ESRF',
    'Update de atlas',
    'Start je bijdrage',
  ];
  for (const lbl of nlLabels){
    assert.ok(previewHtml.includes(lbl),
      'NL label missing from preview: ' + lbl);
  }
  // And we expose at least the matching English mirrors.
  const enLabels = [
    'Help build the atlas',
    'Contribute to ESRF',
    'Update the atlas',
    'Start your contribution',
  ];
  for (const lbl of enLabels){
    assert.ok(previewHtml.includes(lbl),
      'EN label missing from preview: ' + lbl);
  }
});

/* 11b. Required round-3 leading labels are present:
        "Share to connect" (EN) and "Draag bij aan verbinding" (NL). */
check('preview includes required round-3 leading labels', () => {
  assert.ok(previewHtml.includes('Share to connect'),
    'required EN label "Share to connect" missing from preview');
  assert.ok(previewHtml.includes('Draag bij aan verbinding'),
    'required NL label "Draag bij aan verbinding" missing from preview');
});

/* 11. Mobile / compact variant present. */
check('preview includes a mobile/compact variant (variant D)', () => {
  // The mobile variant uses a stacked .mast-row-cta block — no other variant does.
  assert.match(previewHtml, /class=["']mast-row-cta["']/,
    'mobile/compact .mast-row-cta block missing');
  // And the compact tag should be present in the meta strip.
  assert.match(previewHtml, /variant-tag compact/,
    'compact variant tag missing from variant meta');
});

/* 12. Each variant ships at least one clickable destination
       pointing at a real intake route. */
check('every variant links to /submit-news (real intake route)', () => {
  const sections = previewHtml.split(/<section class="variant /).slice(1);
  // The last "section" is the labels-overview, not a real variant — skip
  // anything that does not contain a .mast.overlay nav.
  const navSections = sections.filter(s => /class=["']mast overlay["']/.test(s));
  assert.ok(navSections.length >= 4, 'fewer than 4 nav-bearing variant sections');
  for (const s of navSections){
    assert.match(s, /href="\/submit-news\?lang=(nl|en)/,
      'variant block missing /submit-news intake link');
  }
});

/* 13. Design rationale present in Dutch (matches Wouter's preference). */
check('preview contains design rationale in Dutch', () => {
  // Heuristic: look for a few unmistakably Dutch rationale markers.
  const dutchMarkers = [
    'Waarom dit werkt',
    'Waarom dit kan tegenvallen',
    'ronde 3',
  ];
  for (const m of dutchMarkers){
    assert.ok(previewHtml.includes(m),
      'expected Dutch rationale marker: ' + m);
  }
});

/* 14. Round 4 — Variant A has a mobile preview alongside its desktop preview. */
check('Variant A includes a mobile preview (round 4 unified design)', () => {
  // The unified showcase block carries data-mobile-preview="variant-a"
  // and contains a dedicated mobile stage marked with data-variant-a-mobile.
  assert.match(previewHtml, /data-mobile-preview=["']variant-a["']/,
    'Variant A unified showcase missing data-mobile-preview="variant-a" hook');
  assert.match(previewHtml, /data-variant-a-mobile/,
    'Variant A mobile stage missing data-variant-a-mobile hook');
  // The mobile stage is a real .mast.overlay nav with the variant-A
  // identity carriers (accent rail + mono meta + serif italic line).
  const mobileBlock = previewHtml.match(
    /<div class="variant-stage v-a-mobile-stage[\s\S]*?<\/div>\s*<\/div>\s*<\/nav>\s*<\/div>/);
  assert.ok(mobileBlock, 'mobile stage block for Variant A not found');
  const m = mobileBlock[0];
  assert.match(m, /class="mast overlay"/,    'mobile preview missing .mast.overlay nav');
  assert.match(m, /class="v-a-rail"/,         'mobile preview missing v-a-rail (identity)');
  assert.match(m, /class="v-a-meta"/,         'mobile preview missing v-a-meta (identity)');
  assert.match(m, /class="v-a-line"/,         'mobile preview missing v-a-line (identity)');
  assert.match(m, /Draag bij aan verbinding/, 'mobile preview missing NL action label');
});

/* 15. Round 4 — Variant A mobile honours min tap-area >= 44px (WCAG 2.2). */
check('Variant A mobile enforces tap-area >= 44px (CSS or explicit note)', () => {
  // We accept either: an enforced CSS min-height of >=44px on the mobile
  // command card, OR an explicit textual note that documents the threshold.
  const cssMatch = previewHtml.match(
    /\.v-a-mobile-stage\s+\.mast-cta\s*\{[^}]*min-height\s*:\s*(\d+)px/);
  const cssOk = cssMatch && Number(cssMatch[1]) >= 44;
  const noteOk = /≥\s*44|>=\s*44|44\s*[×x]\s*44|44\s*px/.test(previewHtml);
  assert.ok(cssOk || noteOk,
    'no min tap-area enforcement found: expected min-height>=44px CSS on '
    + '.v-a-mobile-stage .mast-cta, or an explicit "44px" / "≥44px" note');
});

/* 16. Round 4 — the live production header was not modified.
       (Belt-and-braces alongside check #6 / #7: assert no preview-only
       classes leaked into index.html.) */
check('production index.html carries no preview-only Variant A markup', () => {
  const idx = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const forbidden = [
    'v-a-rail', 'v-a-meta', 'v-a-line', 'v-a-mobile-stage',
    'v-a-unified', 'data-variant-a-mobile', 'data-mobile-preview',
  ];
  for (const tok of forbidden){
    assert.ok(!idx.includes(tok),
      'preview-only token leaked into live index.html: ' + tok);
  }
});

/* 17. Round 4 — required leading labels remain present unchanged. */
check('round-4 leading labels still match the agreed pair', () => {
  // Required pair: NL "Draag bij aan verbinding" + EN "Share to connect".
  // Make sure both appear inside the unified showcase block specifically,
  // not just somewhere lower in the labels-overview table.
  const showcase = previewHtml.match(
    /v-a-unified[\s\S]*?<\/section>/);
  assert.ok(showcase, 'unified Variant A showcase block not found');
  assert.ok(showcase[0].includes('Draag bij aan verbinding'),
    'NL label "Draag bij aan verbinding" missing from unified showcase');
  assert.ok(showcase[0].includes('Share to connect'),
    'EN label "Share to connect" missing from unified showcase');
});

if (failures > 0) {
  console.log('\n' + failures + ' check(s) failed.');
  process.exit(1);
} else {
  console.log('\nAll header_cta_preview checks passed.');
}
