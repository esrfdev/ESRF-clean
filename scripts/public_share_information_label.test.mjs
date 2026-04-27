// Lightweight Node test for the public 'Share your information' / 'Deel je informatie'
// label preparation on branch test/regional-editorial-contributor-intake.
//
// Verifies:
//   - i18n/en.json and i18n/nl.json parse and contain the new keys with the agreed
//     visitor-facing wording.
//   - Public production HTML pages link to submit-news.html with the broad label
//     and use data-i18n="common.share_information".
//   - No public production page links to a validation/test page (submit-validation,
//     request-listing-validation, esrf-simulated-site, contribute-editorial-test).
//   - Validation pages may still link to submit-validation.html (allowed inside lab).
//   - validation-lab.json contains a module entry id 'public-share-information-label'
//     describing this PR-ready preparation.
//
// Run with: node scripts/public_share_information_label.test.mjs

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

// ── i18n JSON parses + contains new keys ──────────────────────────────────
const en = JSON.parse(fs.readFileSync(path.join(repoRoot, 'i18n/en.json'), 'utf8'));
const nl = JSON.parse(fs.readFileSync(path.join(repoRoot, 'i18n/nl.json'), 'utf8'));

check('en.json: common.share_information = "Share your information"', () => {
  assert.equal(en.common.share_information, 'Share your information');
});
check('en.json: common.share_information_cta ends with "→"', () => {
  assert.match(en.common.share_information_cta, /Share your information\s*→/);
});
check('en.json: common.share_information_help mentions submit/update/practice story', () => {
  const s = en.common.share_information_help;
  assert.ok(/submit an organisation/i.test(s), 'helper text should mention submitting an organisation');
  assert.ok(/update or removal/i.test(s), 'helper text should mention update or removal');
  assert.ok(/practice story/i.test(s), 'helper text should mention practice story');
});
check('nl.json: common.share_information = "Deel je informatie"', () => {
  assert.equal(nl.common.share_information, 'Deel je informatie');
});
check('nl.json: common.share_information_cta ends with "→"', () => {
  assert.match(nl.common.share_information_cta, /Deel je informatie\s*→/);
});
check('nl.json: common.share_information_help bevat brede uitleg', () => {
  const s = nl.common.share_information_help;
  assert.ok(/organisatie aan te melden/i.test(s), 'helper-tekst moet "organisatie aanmelden" bevatten');
  assert.ok(/wijzigen/i.test(s), 'helper-tekst moet "wijzigen" bevatten');
  assert.ok(/verbergen/i.test(s), 'helper-tekst moet "verbergen" bevatten');
  assert.ok(/praktijkverhaal/i.test(s), 'helper-tekst moet "praktijkverhaal" bevatten');
});

// ── Public production HTML pages: footer link uses broad label + data-i18n ──
const PUBLIC_PAGES = [
  'about.html', 'analytics.html', 'directory.html',
  'editorial-emergency-capaciteit-europa-2026.html',
  'editorial-oil-shortage-2026.html',
  'editorial-rotterdam-weerbaarheid-2026.html',
  'editorials.html', 'events.html', 'fund.html', 'index.html',
  'news.html', 'privacy.html', 'request-listing.html',
  'responsible-disclosure.html', 'sponsor.html',
  'submit-event.html', 'submit-news.html', 'terms.html'
];

for (const page of PUBLIC_PAGES) {
  check(`${page}: footer link uses broad label "Share your information" with data-i18n=common.share_information`, () => {
    const html = fs.readFileSync(path.join(repoRoot, page), 'utf8');
    assert.match(
      html,
      /<li><a href="submit-news\.html" data-i18n="common\.share_information">Share your information<\/a><\/li>/,
      'expected canonical broad-route footer link'
    );
    // No leftover narrow "Submit signal" anchor in the footer pointing at submit-news.html
    assert.doesNotMatch(
      html,
      /<li><a href="submit-news\.html">Submit signal<\/a><\/li>/,
      'narrow "Submit signal" footer wording should be replaced'
    );
  });
}

// ── No public page links to a validation / test page ─────────────────────
const FORBIDDEN_VALIDATION_TARGETS = [
  'submit-validation.html',
  'request-listing-validation.html',
  'esrf-simulated-site.html',
  'contribute-editorial-test.html'
];

for (const page of PUBLIC_PAGES) {
  check(`${page}: does NOT link to any validation/test page`, () => {
    const html = fs.readFileSync(path.join(repoRoot, page), 'utf8');
    for (const target of FORBIDDEN_VALIDATION_TARGETS) {
      const re = new RegExp(`href=["']${target.replace(/[.]/g, '\\.')}["']`);
      assert.ok(!re.test(html), `production page ${page} must not link to ${target}`);
    }
  });
}

// ── Validation pages may still route to submit-validation.html ────────────
check('esrf-simulated-site.html may link to submit-validation.html (lab-only)', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'esrf-simulated-site.html'), 'utf8');
  // It is allowed; we just assert the file exists and its presence is normal.
  assert.ok(html.length > 0);
});

// ── validation-lab.json: module id 'public-share-information-label' present ──
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'validation-lab.json'), 'utf8'));
check("validation-lab.json: module id 'public-share-information-label' present", () => {
  const mod = manifest.modules.find(m => m.id === 'public-share-information-label');
  assert.ok(mod, "module 'public-share-information-label' must be registered");
  assert.equal(mod.primaryCallToAction, '/submit-news.html', 'route stays canonical to production form');
  assert.equal(mod.primaryCallToActionLabel.en, 'Share your information');
  assert.equal(mod.primaryCallToActionLabel.nl, 'Deel je informatie');
  assert.ok(Array.isArray(mod.i18nKeys) && mod.i18nKeys.includes('common.share_information'),
    'manifest must list common.share_information in i18nKeys');
});

// ── No automatic publication / Directory_Master safety copy still in scope ──
check("validation-lab.json: still bans automatic publication", () => {
  const text = fs.readFileSync(path.join(repoRoot, 'validation-lab.json'), 'utf8');
  assert.ok(/Directory_Master/.test(text), "Directory_Master mention must remain");
  assert.ok(/redactie/i.test(text), "redactie review mention must remain");
});

if (failures > 0) {
  console.log('\n' + failures + ' check(s) failed.');
  process.exit(1);
} else {
  console.log('\nAll public_share_information_label checks passed.');
}
