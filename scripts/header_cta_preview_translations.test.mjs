// Test: round-5 multilingual translations table for the chosen Variant A
// header CTA in header-cta-preview.html.
//
// Background — 2026-04-27 (round 5):
//   Wouter chose Variant A in round 3 ("Draag bij aan verbinding" /
//   "Share to connect") and confirmed in round 4 that one unified shape
//   works on desktop and mobile. Round 5 delivers that chosen action
//   line in all 27 site languages so native speakers can do a final
//   nuance pass before sitewide rollout. The live header is still NOT
//   touched and the preview remains noindex/nofollow + out of sitemap.
//
// This test guards specifically:
//   1. All 27 ESRF language codes are present in the translations table.
//   2. The NL anchor "Draag bij aan verbinding" appears as a translation row.
//   3. The EN anchor "Share to connect" appears as a translation row.
//   4. The translations section is properly tagged (data-translations).
//   5. Each language row carries a non-empty translation cell (no blank
//      English fallback rows).
//   6. The live index.html header CTA is unchanged ("Update or verify a
//      listing" → ?mode=change_request) — the multilingual rollout has
//      NOT leaked into production yet.
//   7. The preview is still noindex/nofollow.
//   8. The preview is still absent from sitemap.xml.
//   9. No production HTML/JS/JSON/XML/TXT links to the preview file.
//  10. The translations note flags that local review is still needed.
//
// Run with: node scripts/header_cta_preview_translations.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const PREVIEW = 'header-cta-preview.html';
const previewPath = path.join(repoRoot, PREVIEW);

// All 27 ESRF site languages (matches i18n/*.json).
const ESRF_LANGS = [
  'nl','en','bg','cs','da','de','el','es','et','fi',
  'fr','ga','hr','hu','is','it','lt','lv','mt','no',
  'pl','pt','ro','sk','sl','sv','uk',
];

let failures = 0;
function check(name, fn){
  try { fn(); console.log('  ok  — ' + name); }
  catch(e){ failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}

/* 0. Sanity — preview exists. */
check('preview file exists', () => {
  assert.ok(fs.existsSync(previewPath), PREVIEW + ' not found');
});

const previewHtml = fs.readFileSync(previewPath, 'utf8');

/* 1. All 27 language codes present. */
check('all 27 ESRF language codes are present in translations table', () => {
  // Confirm a translations table block exists.
  assert.match(previewHtml, /data-translations\b/,
    'translations table not tagged with data-translations');

  // Find each row by its data-lang attribute.
  for (const code of ESRF_LANGS){
    const re = new RegExp('data-lang=["\']' + code + '["\']');
    assert.match(previewHtml, re, 'missing translation row for language: ' + code);
  }
});

/* 2. NL anchor phrase present in translations table. */
check('NL anchor "Draag bij aan verbinding" present as a translation', () => {
  // Match a translation cell that carries lang="nl" with the anchor phrase.
  const nlCell = previewHtml.match(
    /<td[^>]*class="translation"[^>]*lang="nl"[^>]*>([^<]+)<\/td>/);
  assert.ok(nlCell, 'no NL translation cell found in translations table');
  assert.match(nlCell[1], /Draag bij aan verbinding/,
    'NL translation does not match anchor "Draag bij aan verbinding"');
});

/* 3. EN anchor phrase present in translations table. */
check('EN anchor "Share to connect" present as a translation', () => {
  const enCell = previewHtml.match(
    /<td[^>]*class="translation"[^>]*lang="en"[^>]*>([^<]+)<\/td>/);
  assert.ok(enCell, 'no EN translation cell found in translations table');
  assert.match(enCell[1], /Share to connect/,
    'EN translation does not match anchor "Share to connect"');
});

/* 4. Translations section tagged. */
check('translations section is tagged with data-translations-table', () => {
  assert.match(previewHtml, /data-translations-table\b/,
    'translations section missing data-translations-table marker');
});

/* 5. Every language row carries a non-empty translation cell. */
check('every language row has a non-empty translation cell', () => {
  // Extract the translations <table> body and pull out per-row data.
  const tableMatch = previewHtml.match(
    /<table[^>]*data-translations[\s\S]*?<\/table>/);
  assert.ok(tableMatch, 'translations <table> block not found');
  const tableHtml = tableMatch[0];

  for (const code of ESRF_LANGS){
    const rowRe = new RegExp(
      '<tr[^>]*data-lang=["\']' + code + '["\'][\\s\\S]*?</tr>');
    const rowMatch = tableHtml.match(rowRe);
    assert.ok(rowMatch, 'row missing in translations table for: ' + code);
    const row = rowMatch[0];
    // The translation cell carries class="translation".
    const cell = row.match(
      /<td[^>]*class="translation"[^>]*>([\s\S]*?)<\/td>/);
    assert.ok(cell, 'translation cell missing in row: ' + code);
    const text = cell[1].replace(/<[^>]+>/g, '').trim();
    assert.ok(text.length > 0,
      'translation cell is empty for language: ' + code);
    assert.ok(!/^TODO|^FIXME|^—$|^-$/i.test(text),
      'translation cell looks like a placeholder for: ' + code +
      ' (got "' + text + '")');
  }
});

/* 6. Live index.html header still uses the production CTA. */
check('live index.html masthead CTA unchanged ("Update or verify a listing")', () => {
  const idx = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const m = idx.match(/<a\b[^>]*data-mast-cta-listing[^>]*>([^<]+)<\/a>/);
  assert.ok(m, 'production CTA <a data-mast-cta-listing> not found in index.html');
  assert.match(m[1], /Update or verify a listing/,
    'production CTA label changed unexpectedly: "' + m[1].trim() + '"');
  const href = (m[0].match(/\bhref="([^"]+)"/) || [,''])[1];
  assert.match(href, /\bmode=change_request\b/,
    'production CTA href no longer carries mode=change_request: ' + href);
});

/* 6b. Belt-and-braces — none of the round-4 preview-only tokens leaked
       into index.html as part of this round-5 translations work. */
check('no preview-only Variant A markup leaked into index.html', () => {
  const idx = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const forbidden = [
    'v-a-rail', 'v-a-meta', 'v-a-line', 'v-a-mobile-stage',
    'v-a-unified', 'data-variant-a-mobile', 'data-mobile-preview',
    'data-translations-table', 'data-translations',
  ];
  for (const tok of forbidden){
    assert.ok(!idx.includes(tok),
      'preview-only token leaked into live index.html: ' + tok);
  }
});

/* 7. Preview still noindex/nofollow. */
check('preview still declares noindex,nofollow', () => {
  const m = previewHtml.match(
    /<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i);
  assert.ok(m, 'no <meta name="robots"> tag');
  assert.match(m[1], /noindex/i, 'robots meta missing noindex: ' + m[1]);
  assert.match(m[1], /nofollow/i, 'robots meta missing nofollow: ' + m[1]);
  assert.match(previewHtml,
    /<meta\s+http-equiv=["']X-Robots-Tag["']\s+content=["'][^"']*noindex/i,
    'X-Robots-Tag noindex meta missing');
});

/* 8. Preview still absent from sitemap.xml. */
check('sitemap.xml does not reference header-cta-preview', () => {
  const sm = fs.readFileSync(path.join(repoRoot, 'sitemap.xml'), 'utf8');
  assert.ok(!/header-cta-preview/.test(sm),
    'sitemap.xml unexpectedly references the preview file');
});

/* 9. No production file links to the preview. */
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
  function walk(dir, visit){
    for (const entry of fs.readdirSync(dir)){
      const full = path.join(dir, entry);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full, visit);
      else visit(full);
    }
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
  // Test files are allowed to mention the preview by name.
  const filtered = offenders.filter(p => !/header_cta_preview[^/]*\.test\.mjs$/.test(p));
  assert.deepEqual(filtered, [],
    'preview is referenced from public files: ' + filtered.join(', '));
});

/* 10. Translations note flags that finale lokale review is still needed. */
check('translations note flags that final local review is still required', () => {
  // The note explicitly mentions native speaker review (idealiter / native speaker).
  assert.ok(
    /native\s+speaker/i.test(previewHtml) || /lokale\s+(review|check|nuance)/i.test(previewHtml),
    'translations section does not flag the need for final local review');
});

if (failures > 0) {
  console.log('\n' + failures + ' check(s) failed.');
  process.exit(1);
} else {
  console.log('\nAll header_cta_preview_translations checks passed.');
}
