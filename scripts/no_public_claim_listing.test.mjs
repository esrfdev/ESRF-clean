// Test: no public-facing "Claim your listing" wording remains in the site.
//
// Background — 2026-04-27 governance update:
//   The phrase "Claim your listing" was retired across the public site.
//   It implied unilateral ownership transfer, but ESRF.net listings are
//   editorially curated — visitors cannot "claim" an entry; they can ask
//   editors to update or verify one. The new wording is:
//     • English:  "Update or verify a listing"
//     • Dutch:    "Vermelding wijzigen of verifiëren"
//   All public CTAs now link to the combined intake form with the
//   change_request mode preselected:
//     /submit-news?mode=change_request   (lang appended at runtime)
//
// This test guards five things:
//   1. No public-facing HTML contains "Claim your listing" / "Claim je
//      vermelding" / "Claim a listing".
//   2. The new EN and NL labels exist somewhere in the public HTML or
//      i18n catalogues.
//   3. Every CTA marked with [data-mast-cta-listing] points at a URL
//      whose query string contains mode=change_request.
//   4. submit-news.html contains JS that reads the `mode` URL param and
//      preselects the matching radio for BOTH the NL and EN forms.
//   5. The change_request mode option carries an explicit safety
//      explanation (editors verify; nothing is changed automatically) in
//      both the NL and EN forms.
//
// Run with: node scripts/no_public_claim_listing.test.mjs

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

// Files we consider "public-facing": top-level HTML, JS, the editorials
// HTML pages, the country index, and the i18n catalogues. We deliberately
// EXCLUDE editorial drafts (markdown), redactie-only test fixtures, and
// scripts under scripts/* that are tooling — those are not user-visible.
function listPublicFiles(){
  const files = [];
  for (const f of fs.readdirSync(repoRoot)){
    const full = path.join(repoRoot, f);
    if (!fs.statSync(full).isFile()) continue;
    if (/\.(html|js|json)$/.test(f)) files.push(full);
  }
  // i18n catalogues
  const i18nDir = path.join(repoRoot, 'i18n');
  for (const f of fs.readdirSync(i18nDir)){
    if (f.endsWith('.json') || f.endsWith('.js')) files.push(path.join(i18nDir, f));
  }
  // Countries (public landing + per-country pages)
  const countriesDir = path.join(repoRoot, 'countries');
  if (fs.existsSync(countriesDir)){
    for (const entry of fs.readdirSync(countriesDir)){
      const full = path.join(countriesDir, entry);
      if (fs.statSync(full).isFile() && full.endsWith('.html')){
        files.push(full);
      } else if (fs.statSync(full).isDirectory()){
        const idx = path.join(full, 'index.html');
        if (fs.existsSync(idx)) files.push(idx);
      }
    }
  }
  // Asset JS
  const assetsDir = path.join(repoRoot, 'assets');
  if (fs.existsSync(assetsDir)){
    for (const f of fs.readdirSync(assetsDir)){
      if (f.endsWith('.js')) files.push(path.join(assetsDir, f));
    }
  }
  return files;
}

const PUBLIC_FILES = listPublicFiles();

/* 1. No legacy claim wording anywhere public. */
check('no public file contains "Claim your listing"', () => {
  const offenders = [];
  for (const f of PUBLIC_FILES){
    const txt = fs.readFileSync(f, 'utf8');
    if (/Claim your listing/i.test(txt)) offenders.push(path.relative(repoRoot, f));
  }
  assert.deepEqual(offenders, [], 'still present in: ' + offenders.join(', '));
});

check('no public file contains "Claim je vermelding"', () => {
  const offenders = [];
  for (const f of PUBLIC_FILES){
    const txt = fs.readFileSync(f, 'utf8');
    if (/Claim je vermelding/i.test(txt)) offenders.push(path.relative(repoRoot, f));
  }
  assert.deepEqual(offenders, [], 'still present in: ' + offenders.join(', '));
});

check('no public file contains "Claim a listing"', () => {
  const offenders = [];
  for (const f of PUBLIC_FILES){
    const txt = fs.readFileSync(f, 'utf8');
    if (/Claim a listing/i.test(txt)) offenders.push(path.relative(repoRoot, f));
  }
  assert.deepEqual(offenders, [], 'still present in: ' + offenders.join(', '));
});

/* 2. New labels exist somewhere visible. */
check('new English label "Update or verify a listing" exists', () => {
  let found = false;
  for (const f of PUBLIC_FILES){
    const txt = fs.readFileSync(f, 'utf8');
    if (/Update or verify a listing/.test(txt)) { found = true; break; }
  }
  assert.ok(found, 'new EN label not found anywhere public');
});

check('new Dutch label "Vermelding wijzigen of verifiëren" exists', () => {
  let found = false;
  for (const f of PUBLIC_FILES){
    const txt = fs.readFileSync(f, 'utf8');
    if (/Vermelding wijzigen of verifiëren/.test(txt)) { found = true; break; }
  }
  assert.ok(found, 'new NL label not found anywhere public');
});

check('i18n/en.json nav.request_listing == "Update or verify a listing"', () => {
  const en = JSON.parse(fs.readFileSync(path.join(repoRoot, 'i18n/en.json'), 'utf8'));
  assert.equal(en.nav.request_listing, 'Update or verify a listing');
});

check('i18n/nl.json nav.request_listing == "Vermelding wijzigen of verifiëren"', () => {
  const nl = JSON.parse(fs.readFileSync(path.join(repoRoot, 'i18n/nl.json'), 'utf8'));
  assert.equal(nl.nav.request_listing, 'Vermelding wijzigen of verifiëren');
});

/* 3. Every CTA flagged data-mast-cta-listing links to mode=change_request. */
check('every [data-mast-cta-listing] href contains mode=change_request', () => {
  const TAG = /<(?:a|button)\b[^>]*data-mast-cta-listing[^>]*>/g;
  const offenders = [];
  for (const f of PUBLIC_FILES){
    if (!f.endsWith('.html')) continue;
    const txt = fs.readFileSync(f, 'utf8');
    const matches = txt.match(TAG) || [];
    for (const tag of matches){
      const href = (tag.match(/\bhref="([^"]+)"/) || [,''])[1];
      if (!/\bmode=change_request\b/.test(href)){
        offenders.push(path.relative(repoRoot, f) + ' :: ' + tag);
      }
    }
  }
  assert.deepEqual(offenders, [], 'CTAs missing mode=change_request:\n  ' + offenders.join('\n  '));
});

check('there is at least one [data-mast-cta-listing] CTA on the site', () => {
  let count = 0;
  for (const f of PUBLIC_FILES){
    if (!f.endsWith('.html')) continue;
    const txt = fs.readFileSync(f, 'utf8');
    count += (txt.match(/data-mast-cta-listing/g) || []).length;
  }
  assert.ok(count >= 5, 'expected the new CTA to appear on multiple public pages, got ' + count);
});

/* 4. submit-news.html preselects mode from URL for both forms. */
const submitHtml = fs.readFileSync(path.join(repoRoot, 'submit-news.html'), 'utf8');

check('submit-news.html reads ?mode= from URLSearchParams', () => {
  const matches = submitHtml.match(/new URLSearchParams\(window\.location\.search\)\.get\('mode'\)/g) || [];
  assert.ok(matches.length >= 2,
    'expected at least 2 occurrences (NL + EN forms), found ' + matches.length);
});

check('submit-news.html selects the matching intake_mode radio', () => {
  // The preselect helper resolves the requested mode against the radios
  // and sets `r.checked = (r === target)` to enforce single-select.
  const matches = submitHtml.match(/r\.checked\s*=\s*\(r\s*===\s*target\)/g) || [];
  assert.ok(matches.length >= 2,
    'expected the preselect logic to appear in BOTH form scripts, found ' + matches.length);
});

check('submit-news.html lists change_request as a valid preselect target', () => {
  // The whitelist guards against arbitrary URL values flipping the form.
  // Both forms must include 'change_request' in their VALID list.
  const matches = submitHtml.match(/['"]change_request['"]/g) || [];
  // Six radio-value occurrences (3 per form: option markup, JS submit-label
  // branch, JS validate branch, plus the two whitelist arrays). We only
  // assert the whitelist arrays are present.
  const whitelistCount = (submitHtml.match(/VALID\s*=\s*\[[^\]]*'change_request'/g) || []).length;
  assert.ok(whitelistCount >= 2,
    'expected change_request in the VALID list of BOTH preselect helpers, found ' + whitelistCount);
});

/* 5. Safety explanation present in both forms' change_request option. */
check('NL change_request option carries an editorial-review safety note', () => {
  // Match the NL change_request radio label and require text indicating
  // editors verify and nothing is changed automatically.
  const m = submitHtml.match(
    /<label[^>]*data-mode="change_request"[^>]*id="mode-change"[\s\S]*?<\/label>/);
  assert.ok(m, 'NL change_request label not found');
  assert.match(m[0], /redactie/i, 'NL safety copy missing reference to "redactie"');
  assert.match(m[0], /niets automatisch/i,
    'NL safety copy must say "niets automatisch" (nothing automatic)');
});

check('EN change_request option carries an editorial-review safety note', () => {
  const m = submitHtml.match(
    /<label class="mode-option" data-mode="change_request">[\s\S]*?<\/label>/);
  assert.ok(m, 'EN change_request label not found');
  assert.match(m[0], /editors verify/i,
    'EN safety copy must mention "editors verify"');
  assert.match(m[0], /never change anything automatically/i,
    'EN safety copy must say "never change anything automatically"');
});

if (failures > 0) {
  console.log('\n' + failures + ' check(s) failed.');
  process.exit(1);
} else {
  console.log('\nAll no_public_claim_listing checks passed.');
}
