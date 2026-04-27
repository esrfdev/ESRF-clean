// Self-contained test for functions/api/intake.js (production handler).
//
// Run with: node functions/api/intake.test.mjs
// Exits 0 on success, 1 on any failed assertion. No external deps.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

await import('./intake.js');
const api = globalThis.__esrfIntake;
assert.ok(api, 'intake.js did not expose test hooks on globalThis');

let failures = 0;
function check(name, fn){
  try { fn(); console.log('  ok  — ' + name); }
  catch(e){ failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}
async function checkAsync(name, fn){
  try { await fn(); console.log('  ok  — ' + name); }
  catch(e){ failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}

// ── Constants and module surface ─────────────────────────────────────────
check('VALID_MODES contains all 6 modes', () => {
  for (const m of ['org','editorial','both','change_request','hide_delete','event']) {
    assert.ok(api.VALID_MODES.has(m), 'missing mode ' + m);
  }
});
check('SHEET_TARGETS forbidden_targets includes Directory_Master', () => {
  assert.ok(api.SHEET_TARGETS.forbidden_targets.includes('Directory_Master'));
});
check('SHEET_TARGETS tabs do not contain a LAB_ prefix', () => {
  for (const v of Object.values(api.SHEET_TARGETS.tabs)) {
    assert.ok(!String(v).startsWith('LAB_'), 'tab name still LAB_-prefixed: ' + v);
  }
});

// ── isAllowedOrigin ──────────────────────────────────────────────────────
check('isAllowedOrigin accepts esrf.net, www.esrf.net, *.esrf-clean.pages.dev', () => {
  assert.ok(api.isAllowedOrigin('https://esrf.net'));
  assert.ok(api.isAllowedOrigin('https://www.esrf.net'));
  assert.ok(api.isAllowedOrigin('https://anything.esrf-clean.pages.dev'));
});
check('isAllowedOrigin rejects http and unknown hosts', () => {
  assert.ok(!api.isAllowedOrigin('http://esrf.net'));
  assert.ok(!api.isAllowedOrigin('https://evil.example.com'));
  assert.ok(!api.isAllowedOrigin(''));
});

// ── Helper: minimal valid contact ────────────────────────────────────────
function baseContact(over = {}) {
  return Object.assign({
    name: 'Anna de Vries',
    organisation: 'Stichting Veiligheid',
    role: 'Coordinator',
    email: 'anna@example.org',
    country_code: 'NL',
    country_label: 'Nederland',
    place: 'Utrecht',
    region: 'Utrecht',
    website: 'https://example.org',
  }, over);
}
function basePrivacy() { return { gdpr_privacy_policy: true }; }

// ── validateAndSanitize: each of the 6 modes ─────────────────────────────
check('validate rejects unknown mode', () => {
  const r = api.validateAndSanitize({ intake_mode: 'nope', contact: baseContact(), privacy: basePrivacy() });
  assert.ok(r.error);
});

check('validate accepts org mode with website + sector', () => {
  const r = api.validateAndSanitize({
    intake_mode: 'org',
    contact: baseContact(),
    sector: 'kritieke-infrastructuur',
    organisation_listing: { description: 'Doet aan veiligheid.' },
    privacy: basePrivacy(),
  });
  assert.ok(!r.error, r.error);
  assert.equal(r.payload.intake_mode, 'org');
  assert.ok(r.payload.organisation_listing);
});

check('validate rejects org mode missing website', () => {
  const r = api.validateAndSanitize({
    intake_mode: 'org',
    contact: baseContact({ website: '' }),
    sector: 'kritieke-infrastructuur',
    privacy: basePrivacy(),
  });
  assert.ok(r.error);
});

check('validate accepts editorial mode with required consents + summary', () => {
  const r = api.validateAndSanitize({
    intake_mode: 'editorial',
    contact: baseContact(),
    sector: 'overheid',
    editorial_contribution: {
      topic: 'Lessen uit Q1',
      summary: 'Een korte samenvatting van minstens twintig tekens lang.',
      regional_angle: 'Noord-Holland casus',
      lesson: 'Wat we hebben geleerd',
      consent: { edit_and_publish: true, editorial_may_contact: true, no_confidential_information: true },
    },
    privacy: basePrivacy(),
  });
  assert.ok(!r.error, r.error);
  assert.ok(r.payload.editorial_contribution);
  assert.equal(r.payload.editorial_contribution.consent.edit_and_publish, true);
});

check('validate rejects editorial mode without consents', () => {
  const r = api.validateAndSanitize({
    intake_mode: 'editorial',
    contact: baseContact(),
    editorial_contribution: {
      topic: 'X', summary: 'Korte samenvatting van minstens twintig tekens.',
      consent: { edit_and_publish: false, editorial_may_contact: true, no_confidential_information: true },
    },
    privacy: basePrivacy(),
  });
  assert.ok(r.error);
});

check('validate accepts both mode (org+editorial)', () => {
  const r = api.validateAndSanitize({
    intake_mode: 'both',
    contact: baseContact(),
    sector: 'gezondheidszorg',
    organisation_listing: { description: '' },
    editorial_contribution: {
      topic: 'X', summary: 'Korte samenvatting van minstens twintig tekens lang.',
      regional_angle: '', lesson: '',
      consent: { edit_and_publish: true, editorial_may_contact: true, no_confidential_information: true },
    },
    privacy: basePrivacy(),
  });
  assert.ok(!r.error, r.error);
  assert.ok(r.payload.organisation_listing && r.payload.editorial_contribution);
});

check('validate accepts change_request mode with authorization_confirmation', () => {
  const r = api.validateAndSanitize({
    intake_mode: 'change_request',
    contact: baseContact(),
    change_request: {
      target_listing_name: 'Stichting X',
      target_listing_url: 'https://example.org',
      requested_action: 'update',
      change_description: 'Pas adres aan naar nieuw kantoor.',
      reason: 'Verhuisd in maart 2026.',
      authorization_confirmation: true,
      requester_authorization: 'employee',
    },
    privacy: basePrivacy(),
  });
  assert.ok(!r.error, r.error);
  assert.equal(r.payload.change_request.directory_master_touched, false);
  assert.equal(r.payload.change_request.automatic_publication, false);
});

check('validate rejects change_request without authorization_confirmation', () => {
  const r = api.validateAndSanitize({
    intake_mode: 'change_request',
    contact: baseContact(),
    change_request: {
      target_listing_name: 'X', requested_action: 'update',
      change_description: 'Iets', reason: 'Iets',
    },
    privacy: basePrivacy(),
  });
  assert.ok(r.error);
});

check('validate hide_delete forces action to hide|delete', () => {
  const ok = api.validateAndSanitize({
    intake_mode: 'hide_delete',
    contact: baseContact(),
    change_request: {
      target_listing_name: 'X', requested_action: 'hide',
      change_description: 'verberg', reason: 'reden',
      authorization_confirmation: true,
    },
    privacy: basePrivacy(),
  });
  assert.ok(!ok.error, ok.error);
  const bad = api.validateAndSanitize({
    intake_mode: 'hide_delete',
    contact: baseContact(),
    change_request: {
      target_listing_name: 'X', requested_action: 'update',
      change_description: 'x', reason: 'y',
      authorization_confirmation: true,
    },
    privacy: basePrivacy(),
  });
  assert.ok(bad.error);
});

check('validate accepts event mode with all required fields', () => {
  const r = api.validateAndSanitize({
    intake_mode: 'event',
    contact: baseContact({ organisation: '' }),
    sector: 'kritieke-infrastructuur',
    event_intake: {
      event_name: 'ESRF Voorjaarsbijeenkomst',
      organiser: 'ESRF',
      date_start: '2026-06-01',
      location: 'Utrecht',
      country: 'NL',
      description: 'Een bijeenkomst over weerbaarheid en samenwerking.',
      website: 'https://example.org/event',
      contact_name: 'Eva',
      contact_email: 'eva@example.org',
      publication_request: 'events_page',
    },
    privacy: basePrivacy(),
  });
  assert.ok(!r.error, r.error);
  assert.ok(r.payload.event_intake);
  assert.equal(r.payload.event_intake.automatic_publication, false);
});

check('validate event rejects bad publication_request', () => {
  const r = api.validateAndSanitize({
    intake_mode: 'event',
    contact: baseContact(),
    event_intake: {
      event_name: 'X', organiser: 'Y', date_start: '2026-06-01',
      location: 'A', country: 'NL',
      description: 'Lange omschrijving die voldoet aan minimum.',
      website: 'https://example.org', contact_name: 'C', contact_email: 'c@x.org',
      publication_request: 'broadcast',
    },
    privacy: basePrivacy(),
  });
  assert.ok(r.error);
});

// ── Row builders ─────────────────────────────────────────────────────────
check('intake submission row carries no_auto_publication=yes and directory_master_touched=no', () => {
  const r = api.validateAndSanitize({
    intake_mode: 'org', contact: baseContact(), sector: 'overheid',
    organisation_listing: {}, privacy: basePrivacy(),
  });
  r.payload.meta.submission_id = 'sub_test';
  const row = api.buildIntakeSubmissionRow(r.payload);
  assert.equal(row.no_auto_publication, 'yes');
  assert.equal(row.directory_master_touched, 'no');
  assert.equal(row.created_by_flow, 'submit-news.html');
});

check('event row carries automatic_publication=no', () => {
  const r = api.validateAndSanitize({
    intake_mode: 'event', contact: baseContact({ organisation: '' }),
    event_intake: {
      event_name: 'X', organiser: 'Y', date_start: '2026-06-01',
      location: 'A', country: 'NL',
      description: 'Lange omschrijving voor de event-intake test.',
      website: 'https://example.org', contact_name: 'C', contact_email: 'c@x.org',
      publication_request: 'events_page',
    },
    privacy: basePrivacy(),
  });
  const row = api.buildEventIntakeRow(r.payload);
  assert.equal(row.automatic_publication, 'no');
  assert.equal(row.no_auto_publication, 'yes');
});

check('change request row carries directory_master_touched=no and automatic_publication=no', () => {
  const r = api.validateAndSanitize({
    intake_mode: 'change_request', contact: baseContact(),
    change_request: {
      target_listing_name: 'X', requested_action: 'update',
      change_description: 'desc', reason: 'reden',
      authorization_confirmation: true,
    },
    privacy: basePrivacy(),
  });
  const row = api.buildChangeRequestRow(r.payload);
  assert.equal(row.directory_master_touched, 'no');
  assert.equal(row.automatic_publication, 'no');
});

// ── Sheet payload safety ─────────────────────────────────────────────────
check('assertSheetPayloadSafe rejects Directory_Master tab in rows', () => {
  assert.throws(() => api.assertSheetPayloadSafe({
    rows: { Directory_Master: {} },
    forbidden_targets: ['Directory_Master'],
    no_auto_publication: true,
    directory_master_touched: false,
  }));
});
check('assertSheetPayloadSafe rejects payload without forbidden_targets list', () => {
  assert.throws(() => api.assertSheetPayloadSafe({
    rows: { Intake_Submissions: {} },
    no_auto_publication: true,
    directory_master_touched: false,
  }));
});
check('assertSheetPayloadSafe rejects no_auto_publication=false', () => {
  assert.throws(() => api.assertSheetPayloadSafe({
    rows: { Intake_Submissions: {} },
    forbidden_targets: ['Directory_Master'],
    no_auto_publication: false,
    directory_master_touched: false,
  }));
});
check('assertSheetPayloadSafe rejects directory_master_touched=true', () => {
  assert.throws(() => api.assertSheetPayloadSafe({
    rows: { Intake_Submissions: {} },
    forbidden_targets: ['Directory_Master'],
    no_auto_publication: true,
    directory_master_touched: true,
  }));
});
check('assertSheetPayloadSafe accepts a well-formed production payload', () => {
  api.assertSheetPayloadSafe({
    rows: { Intake_Submissions: {}, Editorial_Intake: {} },
    forbidden_targets: ['Directory_Master'],
    no_auto_publication: true,
    directory_master_touched: false,
  });
});

// ── End-to-end POST handler behaviour ────────────────────────────────────
function makeRequest({ origin = 'https://esrf.net', body, contentType = 'application/json' } = {}) {
  return new Request('https://esrf.net/api/intake', {
    method: 'POST',
    headers: { origin, 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body || {}),
  });
}

await checkAsync('POST without sheet webhook env returns 503 + auto_submit_unavailable', async () => {
  const req = makeRequest({ body: validOrgBody() });
  const res = await api.onRequest({ request: req, env: {} });
  assert.equal(res.status, 503);
  const j = await res.json();
  assert.equal(j.ok, false);
  assert.equal(j.auto_submit_unavailable, true);
});

await checkAsync('POST with sheet webhook env writes successfully (mocked fetch)', async () => {
  let captured = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ ok: true, row_id: 'r1' }), { status: 200 });
  };
  try {
    const req = makeRequest({ body: validOrgBody() });
    const res = await api.onRequest({
      request: req,
      env: { INTAKE_SHEET_WEBHOOK_URL: 'https://script.google.test/exec', SHEETS_WEBHOOK_SECRET: 's3cret' },
    });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.ok, true);
    assert.equal(j.no_auto_publication, true);
    assert.equal(j.directory_master_touched, false);
    assert.ok(captured, 'fetch was not called');
    const sent = JSON.parse(captured.init.body);
    assert.equal(sent.target_prefix, '');
    assert.ok(sent.forbidden_targets.includes('Directory_Master'));
    assert.equal(sent.no_auto_publication, true);
    assert.equal(sent.directory_master_touched, false);
    assert.ok(sent.rows.Intake_Submissions, 'expected Intake_Submissions row');
    // No Directory_Master row anywhere.
    for (const k of Object.keys(sent.rows)) assert.ok(k !== 'Directory_Master');
    // Shared secret never echoed back to client.
    assert.ok(!('shared_secret' in j));
  } finally {
    globalThis.fetch = realFetch;
  }
});

await checkAsync('POST returns 502 + auto_submit_unavailable when sheet upstream fails', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('upstream error', { status: 500 });
  try {
    const req = makeRequest({ body: validOrgBody() });
    const res = await api.onRequest({
      request: req,
      env: { INTAKE_SHEET_WEBHOOK_URL: 'https://script.google.test/exec' },
    });
    assert.equal(res.status, 502);
    const j = await res.json();
    assert.equal(j.auto_submit_unavailable, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await checkAsync('POST honeypot triggers 400', async () => {
  const body = validOrgBody();
  body.company_website_hp = 'spam';
  const req = makeRequest({ body });
  const res = await api.onRequest({ request: req, env: {} });
  assert.equal(res.status, 400);
});

await checkAsync('POST too-fast timer triggers 400', async () => {
  const body = validOrgBody();
  body.form_duration_ms = 100;
  const req = makeRequest({ body });
  const res = await api.onRequest({ request: req, env: {} });
  assert.equal(res.status, 400);
});

await checkAsync('POST forbidden origin → 403', async () => {
  const req = makeRequest({ origin: 'https://evil.example', body: validOrgBody() });
  const res = await api.onRequest({ request: req, env: {} });
  assert.equal(res.status, 403);
});

await checkAsync('OPTIONS preflight from allowed origin → 204', async () => {
  const req = new Request('https://esrf.net/api/intake', {
    method: 'OPTIONS',
    headers: { origin: 'https://esrf.net' },
  });
  const res = await api.onRequest({ request: req, env: {} });
  assert.equal(res.status, 204);
});

// ── submit-news.html wiring ──────────────────────────────────────────────
const html = fs.readFileSync(path.join(repoRoot, 'submit-news.html'), 'utf8');

check('submit-news.html POSTs to /api/intake', () => {
  assert.ok(html.includes("fetch('/api/intake'"), 'expected fetch to /api/intake');
});
check('submit-news.html still has a mailto fallback path', () => {
  assert.ok(html.includes('mailto:intake@esrf.net'), 'expected mailto fallback');
});
check('submit-news.html mailto is not the only/primary path (fetch is called first)', () => {
  const fetchIdx = html.indexOf("fetch('/api/intake'");
  const mailtoBranchIdx = html.indexOf('Automatische verzending is tijdelijk niet beschikbaar');
  assert.ok(fetchIdx > 0 && mailtoBranchIdx > fetchIdx, 'fetch must run before fallback');
});
check('submit-news.html surfaces both success states', () => {
  assert.ok(html.includes('id="form-success-auto"'), 'expected auto-success container');
  assert.ok(html.includes('Ontvangen door ESRF-redactie'));
  assert.ok(html.includes('Er wordt') && html.includes('niets automatisch gepubliceerd'));
});
check('submit-news.html surfaces explicit fallback message', () => {
  assert.ok(html.includes('Automatische verzending is tijdelijk niet beschikbaar'));
});
check('submit-news.html builds JSON payload supporting all 6 modes', () => {
  assert.ok(html.includes('buildJsonPayload'));
  for (const mode of ['org','editorial','both','change_request','hide_delete','event']) {
    assert.ok(html.includes("'" + mode + "'") || html.includes('"' + mode + '"'),
      'expected mode literal ' + mode);
  }
  assert.ok(html.includes('event_intake'));
  assert.ok(html.includes('change_request'));
  assert.ok(html.includes('editorial_contribution'));
  assert.ok(html.includes('organisation_listing'));
});
check('submit-news.html has a manual mailto fallback button', () => {
  assert.ok(html.includes('id="sv-mailto-fallback"'));
});
check('submit-news.html does not expose secrets or internal links', () => {
  for (const needle of [
    'INTAKE_SHEET_WEBHOOK_URL',
    'SHEETS_WEBHOOK_SECRET',
    'docs.google.com/spreadsheets',
    'LAB_',
    'Directory_Master',
  ]) {
    assert.ok(!html.includes(needle), 'unexpected leak: ' + needle);
  }
});
check('i18n/nl.json + i18n/en.json still parse', () => {
  JSON.parse(fs.readFileSync(path.join(repoRoot, 'i18n', 'nl.json'), 'utf8'));
  JSON.parse(fs.readFileSync(path.join(repoRoot, 'i18n', 'en.json'), 'utf8'));
});

// ── Helper bodies ────────────────────────────────────────────────────────
function validOrgBody() {
  return {
    intake_mode: 'org',
    form_duration_ms: 5000,
    sector: 'kritieke-infrastructuur',
    contact: baseContact(),
    organisation_listing: { description: 'Doet aan veiligheid.' },
    privacy: basePrivacy(),
  };
}

if (failures > 0) {
  console.log('\n' + failures + ' check(s) failed');
  process.exit(1);
} else {
  console.log('\nAll intake.test checks passed.');
}
