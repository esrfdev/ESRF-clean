// Test: submit-news.html now hosts the new composed visitor form
// (validated submit-validation flow brought into production-safe shape).
//
// Verifies on the production page submit-news.html:
//   - All five mode labels are present
//   - Step-1 instruction text "Kies eerst wat je wilt doen…" is present
//   - "NIEUW" badge does NOT appear on mode buttons
//   - Editorial review notice is present (NL + EN spirit)
//   - Bevoegdheid (authorization) section present with required fields,
//     and never uses the word "password" / "wachtwoord" for the registratiecode
//   - Existing-listing prefill / lookup UI is present for change/hide modes
//   - No links to validation/lab/redactie internal pages
//   - i18n JSON parses
//
// Run with: node scripts/submit_news_composed_form.test.mjs

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

// ── Mode labels (5 modes) ─────────────────────────────────────────────
const MODE_LABELS = [
  'Organisatie aanmelden',
  'Praktijkverhaal delen',
  'Beide',
  'Gegevens wijzigen',
  'Verbergen / verwijderen',
];
for (const label of MODE_LABELS) {
  check(`submit-news.html contains mode label "${label}"`, () => {
    assert.ok(html.includes(label), `expected mode label "${label}" in submit-news.html`);
  });
}

// ── Mode radio values ─────────────────────────────────────────────────
for (const v of ['org', 'editorial', 'both', 'change_request', 'hide_delete']) {
  check(`submit-news.html has intake_mode radio value="${v}"`, () => {
    const re = new RegExp(`name="intake_mode"\\s+value="${v}"`);
    assert.match(html, re);
  });
}

// ── Step-1 instruction "kies eerst, dan stap 2" ───────────────────────
check('submit-news.html contains step-1 instruction (kies eerst — stap 2)', () => {
  assert.match(html, /Kies eerst wat je wilt doen/i);
  assert.match(html, /stap\s*2/i);
});

// ── No NIEUW badge on mode buttons ────────────────────────────────────
check('submit-news.html has no NIEUW badge inside mode-switch / mode-option', () => {
  // Heuristic: look for "NIEUW" near any mode-option label
  const re = /<label[^>]*class="[^"]*mode-option[^"]*"[\s\S]*?<\/label>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const block = m[0];
    assert.ok(!/\bNIEUW\b/.test(block), 'mode-option must not contain NIEUW badge');
  }
});

// ── Review notice present ─────────────────────────────────────────────
check('submit-news.html contains editorial review notice (redactie kijkt mee)', () => {
  assert.match(html, /kijkt\s+(de\s+)?ESRF-redactie\s+mee|redactie\s+kijkt\s+mee/i);
  assert.match(html, /niets\s+(wordt\s+)?automatisch\s+gepubliceerd/i);
});

// ── Bevoegdheid section ───────────────────────────────────────────────
check('submit-news.html has Bevoegdheid section with required fields', () => {
  assert.match(html, /Bevoegdheid om wijziging aan te vragen/);
  assert.match(html, /name="auth_requester_name"/);
  assert.match(html, /name="auth_requester_role"/);
  assert.match(html, /name="auth_work_email"/);
  assert.match(html, /name="auth_relation"/);
  assert.match(html, /name="auth_confirm_authorized"/);
  assert.match(html, /name="auth_registration_code"/);
});

check('submit-news.html never calls the registratiecode "password"', () => {
  // Allow "wachtwoord" only if explicitly negated; we want neither label nor input named password
  const codeBlock = html.match(/auth_registration_code[\s\S]{0,800}/);
  assert.ok(codeBlock, 'registratiecode block missing');
  assert.ok(!/password|wachtwoord/i.test(codeBlock[0]), 'registratiecode must not be called password/wachtwoord');
  // type must not be password
  assert.ok(!/id="sv-auth-registration-code"[^>]*type="password"/i.test(html), 'registratiecode input must not be type=password');
});

// ── Existing-listing prefill / lookup ─────────────────────────────────
check('submit-news.html has existing-listing lookup + prefill panel', () => {
  assert.match(html, /id="sv-cr-lookup"/);
  assert.match(html, /id="sv-cr-existing-panel"/);
  assert.match(html, /Bestaande publieke gegevens/);
  assert.match(html, /companies_extracted\.json/);
});

// ── Change-request fields ─────────────────────────────────────────────
check('submit-news.html has change-request fields (target_name/url, action, description, reason)', () => {
  assert.match(html, /name="cr_target_name"/);
  assert.match(html, /name="cr_target_url"/);
  assert.match(html, /name="cr_action"/);
  assert.match(html, /name="cr_description"/);
  assert.match(html, /name="cr_reason"/);
});

// ── No links to validation/lab/redactie internal pages ────────────────
const FORBIDDEN = [
  'submit-validation.html',
  'request-listing-validation.html',
  'esrf-simulated-site.html',
  'contribute-editorial-test.html',
  'redactie-validation.html',
  'redactie-review.html',
  'validation-lab.html',
];
for (const target of FORBIDDEN) {
  check(`submit-news.html does NOT reference internal page ${target}`, () => {
    const re = new RegExp(`href=["']${target.replace(/[.]/g, '\\.')}["']`);
    assert.ok(!re.test(html), `submit-news.html must not link to ${target}`);
    // Also guard against bare anchor text references
    const refRe = new RegExp(target.replace(/[.]/g, '\\.'), 'i');
    assert.ok(!refRe.test(html), `submit-news.html must not mention ${target}`);
  });
}

// ── Production-safe submit path: mailto intake@esrf.net ───────────────
check('submit-news.html submits via mailto:intake@esrf.net (production-safe)', () => {
  assert.match(html, /mailto:intake@esrf\.net/);
});

check('submit-news.html does NOT call /api/intake-test (LAB-only endpoint)', () => {
  assert.ok(!/\/api\/intake-test/.test(html), '/api/intake-test belongs in lab, not production');
});

// ── Hero copy: NL primary share-information label ─────────────────────
check('submit-news.html hero uses common.share_information data-i18n', () => {
  assert.match(html, /data-i18n="common\.share_information"/);
  assert.match(html, /Deel je informatie/);
});

// ── i18n JSON parses ─────────────────────────────────────────────────
check('i18n/nl.json parses', () => { JSON.parse(fs.readFileSync(path.join(repoRoot, 'i18n/nl.json'), 'utf8')); });
check('i18n/en.json parses', () => { JSON.parse(fs.readFileSync(path.join(repoRoot, 'i18n/en.json'), 'utf8')); });

if (failures > 0) {
  console.log('\n' + failures + ' check(s) failed.');
  process.exit(1);
} else {
  console.log('\nAll submit_news_composed_form checks passed.');
}
