// Test: header-cta-preview.html is a hidden internal artifact (round 2).
//
// Background — 2026-04-27:
//   header-cta-preview.html now hosts FOUR candidate header-CTA directions
//   for Wouter (round 2 — round 1 was rejected as too cramped/frugal).
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
//   7. The preview presents exactly four labelled variants, each rendered
//      inside a real .mast.overlay nav.
//   8. Exactly one variant is marked as recommended.
//   9. The preview never uses the retired "Claim your listing" wording.
//  10. The preview includes both Dutch and English candidate labels.
//  11. A mobile/compact variant is present.
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

/* 6. Live masthead in index.html unchanged — preview did not leak. */
check('live index.html masthead still uses "Update or verify a listing"', () => {
  const idx = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const m = idx.match(/<a\b[^>]*data-mast-cta-listing[^>]*>([^<]+)<\/a>/);
  assert.ok(m, 'production CTA <a data-mast-cta-listing> not found in index.html');
  assert.match(m[1], /Update or verify a listing/,
    'production CTA label changed unexpectedly: "' + m[1].trim() + '"');
});

check('production CTA still points at ?mode=change_request', () => {
  const idx = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const m = idx.match(/<a\b[^>]*data-mast-cta-listing[^>]*>/);
  assert.ok(m, 'production CTA tag not found');
  const href = (m[0].match(/\bhref="([^"]+)"/) || [,''])[1];
  assert.match(href, /\bmode=change_request\b/,
    'production CTA href no longer carries mode=change_request: ' + href);
});

/* 7. Four variants, each inside a .mast.overlay nav. */
check('preview presents exactly four variants (.variant.v-a/.v-b/.v-c/.v-d)', () => {
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
    'Waarom dit de aanbevolen richting is',
    'Wanneer kies je dit',
    'ronde 2',
  ];
  for (const m of dutchMarkers){
    assert.ok(previewHtml.includes(m),
      'expected Dutch rationale marker: ' + m);
  }
});

if (failures > 0) {
  console.log('\n' + failures + ' check(s) failed.');
  process.exit(1);
} else {
  console.log('\nAll header_cta_preview checks passed.');
}
