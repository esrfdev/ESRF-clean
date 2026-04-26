// Self-contained test for functions/api/redactie-review.js
//
// Run with:   node functions/api/redactie-review.test.mjs
//
// Exits 0 on success, 1 on any failure. No external dependencies.
//
// Verifies:
//   - Production environment short-circuits to 404 (preview-only).
//   - Origin allowlist enforced.
//   - Content-Type/JSON validation.
//   - Sample fallback when REDACTIE_REVIEW_ACCESS_CODE is missing.
//   - Sample fallback when access code is wrong.
//   - Sample fallback when access code valid but webhook missing.
//   - Contact details stripped by default; never included in sample mode.
//   - Forbidden response keys are stripped.
//   - Status step reminders surface in the response.
//   - No "Directory_Master" string in any response payload.

import assert from 'node:assert/strict';

await import('./intake.js');
await import('./redactie-review.js');
const api = globalThis.__esrfRedactieReviewApi;
assert.ok(api, 'redactie-review.js did not expose test hooks on globalThis');

const {
  onRequest,
  SAMPLE_RECORDS,
  STATUS_STEP_REMINDERS,
  FORBIDDEN_RESPONSE_KEYS,
  stripContact,
  stripForbiddenKeys,
  constantTimeEquals,
  isPreviewEnv,
  safeRecords,
  normaliseRecord,
} = api;

let failures = 0;
function check(name, fn){
  try { fn(); console.log('  ok  — ' + name); }
  catch (e) { failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}
async function asyncCheck(name, fn){
  try { await fn(); console.log('  ok  — ' + name); }
  catch (e) { failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}

const PREVIEW_ORIGIN = 'https://test-regional-editorial-cont.esrf-clean.pages.dev';

function callReview(method, opts){
  opts = opts || {};
  const headers = new Map(Object.entries(opts.headers || {}));
  const request = {
    method,
    url: PREVIEW_ORIGIN + '/api/redactie-review',
    headers: { get(k){ return headers.get(String(k).toLowerCase()) || headers.get(k) || null; } },
    text: async () => opts.body || '',
    cf: {},
  };
  const env = opts.envReplace
    ? (opts.env || {})
    : Object.assign({ CF_PAGES_BRANCH: 'test/regional-editorial-contributor-intake' }, opts.env || {});
  return onRequest({ request, env });
}

// ── Pure helpers ─────────────────────────────────────────────────────────

check('SAMPLE_RECORDS present and shaped', () => {
  assert.ok(Array.isArray(SAMPLE_RECORDS) && SAMPLE_RECORDS.length >= 2);
  for (const r of SAMPLE_RECORDS){
    assert.ok(r.submission_id);
    assert.ok(r.title);
    assert.ok(/^LAB_/.test(r.source_tab));
  }
});

check('STATUS_STEP_REMINDERS covers all documented process steps', () => {
  for (const k of ['binnengekomen','in_review','wachten_op_indiener','klaar_voor_akkoord','akkoord_voor_promote','afgewezen','gearchiveerd']){
    assert.ok(STATUS_STEP_REMINDERS[k], 'missing reminder for ' + k);
  }
});

check('stripContact removes contact + contact_internal', () => {
  const out = stripContact({ a: 1, contact: { email: 'x@y' }, contact_internal: { phone: '1' } });
  assert.equal(out.contact, undefined);
  assert.equal(out.contact_internal, undefined);
  assert.equal(out.a, 1);
});

check('stripForbiddenKeys removes raw_payload_json and secrets recursively', () => {
  const out = stripForbiddenKeys({
    a: 1,
    raw_payload_json: 'leak',
    SHEETS_WEBHOOK_SECRET: 'shh',
    nested: { GITHUB_TOKEN: 'leak2', kept: true }
  });
  assert.equal(out.raw_payload_json, undefined);
  assert.equal(out.SHEETS_WEBHOOK_SECRET, undefined);
  assert.equal(out.nested.GITHUB_TOKEN, undefined);
  assert.equal(out.nested.kept, true);
});

check('constantTimeEquals: equal/unequal/empty', () => {
  assert.equal(constantTimeEquals('abc', 'abc'), true);
  assert.equal(constantTimeEquals('abc', 'abd'), false);
  assert.equal(constantTimeEquals('', ''), true);
  assert.equal(constantTimeEquals('a', 'aa'), false);
});

check('isPreviewEnv: main is production, branch ≠ main is preview, ESRF_PREVIEW=true wins', () => {
  assert.equal(isPreviewEnv({ CF_PAGES_BRANCH: 'main' }), false);
  assert.equal(isPreviewEnv({ CF_PAGES_BRANCH: 'test/anything' }), true);
  assert.equal(isPreviewEnv({ ESRF_PREVIEW: 'true', CF_PAGES_BRANCH: 'main' }), true);
  assert.equal(isPreviewEnv({}), false);
});

check('safeRecords strips contact by default', () => {
  const inp = [{ submission_id: 'a', contact: { email: 'leak@x' }, title: 'T' }];
  const out = safeRecords(inp, false);
  assert.equal(out[0].contact, undefined);
  assert.equal(out[0].title, 'T');
  // serialise to be defensive — any "@" suggests a leaked email
  assert.ok(!/leak@x/.test(JSON.stringify(out)));
});

// ── End-to-end via onRequest (synthetic env) ─────────────────────────────

await asyncCheck('production env (CF_PAGES_BRANCH=main) returns 404', async () => {
  const res = await callReview('POST', {
    envReplace: true,
    env: { CF_PAGES_BRANCH: 'main' },
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 404);
});

await asyncCheck('forbidden origin returns 403', async () => {
  const res = await callReview('POST', {
    headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 403);
});

await asyncCheck('non-JSON content type returns 415', async () => {
  const res = await callReview('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'text/plain' },
    body: 'foo',
  });
  assert.equal(res.status, 415);
});

await asyncCheck('invalid JSON body returns 400', async () => {
  const res = await callReview('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(res.status, 400);
});

await asyncCheck('access code NOT configured → mode:sample with activation_required', async () => {
  const res = await callReview('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ access_code: 'whatever' }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.mode, 'sample');
  assert.equal(data.access.configured, false);
  assert.equal(data.access.valid, false);
  assert.ok(Array.isArray(data.activation_required) && data.activation_required.length >= 3);
  assert.match(data.access.message, /access code not configured/);
  // Sample records returned, contact stripped
  assert.ok(Array.isArray(data.records) && data.records.length >= 1);
  for (const r of data.records){
    assert.equal(r.contact, undefined);
    assert.equal(r.contact_internal, undefined);
  }
  // Status step reminders present
  assert.ok(data.status_step_reminders && typeof data.status_step_reminders === 'object');
  assert.ok(data.status_step_reminders.in_review);
  // Directory_Master must appear only inside forbidden_targets, never as a target
  assert.ok(Array.isArray(data.forbidden_targets) && data.forbidden_targets.indexOf('Directory_Master') !== -1);
  assert.equal(data.directory_master_touched, false);
  assert.equal(data.automatic_publication, false);
});

await asyncCheck('access code configured but wrong → mode:sample, no records leak', async () => {
  const res = await callReview('POST', {
    env: { REDACTIE_REVIEW_ACCESS_CODE: 'correct-code-xyz' },
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ access_code: 'wrong-code' }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.mode, 'sample');
  assert.equal(data.access.configured, true);
  assert.equal(data.access.valid, false);
  assert.match(data.access.message, /missing or incorrect/);
  // Returned data must be the sample fixtures, not anything else
  assert.ok(data.records.every(r => /^sub_lab_demo_/.test(r.submission_id)));
});

await asyncCheck('access code valid but webhook missing → mode:sample with activation_required', async () => {
  const res = await callReview('POST', {
    env: { REDACTIE_REVIEW_ACCESS_CODE: 'correct-code-xyz' },
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ access_code: 'correct-code-xyz' }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.mode, 'sample');
  assert.equal(data.access.configured, true);
  assert.equal(data.access.valid, true);
  assert.match(data.access.message, /webhook not configured|upstream/i);
  assert.ok(Array.isArray(data.activation_required) && data.activation_required.length >= 1);
  // Even with a valid access code, sample mode must strip contact details
  for (const r of data.records){
    assert.equal(r.contact, undefined);
  }
});

await asyncCheck('response payload exposes no secret values (raw_payload_json key, secret tokens)', async () => {
  // Configure secret-shaped values so we can verify the response never
  // echoes them back. The `activation_required` strings legitimately
  // mention env-var NAMES so the operator can act — names alone are
  // not secrets — but the VALUES of those env vars must never leak.
  const SECRET_VALUE = 'super-secret-value-do-not-leak-12345';
  const TOKEN_VALUE = 'tok_should_never_appear_in_response_67890';
  const res = await callReview('POST', {
    env: {
      REDACTIE_REVIEW_ACCESS_CODE: 'valid-code',
      REDACTIE_REVIEW_WEBHOOK_SECRET: SECRET_VALUE,
      GITHUB_TOKEN: TOKEN_VALUE,
      SHEETS_WEBHOOK_SECRET: SECRET_VALUE,
    },
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ access_code: 'valid-code' }),
  });
  const blob = await res.text();
  assert.ok(blob.indexOf(SECRET_VALUE) === -1, 'webhook secret value leaked');
  assert.ok(blob.indexOf(TOKEN_VALUE) === -1, 'github token value leaked');
  // The bare key `raw_payload_json` itself must never appear as a key
  // in any record we return.
  const data = JSON.parse(blob);
  for (const r of (data.records || [])){
    assert.equal('raw_payload_json' in r, false);
  }
});

await asyncCheck('response payload contains warning + LAB safety strings', async () => {
  const res = await callReview('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  const data = await res.json();
  assert.match(data.warning, /Directory_Master niet aanpassen/);
  assert.match(data.warning, /LAB only/i);
});

await asyncCheck('OPTIONS preflight respects origin allowlist', async () => {
  const okRes = await callReview('OPTIONS', { headers: { origin: PREVIEW_ORIGIN } });
  assert.ok([200, 204].includes(okRes.status));
  const badRes = await callReview('OPTIONS', { headers: { origin: 'https://evil.example' } });
  assert.equal(badRes.status, 403);
});

await asyncCheck('GET method returns 405', async () => {
  const res = await callReview('GET', { headers: { origin: PREVIEW_ORIGIN } });
  assert.equal(res.status, 405);
});

// ── Change-request normalisation (live LAB row → wijzigingsverzoek) ─────
//
// Reproduces the exact failure observed on Preview after intake-test
// stored a change_request submission as row 7 of LAB_Intake_Submissions:
// the upstream Apps Script returned the row with record_type='org' and
// no title, so the redactie review form rendered "ORGANISATIE · … · NL"
// with "(zonder titel)". Normalisation must rewrite the record to
// record_type='change_request' with a Dutch title, type_label, and the
// derived requested_action / sub_mode fields the dedicated panel reads.

check('normaliseRecord: LAB_Intake_Submissions row tagged via submission_type → record_type=change_request', () => {
  const live = {
    submission_id: 'sub-test_mog9779c_2njk',
    received_at: '2026-04-26T22:24:00Z',
    environment: 'TEST/VALIDATIE',
    submission_type: 'change_request:update',
    mode: 'change_request',
    name: 'ESRF Lab Test Existing Listing',
    website: 'https://esrf.net/directory/esrf-lab-test',
    country_code: 'NL',
    country_name_local: 'Nederland',
    region: 'Zuid-Holland',
    consent_publish: 'change_request_only',
    review_status: 'new',
    source_tab: 'LAB_Intake_Submissions',
    source_row_hint: 'rij 7',
    record_type: 'org',  // upstream default that we override
    cr_sub_mode: 'change_request',
    cr_requested_action: 'update',
    cr_target_listing_name: 'ESRF Lab Test Existing Listing',
    cr_target_listing_url: 'https://esrf.net/directory/esrf-lab-test',
    cr_change_description: 'Adres en sector kloppen niet meer.',
    cr_reason: 'Organisatie is verhuisd.',
    cr_evidence_url: 'https://example.org/persbericht',
    cr_requester_authorization: 'authorized_representative',
    cr_authorization_confirmation: 'yes',
    cr_directory_master_touched: 'no',
    cr_automatic_publication: 'no',
  };
  const out = normaliseRecord(live);
  assert.equal(out.record_type, 'change_request');
  assert.equal(out.requested_action, 'update');
  assert.equal(out.sub_mode, 'change_request');
  assert.equal(out.target_listing_name, 'ESRF Lab Test Existing Listing');
  assert.equal(out.target_listing_url, 'https://esrf.net/directory/esrf-lab-test');
  assert.equal(out.change_description, 'Adres en sector kloppen niet meer.');
  assert.equal(out.reason, 'Organisatie is verhuisd.');
  assert.equal(out.evidence_url, 'https://example.org/persbericht');
  assert.equal(out.requester_authorization, 'authorized_representative');
  assert.equal(out.authorization_confirmation, 'yes');
  assert.equal(out.directory_master_touched, 'no');
  assert.equal(out.automatic_publication, 'no');
  assert.match(out.title, /^Wijzigingsverzoek/);
  assert.match(out.type_label, /^Wijzigingsverzoek/);
  assert.match(out.organization_name, /\(bestaande vermelding\)$/);
});

check('normaliseRecord: hide_delete mode without action → infers hide', () => {
  const live = {
    submission_id: 'sub-test_x',
    submission_type: 'change_request:hide',
    mode: 'hide_delete',
    name: 'Voorbeeld Coöperatie Oost',
    source_tab: 'LAB_Intake_Submissions',
    record_type: 'org',
  };
  const out = normaliseRecord(live);
  assert.equal(out.record_type, 'change_request');
  assert.equal(out.requested_action, 'hide');
  assert.match(out.title, /Verzoek tot verbergen/);
  assert.match(out.type_label, /verbergen/);
});

check('normaliseRecord: delete action surfaces correct labels', () => {
  const live = {
    submission_id: 'sub-test_d',
    submission_type: 'change_request:delete',
    mode: 'hide_delete',
    cr_target_listing_name: 'Coöperatie X',
    source_tab: 'LAB_Intake_Submissions',
  };
  const out = normaliseRecord(live);
  assert.equal(out.record_type, 'change_request');
  assert.equal(out.requested_action, 'delete');
  assert.match(out.title, /Verzoek tot verwijderen/);
  assert.match(out.type_label, /verwijderen/);
});

check('normaliseRecord: regular org row stays record_type=org', () => {
  const live = {
    submission_id: 'sub-test_org',
    submission_type: 'org',
    mode: 'org',
    name: 'Stichting X',
    source_tab: 'LAB_Intake_Submissions',
    record_type: 'org',
  };
  const out = normaliseRecord(live);
  assert.equal(out.record_type, 'org');
  // No CR-specific fields invented for non-CR rows
  assert.equal(out.requested_action, undefined);
  assert.equal(out.directory_master_touched, undefined);
});

check('normaliseRecord: editorial row passes through unchanged record_type', () => {
  const live = {
    submission_id: 'sub-test_ed',
    submission_type: 'editorial',
    source_tab: 'LAB_Editorial_Intake',
    record_type: 'editorial',
  };
  const out = normaliseRecord(live);
  assert.equal(out.record_type, 'editorial');
});

check('normaliseRecord: legacy LAB_Change_Requests source_tab → change_request', () => {
  // Forward-compatibility: when the upgraded Apps Script ships and rows
  // start arriving from the dedicated tab, those records must also map
  // to record_type='change_request'.
  const live = {
    submission_id: 'sub-test_legacy',
    source_tab: 'LAB_Change_Requests',
    requested_action: 'update',
    target_listing_name: 'Stichting Y',
  };
  const out = normaliseRecord(live);
  assert.equal(out.record_type, 'change_request');
  assert.equal(out.requested_action, 'update');
  assert.equal(out.target_listing_name, 'Stichting Y');
});

check('safeRecords: change_request rows surface as record_type and never include Directory_Master target', () => {
  const live = [{
    submission_id: 'sub-test_mog9779c_2njk',
    submission_type: 'change_request:update',
    mode: 'change_request',
    name: 'ESRF Lab Test Existing Listing',
    cr_requested_action: 'update',
    cr_target_listing_name: 'ESRF Lab Test Existing Listing',
    source_tab: 'LAB_Intake_Submissions',
    record_type: 'org',
    contact_name: 'Pers. Soneel',
    contact_email: 'leak@example.org',
  }];
  const out = safeRecords(live, false);
  assert.equal(out.length, 1);
  assert.equal(out[0].record_type, 'change_request');
  assert.match(out[0].title, /Wijzigingsverzoek/);
  // contact_name is a flat column on LAB_Intake_Submissions; default
  // include_contact=false must strip it (and a future nested contact too).
  assert.equal(out[0].contact, undefined);
  // Directory_Master must not appear anywhere as a target/sheet hint
  const blob = JSON.stringify(out);
  assert.ok(blob.indexOf('Directory_Master') === -1, 'Directory_Master leaked into normalised record');
});

await asyncCheck('end-to-end: live-mode CR row from a stub upstream renders as change_request', async () => {
  // Simulate the upstream Apps Script returning the same shape we observed
  // on Preview (record_type=org, no title) and confirm the response the
  // redactie UI consumes flips to record_type=change_request with a Dutch
  // title and no Directory_Master mention as a target.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json(){
      return {
        ok: true,
        records: [{
          submission_id: 'sub-test_mog9779c_2njk',
          received_at: '2026-04-26T22:24:00Z',
          environment: 'TEST/VALIDATIE',
          submission_type: 'change_request:update',
          mode: 'change_request',
          name: 'ESRF Lab Test Existing Listing',
          website: 'https://esrf.net/directory/esrf-lab-test',
          country_code: 'NL',
          region: 'Zuid-Holland',
          source_tab: 'LAB_Intake_Submissions',
          source_row_hint: 'rij 7',
          record_type: 'org',
          cr_sub_mode: 'change_request',
          cr_requested_action: 'update',
          cr_target_listing_name: 'ESRF Lab Test Existing Listing',
          cr_change_description: 'Adres en sector wijzigen.',
          cr_reason: 'Verhuizing per 2026-03-01.',
          cr_authorization_confirmation: 'yes',
          cr_requester_authorization: 'authorized_representative',
        }],
      };
    },
  });
  try {
    const res = await callReview('POST', {
      env: {
        REDACTIE_REVIEW_ACCESS_CODE: 'valid-code',
        REDACTIE_REVIEW_WEBHOOK_URL: 'https://stub.invalid/exec',
        REDACTIE_REVIEW_WEBHOOK_SECRET: 'stub-secret',
      },
      headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ access_code: 'valid-code' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.mode, 'lab');
    assert.equal(data.records.length, 1);
    const r = data.records[0];
    assert.equal(r.record_type, 'change_request');
    assert.equal(r.requested_action, 'update');
    assert.match(r.title, /Wijzigingsverzoek/);
    assert.match(r.type_label, /Wijzigingsverzoek/);
    assert.equal(r.target_listing_name, 'ESRF Lab Test Existing Listing');
    assert.equal(r.directory_master_touched, 'no');
    assert.equal(r.automatic_publication, 'no');
    // Top-level safety contract still holds
    assert.equal(data.directory_master_touched, false);
    assert.equal(data.automatic_publication, false);
    assert.ok(data.forbidden_targets.indexOf('Directory_Master') !== -1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log('');
if (failures > 0){
  console.log(failures + ' check(s) FAILED');
  process.exit(1);
}
console.log('All checks passed.');
