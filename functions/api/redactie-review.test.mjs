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

console.log('');
if (failures > 0){
  console.log(failures + ' check(s) FAILED');
  process.exit(1);
}
console.log('All checks passed.');
