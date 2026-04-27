// Test: header-cta-preview.html is a hidden internal artifact.
//
// Background — 2026-04-27:
//   header-cta-preview.html exists so Wouter can review three candidate
//   replacements for the masthead CTA label. It is NOT public, NOT linked
//   anywhere on the site, and MUST NOT modify the production header.
//
// This test guards five things:
//   1. The preview file exists.
//   2. It declares <meta name="robots" content="noindex,...">.
//   3. It is absent from sitemap.xml.
//   4. No production HTML page links to it (nav, footer, content, scripts).
//   5. The live overlay masthead in index.html still uses the current
//      "Update or verify a listing" CTA — i.e. the preview did not leak
//      into production.
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
check('preview declares <meta name="robots" content="noindex,...">', () => {
  const m = previewHtml.match(
    /<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i);
  assert.ok(m, 'no <meta name="robots"> tag');
  assert.match(m[1], /noindex/i, 'robots meta missing noindex: ' + m[1]);
  assert.match(m[1], /nofollow/i, 'robots meta missing nofollow: ' + m[1]);
});

check('preview also declares X-Robots-Tag noindex (belt-and-braces)', () => {
  assert.match(previewHtml,
    /<meta\s+http-equiv=["']X-Robots-Tag["']\s+content=["'][^"']*noindex/i,
    'X-Robots-Tag noindex meta missing');
});

/* 3. Absent from sitemap. */
check('sitemap.xml does not reference header-cta-preview', () => {
  const sm = fs.readFileSync(path.join(repoRoot, 'sitemap.xml'), 'utf8');
  assert.ok(!/header-cta-preview/.test(sm),
    'sitemap.xml unexpectedly references the preview file');
});

/* 4. Not linked from any production HTML. */
check('no public HTML links to header-cta-preview.html', () => {
  const offenders = [];
  for (const f of fs.readdirSync(repoRoot)){
    const full = path.join(repoRoot, f);
    if (!fs.statSync(full).isFile()) continue;
    if (full === previewPath) continue;
    if (!/\.(html|js|json|xml|txt)$/.test(f)) continue;
    const txt = fs.readFileSync(full, 'utf8');
    if (/header-cta-preview/.test(txt)) offenders.push(f);
  }
  // Also check countries/, editorials/, assets/
  for (const sub of ['countries', 'editorials', 'assets']){
    const dir = path.join(repoRoot, sub);
    if (!fs.existsSync(dir)) continue;
    walk(dir, full => {
      if (full === previewPath) return;
      if (!/\.(html|js|json|xml|txt)$/.test(full)) return;
      const txt = fs.readFileSync(full, 'utf8');
      if (/header-cta-preview/.test(txt)){
        offenders.push(path.relative(repoRoot, full));
      }
    });
  }
  assert.deepEqual(offenders, [],
    'preview is referenced from public files: ' + offenders.join(', '));
});

function walk(dir, visit){
  for (const entry of fs.readdirSync(dir)){
    const full = path.join(dir, entry);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, visit);
    else visit(full);
  }
}

/* 5. Live masthead in index.html unchanged — preview did not leak. */
check('live index.html masthead still uses "Update or verify a listing"', () => {
  const idx = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  // The production CTA tag carries data-mast-cta-listing and the
  // current EN fallback string. We assert both.
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

/* The preview itself is allowed to (and does) reference labels and routes
   we may later adopt — that's the point of the preview. We don't lint
   strings inside the preview file. */

if (failures > 0) {
  console.log('\n' + failures + ' check(s) failed.');
  process.exit(1);
} else {
  console.log('\nAll header_cta_preview checks passed.');
}
