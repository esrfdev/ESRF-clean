// Self-contained test for functions/api/intake.js
//
// Run with:   node functions/api/intake.test.mjs
//
// Exits 0 on success, 1 on any failure. No external dependencies.
// Tests the validation, sanitisation, issue-preview, and origin logic of
// the /api/intake handler in isolation.

import assert from 'node:assert/strict';

await import('./intake.js');
const api = globalThis.__esrfIntake;
assert.ok(api, 'intake.js did not expose test hooks on globalThis');

const { validateAndSanitize, buildIssuePreview, buildSheetRow, sanitize, sanitizeLong, sanitizeUrl, isAllowedOrigin, mdEscapeInline } = api;

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok  — ' + name); }
  catch (e) { failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}

// ─── sanitize / sanitizeUrl / sanitizeLong ───────────────────────────────
check('sanitize strips HTML and dangerous chars', () => {
  assert.equal(sanitize('<script>alert(1)</script>hello'), 'alert(1)hello');
  assert.equal(sanitize('  Acme  '), 'Acme');
  assert.equal(sanitize(null), '');
  // `<c>` is a complete HTML-tag-shape and is stripped wholesale before quote stripping.
  assert.equal(sanitize('a"b<c>d'), 'abd');
  assert.equal(sanitize('a"b<c d'), 'abc d'); // unbalanced — only quotes/lt removed
});
check('sanitizeLong keeps newlines but caps length', () => {
  const v = sanitizeLong('line1\nline2\n<b>x</b>');
  assert.equal(v, 'line1\nline2\nx');
  assert.ok(sanitizeLong('a'.repeat(5000)).length <= 2000);
});
check('sanitizeUrl rejects non-http(s)', () => {
  assert.equal(sanitizeUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeUrl('https://example.org/x'), 'https://example.org/x');
  assert.equal(sanitizeUrl('http://example.org'), 'http://example.org');
  assert.equal(sanitizeUrl(''), '');
});

// ─── origin allowlist ────────────────────────────────────────────────────
check('isAllowedOrigin allows production + branch preview suffix', () => {
  assert.equal(isAllowedOrigin('https://www.esrf.net'), true);
  assert.equal(isAllowedOrigin('https://test-regional-editorial-cont.esrf-clean.pages.dev'), true);
  assert.equal(isAllowedOrigin('https://random.esrf-clean.pages.dev'), true);
  assert.equal(isAllowedOrigin('http://www.esrf.net'), false);   // require https for previews
  assert.equal(isAllowedOrigin('https://evil.example'), false);
  assert.equal(isAllowedOrigin(''), false);
  assert.equal(isAllowedOrigin('not a url'), false);
});

// ─── markdown escaping ───────────────────────────────────────────────────
check('mdEscapeInline neutralises markdown specials and HTML brackets', () => {
  assert.equal(mdEscapeInline('a*b_c[d]'), 'a\\*b\\_c\\[d\\]');
  assert.equal(mdEscapeInline('<x>'), '\\<x\\>');
});

// ─── validation: required fields per mode ────────────────────────────────
const goodContact = {
  name: 'Anna Jansen',
  organisation: 'Acme Veiligheid',
  role: 'Coordinator',
  email: 'anna@example.org',
  phone: '+31 6 12345678',
  country_code: 'NL',
  country_label: 'Nederland',
  place: 'Rotterdam',
  region: 'Zuid-Holland',
  website: 'https://acme.example.org',
};
const goodOrg = { sector: 'gov', sector_label: 'Overheid', city: 'Rotterdam', description: 'Doet veiligheid.' };
const goodEd = {
  topic: 'Lessons in regional cooperation',
  summary: 'A short summary of the contribution.',
  audience: 'Civic leaders',
  partners_sector: 'Police, municipality',
  regional_angle: 'Why Zuid-Holland responded faster.',
  lesson: 'Joint dispatch beats parallel dispatch.',
  spotlight: 'Team X',
  sources: 'Internal report 2025-12.',
  consent: { edit_and_publish: true, editorial_may_contact: true, no_confidential_information: true },
};
const goodPrivacy = { gdpr_privacy_policy: true };

check('org mode requires website + sector', () => {
  const r = validateAndSanitize({
    intake_mode: 'org',
    contact: { ...goodContact, website: '' },
    organisation_listing: goodOrg,
    privacy: goodPrivacy,
  });
  assert.ok(r.error && /website/i.test(r.error));
});

check('org mode passes with valid input', () => {
  const r = validateAndSanitize({
    intake_mode: 'org',
    contact: goodContact,
    organisation_listing: goodOrg,
    privacy: goodPrivacy,
  });
  assert.ok(!r.error, r.error);
  assert.equal(r.payload.intake_mode, 'org');
  assert.equal(r.payload.contact.country_code, 'NL');
  assert.ok(r.payload.organisation_listing);
  assert.ok(!r.payload.editorial_contribution);
});

check('editorial mode requires editorial fields and consents', () => {
  const r = validateAndSanitize({
    intake_mode: 'editorial',
    contact: goodContact,
    editorial_contribution: { ...goodEd, summary: '' },
    privacy: goodPrivacy,
  });
  assert.ok(r.error && /summary/i.test(r.error));
});

check('editorial mode rejects missing consent', () => {
  const r = validateAndSanitize({
    intake_mode: 'editorial',
    contact: goodContact,
    editorial_contribution: { ...goodEd, consent: { edit_and_publish: true, editorial_may_contact: false, no_confidential_information: true } },
    privacy: goodPrivacy,
  });
  assert.ok(r.error && /editorial_may_contact/i.test(r.error));
});

check('both mode requires org + editorial fields', () => {
  const r = validateAndSanitize({
    intake_mode: 'both',
    contact: goodContact,
    organisation_listing: goodOrg,
    editorial_contribution: goodEd,
    privacy: goodPrivacy,
  });
  assert.ok(!r.error, r.error);
  assert.ok(r.payload.organisation_listing);
  assert.ok(r.payload.editorial_contribution);
});

check('rejects bad email and bad country code', () => {
  let r = validateAndSanitize({ intake_mode: 'org', contact: { ...goodContact, email: 'nope' }, organisation_listing: goodOrg, privacy: goodPrivacy });
  assert.ok(r.error && /email/i.test(r.error));
  r = validateAndSanitize({ intake_mode: 'org', contact: { ...goodContact, country_code: 'NLD' }, organisation_listing: goodOrg, privacy: goodPrivacy });
  assert.ok(r.error && /country_code/i.test(r.error));
});

check('rejects unknown intake_mode', () => {
  const r = validateAndSanitize({ intake_mode: 'xyz', contact: goodContact, privacy: goodPrivacy });
  assert.ok(r.error && /intake_mode/i.test(r.error));
});

check('requires gdpr privacy consent', () => {
  const r = validateAndSanitize({ intake_mode: 'org', contact: goodContact, organisation_listing: goodOrg, privacy: { gdpr_privacy_policy: false } });
  assert.ok(r.error && /gdpr/i.test(r.error));
});

// ─── issue preview ───────────────────────────────────────────────────────
check('buildIssuePreview produces title + body + labels and escapes markdown', () => {
  const payload = validateAndSanitize({
    intake_mode: 'both',
    contact: { ...goodContact, organisation: 'Acme*Foo_Bar' },
    organisation_listing: goodOrg,
    editorial_contribution: goodEd,
    privacy: goodPrivacy,
  }).payload;
  const p = buildIssuePreview(payload);
  assert.ok(p.title.startsWith('\\[ESRF intake\\]'));
  assert.ok(p.title.includes('Acme\\*Foo\\_Bar'));
  assert.ok(p.labels.includes('intake'));
  assert.ok(p.labels.includes('mode:both'));
  assert.ok(p.labels.includes('editorial'));
  assert.ok(p.labels.includes('organisation'));
  assert.ok(p.body.includes('Lessons in regional cooperation'));
  assert.ok(!p.body.includes('<script>'));
});

// ─── sheet row (single source of truth) ─────────────────────────────────
check('buildSheetRow produces a stable, flat, minimal row with refs', () => {
  const payload = validateAndSanitize({
    intake_mode: 'both',
    contact: goodContact,
    organisation_listing: goodOrg,
    editorial_contribution: goodEd,
    privacy: goodPrivacy,
  }).payload;
  const row = buildSheetRow(payload, { issue_url: 'https://github.com/x/y/issues/12', issue_number: 12 });
  assert.equal(row.schema_version, 1);
  assert.equal(row.intake_mode, 'both');
  assert.equal(row.organisation, 'Acme Veiligheid');
  assert.equal(row.country_code, 'NL');
  assert.equal(row.contact_email, 'anna@example.org');
  assert.equal(row.has_listing, 'yes');
  assert.equal(row.has_editorial, 'yes');
  assert.equal(row.editorial_topic, 'Lessons in regional cooperation');
  assert.equal(row.issue_url, 'https://github.com/x/y/issues/12');
  assert.equal(row.issue_number, 12);
  assert.equal(row.status, 'new');
  // Sheet row is the SSoT register; it must NOT inline editorial body.
  assert.ok(!('editorial_summary' in row));
  assert.ok(!JSON.stringify(row).includes('Joint dispatch beats parallel dispatch'));
});

check('buildSheetRow with no refs leaves issue pointers empty', () => {
  const payload = validateAndSanitize({
    intake_mode: 'org',
    contact: goodContact,
    organisation_listing: goodOrg,
    privacy: goodPrivacy,
  }).payload;
  const row = buildSheetRow(payload, {});
  assert.equal(row.issue_url, '');
  assert.equal(row.issue_number, '');
  assert.equal(row.has_editorial, '');
});

// ─── summary ─────────────────────────────────────────────────────────────
if (failures) {
  console.log('\n' + failures + ' test(s) FAILED');
  process.exit(1);
}
console.log('\nall tests passed');
