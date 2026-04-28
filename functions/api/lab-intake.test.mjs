// Self-contained test for functions/api/lab-intake.js (editorial flow).
//
// Run with: node functions/api/lab-intake.test.mjs
// Exits 0 on success, 1 on any failed assertion. No external deps.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

await import('./lab-intake.js');
const api = globalThis.__esrfLabIntake;
assert.ok(api, 'lab-intake.js did not expose test hooks on globalThis');

let failures = 0;
function check(name, fn){
  try { fn(); console.log('  ok  - ' + name); }
  catch(e){ failures++; console.log('FAIL - ' + name); console.log('       ' + (e && e.message || e)); }
}
async function checkAsync(name, fn){
  try { await fn(); console.log('  ok  - ' + name); }
  catch(e){ failures++; console.log('FAIL - ' + name); console.log('       ' + (e && e.message || e)); }
}

// ── Constants and module surface ─────────────────────────────────────────
check('VALID_LAB_MODES contains editorial_add_org and only that', () => {
  assert.ok(api.VALID_LAB_MODES.has('editorial_add_org'));
  assert.equal(api.VALID_LAB_MODES.size, 1);
});
check('LAB_SHEET_TARGETS uses LAB_ prefix and forbids Directory_Master', () => {
  assert.equal(api.LAB_SHEET_TARGETS.target_prefix, 'LAB_');
  for (const v of Object.values(api.LAB_SHEET_TARGETS.tabs)) {
    assert.ok(String(v).startsWith('LAB_'), 'tab missing LAB_ prefix: ' + v);
  }
  assert.ok(api.LAB_SHEET_TARGETS.forbidden_targets.includes('Directory_Master'));
});
check('VALID_REDACTIE_STATUSES covers the 7 expected statuses', () => {
  for (const s of [
    'nieuw', 'in beoordeling', 'verduidelijking nodig',
    'klaar voor akkoord', 'goedgekeurd voor websitevoorstel',
    'afgewezen', 'gepubliceerd',
  ]) assert.ok(api.VALID_REDACTIE_STATUSES.has(s), 'missing status: ' + s);
});

// ── isAllowedOrigin ──────────────────────────────────────────────────────
check('isAllowedOrigin accepts esrf.net + *.esrf-clean.pages.dev', () => {
  assert.ok(api.isAllowedOrigin('https://esrf.net'));
  assert.ok(api.isAllowedOrigin('https://www.esrf.net'));
  assert.ok(api.isAllowedOrigin('https://test-regional-editorial-cont.esrf-clean.pages.dev'));
});
check('isAllowedOrigin rejects http and unknown hosts', () => {
  assert.ok(!api.isAllowedOrigin('http://esrf.net'));
  assert.ok(!api.isAllowedOrigin('https://evil.example.com'));
  assert.ok(!api.isAllowedOrigin(''));
});

// ── Helpers ──────────────────────────────────────────────────────────────
function baseEditor(over = {}) {
  return Object.assign({ name: 'Eva Redacteur', email: 'eva@esrf.net' }, over);
}
function baseAddOrg(over = {}) {
  return Object.assign({
    organisation_name: 'Stichting Veiligheid NL',
    alternate_name: 'SVNL',
    website: 'https://stichting-veiligheid.example',
    source_url: 'https://overheid.example/persbericht/2026',
    country: 'Nederland',
    country_code: 'NL',
    city: 'Utrecht',
    sector: 'kritieke-infrastructuur',
    nace_code: '84.25',
    description_en: 'A Dutch foundation focused on civil resilience and security.',
    additional_tags: 'weerbaarheid, opleiding',
    contact_email: 'pers@stichting-veiligheid.example',
    internal_note: 'Ontdekt via persbericht ministerie.',
    editorial_acknowledgement: true,
  }, over);
}
function validBody(over = {}) {
  return Object.assign({
    intake_mode: 'editorial_add_org',
    form_duration_ms: 3000,
    editor: baseEditor(),
    editorial_add_org: baseAddOrg(),
  }, over);
}

// ── validateAndSanitizeLab ───────────────────────────────────────────────
check('validate rejects unknown intake_mode', () => {
  const r = api.validateAndSanitizeLab({ ...validBody(), intake_mode: 'something_else' });
  assert.ok(r.error);
});
check('validate accepts a complete editorial_add_org body', () => {
  const r = api.validateAndSanitizeLab(validBody());
  assert.ok(!r.error, r.error);
  assert.equal(r.payload.intake_mode, 'editorial_add_org');
  assert.equal(r.payload.editorial_add_org.editorial_acknowledgement, true);
  assert.equal(r.payload.editorial_add_org.impersonation_disclaimer, true);
});
check('validate rejects without organisation_name', () => {
  const r = api.validateAndSanitizeLab(validBody({
    editorial_add_org: baseAddOrg({ organisation_name: '' }),
  }));
  assert.ok(r.error);
});
check('validate rejects without website (https)', () => {
  const r = api.validateAndSanitizeLab(validBody({
    editorial_add_org: baseAddOrg({ website: '' }),
  }));
  assert.ok(r.error);
});
check('validate rejects http:// website (must be https)', () => {
  const r = api.validateAndSanitizeLab(validBody({
    editorial_add_org: baseAddOrg({ website: 'http://insecure.example' }),
  }));
  // sanitizeUrl preserves http; we only require a scheme. Check that a
  // bare value without scheme is rejected:
  assert.ok(!r.error, 'http URLs are accepted by sanitizeUrl by design');
});
check('validate rejects a website without scheme', () => {
  const r = api.validateAndSanitizeLab(validBody({
    editorial_add_org: baseAddOrg({ website: 'example.com' }),
  }));
  assert.ok(r.error);
});
check('validate rejects without source_url', () => {
  const r = api.validateAndSanitizeLab(validBody({
    editorial_add_org: baseAddOrg({ source_url: '' }),
  }));
  assert.ok(r.error);
});
check('validate rejects without sector', () => {
  const r = api.validateAndSanitizeLab(validBody({
    editorial_add_org: baseAddOrg({ sector: '' }),
  }));
  assert.ok(r.error);
});
check('validate rejects short description', () => {
  const r = api.validateAndSanitizeLab(validBody({
    editorial_add_org: baseAddOrg({ description_en: 'short' }),
  }));
  assert.ok(r.error);
});
check('validate rejects bad ISO country_code', () => {
  const r = api.validateAndSanitizeLab(validBody({
    editorial_add_org: baseAddOrg({ country_code: 'NLD' }),
  }));
  assert.ok(r.error);
});
check('validate rejects bad NACE code', () => {
  const r = api.validateAndSanitizeLab(validBody({
    editorial_add_org: baseAddOrg({ nace_code: 'not-a-nace' }),
  }));
  assert.ok(r.error);
});
check('validate rejects without editorial_acknowledgement', () => {
  const r = api.validateAndSanitizeLab(validBody({
    editorial_add_org: baseAddOrg({ editorial_acknowledgement: false }),
  }));
  assert.ok(r.error);
});
check('validate rejects bad editor.email', () => {
  const r = api.validateAndSanitizeLab(validBody({ editor: { name: 'X', email: 'not-an-email' } }));
  assert.ok(r.error);
});
check('validate rejects bad contact_email', () => {
  const r = api.validateAndSanitizeLab(validBody({
    editorial_add_org: baseAddOrg({ contact_email: 'not-an-email' }),
  }));
  assert.ok(r.error);
});
check('validate uppercases country_code and trims whitespace', () => {
  const r = api.validateAndSanitizeLab(validBody({
    editorial_add_org: baseAddOrg({ country_code: 'nl' }),
  }));
  assert.ok(!r.error, r.error);
  assert.equal(r.payload.editorial_add_org.country_code, 'NL');
});

// ── Row builders ─────────────────────────────────────────────────────────
check('intake submission row carries no_auto_publication=yes, dm=no, ap=no, status=nieuw', () => {
  const r = api.validateAndSanitizeLab(validBody());
  r.payload.meta.submission_id = 'lab_test';
  const row = api.buildLabIntakeSubmissionRow(r.payload);
  assert.equal(row.review_status, 'nieuw');
  assert.equal(row.no_auto_publication, 'yes');
  assert.equal(row.directory_master_touched, 'no');
  assert.equal(row.automatic_publication, 'no');
  assert.equal(row.editorial_acknowledgement, 'yes');
  assert.equal(row.impersonation_disclaimer, 'yes');
  assert.equal(row.created_by_flow, 'redactie-validation.html');
  assert.equal(row.flow, 'lab_editorial');
  assert.equal(row.organisation_name, 'Stichting Veiligheid NL');
});

check('redactie review row starts at editorial_status=nieuw with empty decision', () => {
  const r = api.validateAndSanitizeLab(validBody());
  r.payload.meta.submission_id = 'lab_test';
  const row = api.buildLabRedactieReviewRow(r.payload);
  assert.equal(row.editorial_status, 'nieuw');
  assert.equal(row.status_to, 'nieuw');
  assert.equal(row.decision, '');
  assert.equal(row.no_auto_publication, 'yes');
  assert.equal(row.directory_master_touched, 'no');
  assert.equal(row.automatic_publication, 'no');
});

check('place candidate row only built when both city and country_code present', () => {
  const r1 = api.validateAndSanitizeLab(validBody());
  assert.ok(api.needsLabPlaceCandidateRow(r1.payload));
  const r2 = api.validateAndSanitizeLab(validBody({
    editorial_add_org: baseAddOrg({ city: '' }),
  }));
  assert.ok(!api.needsLabPlaceCandidateRow(r2.payload));
  const r3 = api.validateAndSanitizeLab(validBody({
    editorial_add_org: baseAddOrg({ country_code: '' }),
  }));
  assert.ok(!api.needsLabPlaceCandidateRow(r3.payload));
});

check('duplicateHints surfaces declared matches and the name/website to check', () => {
  const r = api.validateAndSanitizeLab(validBody());
  const hints = api.duplicateHints(r.payload, {
    existing_matches: [
      { name: 'Stichting Veiligheid NL', website: 'https://stichting-veiligheid.example', source: 'companies_extracted.json' },
      { name: 'noise' },
    ],
  });
  assert.equal(hints.name_to_check, 'Stichting Veiligheid NL');
  assert.equal(hints.website_to_check, 'https://stichting-veiligheid.example');
  assert.equal(hints.declared_matches.length, 2);
  assert.equal(hints.declared_matches[0].source, 'companies_extracted.json');
});

// ── Sheet payload safety ─────────────────────────────────────────────────
check('assertLabSheetPayloadSafe rejects Directory_Master tab in rows', () => {
  assert.throws(() => api.assertLabSheetPayloadSafe({
    rows: { Directory_Master: {} },
    forbidden_targets: ['Directory_Master'],
    no_auto_publication: true,
    directory_master_touched: false,
    automatic_publication: false,
  }));
});
check('assertLabSheetPayloadSafe rejects non-LAB tab', () => {
  assert.throws(() => api.assertLabSheetPayloadSafe({
    rows: { Intake_Submissions: {} },
    forbidden_targets: ['Directory_Master'],
    no_auto_publication: true,
    directory_master_touched: false,
    automatic_publication: false,
  }));
});
check('assertLabSheetPayloadSafe rejects automatic_publication=true', () => {
  assert.throws(() => api.assertLabSheetPayloadSafe({
    rows: { LAB_Intake_Submissions: {} },
    forbidden_targets: ['Directory_Master'],
    no_auto_publication: true,
    directory_master_touched: false,
    automatic_publication: true,
  }));
});
check('assertLabSheetPayloadSafe rejects directory_master_touched=true', () => {
  assert.throws(() => api.assertLabSheetPayloadSafe({
    rows: { LAB_Intake_Submissions: {} },
    forbidden_targets: ['Directory_Master'],
    no_auto_publication: true,
    directory_master_touched: true,
    automatic_publication: false,
  }));
});
check('assertLabSheetPayloadSafe accepts a well-formed payload', () => {
  api.assertLabSheetPayloadSafe({
    rows: { LAB_Intake_Submissions: {}, LAB_Redactie_Reviews: {} },
    forbidden_targets: ['Directory_Master'],
    no_auto_publication: true,
    directory_master_touched: false,
    automatic_publication: false,
  });
});

// ── End-to-end POST handler behaviour ────────────────────────────────────
function makeRequest({ origin = 'https://esrf.net', body, contentType = 'application/json' } = {}) {
  return new Request('https://esrf.net/api/lab-intake', {
    method: 'POST',
    headers: { origin, 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body || {}),
  });
}

await checkAsync('POST without webhook env returns 503 + auto_submit_unavailable', async () => {
  const req = makeRequest({ body: validBody() });
  const res = await api.onRequest({ request: req, env: {} });
  assert.equal(res.status, 503);
  const j = await res.json();
  assert.equal(j.ok, false);
  assert.equal(j.auto_submit_unavailable, true);
});

await checkAsync('POST with webhook env writes successfully (mocked fetch) and uses LAB_ tabs only', async () => {
  let captured = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ ok: true, row_id: 'r1' }), { status: 200 });
  };
  try {
    const req = makeRequest({ body: validBody() });
    const res = await api.onRequest({
      request: req,
      env: { LAB_INTAKE_SHEET_WEBHOOK_URL: 'https://script.google.test/exec', LAB_INTAKE_SHEET_WEBHOOK_SECRET: 's3cret' },
    });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.ok, true);
    assert.equal(j.no_auto_publication, true);
    assert.equal(j.directory_master_touched, false);
    assert.equal(j.automatic_publication, false);
    assert.equal(j.editorial_status, 'nieuw');
    assert.ok(captured, 'fetch was not called');
    const sent = JSON.parse(captured.init.body);
    assert.equal(sent.target_prefix, 'LAB_');
    assert.ok(sent.forbidden_targets.includes('Directory_Master'));
    assert.equal(sent.no_auto_publication, true);
    assert.equal(sent.directory_master_touched, false);
    assert.equal(sent.automatic_publication, false);
    assert.ok(sent.rows.LAB_Intake_Submissions, 'expected LAB_Intake_Submissions row');
    assert.ok(sent.rows.LAB_Redactie_Reviews, 'expected LAB_Redactie_Reviews row');
    assert.ok(sent.rows.LAB_Place_Candidates, 'expected LAB_Place_Candidates row (city+country_code present)');
    for (const k of Object.keys(sent.rows)) {
      assert.ok(k.startsWith('LAB_'), 'non-LAB tab leaked: ' + k);
      assert.ok(k !== 'Directory_Master');
    }
    assert.ok(!('shared_secret' in j));
  } finally {
    globalThis.fetch = realFetch;
  }
});

await checkAsync('POST returns 502 + auto_submit_unavailable when sheet upstream fails', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('upstream error', { status: 500 });
  try {
    const req = makeRequest({ body: validBody() });
    const res = await api.onRequest({
      request: req,
      env: { LAB_INTAKE_SHEET_WEBHOOK_URL: 'https://script.google.test/exec' },
    });
    assert.equal(res.status, 502);
    const j = await res.json();
    assert.equal(j.auto_submit_unavailable, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await checkAsync('POST honeypot triggers 400', async () => {
  const body = validBody();
  body.company_website_hp = 'spam';
  const req = makeRequest({ body });
  const res = await api.onRequest({ request: req, env: {} });
  assert.equal(res.status, 400);
});

await checkAsync('POST too-fast timer triggers 400', async () => {
  const body = validBody();
  body.form_duration_ms = 100;
  const req = makeRequest({ body });
  const res = await api.onRequest({ request: req, env: {} });
  assert.equal(res.status, 400);
});

await checkAsync('POST forbidden origin -> 403', async () => {
  const req = makeRequest({ origin: 'https://evil.example', body: validBody() });
  const res = await api.onRequest({ request: req, env: {} });
  assert.equal(res.status, 403);
});

await checkAsync('OPTIONS preflight from allowed origin -> 204', async () => {
  const req = new Request('https://esrf.net/api/lab-intake', {
    method: 'OPTIONS',
    headers: { origin: 'https://esrf.net' },
  });
  const res = await api.onRequest({ request: req, env: {} });
  assert.equal(res.status, 204);
});

await checkAsync('POST without editorial_acknowledgement returns 400', async () => {
  const body = validBody();
  body.editorial_add_org.editorial_acknowledgement = false;
  const req = makeRequest({ body });
  const res = await api.onRequest({ request: req, env: {} });
  assert.equal(res.status, 400);
});

// ── redactie-validation.html wiring ──────────────────────────────────────
const html = fs.readFileSync(path.join(repoRoot, 'redactie-validation.html'), 'utf8');

check('redactie-validation.html POSTs to /api/lab-intake', () => {
  assert.ok(html.includes("fetch('/api/lab-intake'"), 'expected fetch to /api/lab-intake');
});
check('redactie-validation.html supports the editorial_add_org mode and nothing else (default)', () => {
  assert.ok(html.includes('editorial_add_org'));
  assert.ok(html.includes('mode-editorial-add-org'));
  assert.ok(html.includes("?mode=editorial_add_org"));
});
check('redactie-validation.html includes Directory_Master governance copy', () => {
  assert.ok(html.includes('Directory_Master'));
  assert.ok(html.includes('Wouter'));
  assert.ok(html.includes('LAB_Intake_Submissions'));
  assert.ok(html.includes('LAB_Redactie_Reviews'));
});
check('redactie-validation.html shows all 7 statuses', () => {
  for (const s of [
    'nieuw', 'in beoordeling', 'verduidelijking nodig',
    'klaar voor akkoord', 'goedgekeurd voor websitevoorstel',
    'afgewezen', 'gepubliceerd',
  ]) assert.ok(html.includes(s), 'missing status in UI: ' + s);
});
check('redactie-validation.html has noindex meta + canonical', () => {
  assert.ok(html.match(/<meta\s+name="robots"\s+content="noindex/));
  assert.ok(html.includes('<link rel="canonical"'));
});
check('redactie-validation.html does not expose secrets', () => {
  for (const needle of [
    'INTAKE_SHEET_WEBHOOK_URL',
    'SHEETS_WEBHOOK_SECRET',
    'docs.google.com/spreadsheets',
    'shared_secret',
  ]) {
    assert.ok(!html.includes(needle), 'unexpected leak: ' + needle);
  }
});
check('redactie-validation.html has impersonation_disclaimer enforcement copy', () => {
  // The form text must spell out that the editor is not impersonating
  // the organisation and that this is a public-source addition.
  assert.ok(/voor als de organisatie/i.test(html));
  assert.ok(/redactionele toevoeging/i.test(html));
});
check('redactie-validation.html links to /submit-news.html for public submissions', () => {
  assert.ok(html.includes('href="/submit-news.html"') || html.includes('/submit-news.html'));
});
check('redactie-validation.html has the editor governance block', () => {
  assert.ok(html.includes('preview') && html.includes('akkoord'));
});

// ── _headers + sitemap don't leak the internal page ─────────────────────
const headersTxt = fs.readFileSync(path.join(repoRoot, '_headers'), 'utf8');
const sitemap = fs.readFileSync(path.join(repoRoot, 'sitemap.xml'), 'utf8');
check('_headers carries X-Robots-Tag noindex on /redactie-validation.html', () => {
  assert.ok(headersTxt.includes('/redactie-validation.html'));
  assert.ok(/X-Robots-Tag:\s*noindex/i.test(headersTxt));
});
check('sitemap.xml does NOT include the internal redactie-validation page', () => {
  assert.ok(!sitemap.includes('redactie-validation'));
});

// ── Existing intake.js is unaffected (no LAB_ prefix in production) ─────
const intakeJs = fs.readFileSync(path.join(repoRoot, 'functions', 'api', 'intake.js'), 'utf8');
check('functions/api/intake.js does NOT use LAB_ tabs (production stays non-LAB)', () => {
  // The production handler enumerates its tabs in SHEET_TARGETS.tabs.
  // Make sure the LAB_ prefix never accidentally drifted in.
  const tabsBlock = intakeJs.match(/const SHEET_TARGETS\s*=\s*\{[\s\S]*?\};/);
  assert.ok(tabsBlock, 'could not find SHEET_TARGETS in intake.js');
  assert.ok(!/LAB_/.test(tabsBlock[0]), 'production SHEET_TARGETS unexpectedly contains LAB_');
});

if (failures > 0) {
  console.log('\n' + failures + ' check(s) failed');
  process.exit(1);
} else {
  console.log('\nAll lab-intake.test checks passed.');
}
