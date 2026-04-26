// Self-contained test for functions/api/redactie-review-update.js
//
// Run with:   node functions/api/redactie-review-update.test.mjs
//
// Verifies:
//   - Production environment short-circuits to 404 (preview-only).
//   - Origin allowlist enforced.
//   - target_tab must be a documented LAB_* tab.
//   - Directory_Master is refused as target.
//   - Process step / review status are validated against documented sets.
//   - Contact details and forbidden keys are stripped from any payload.
//   - dry_run is always true and live_write_ready is always false on this branch.
//   - Status step reminders are injected per process step.
//   - Without a configured access code, the response is dry-run sample.
//   - With a valid access code, the response is dry-run lab.

import assert from 'node:assert/strict';

await import('./intake.js');
await import('./redactie-review.js');
await import('./redactie-review-update.js');
const api = globalThis.__esrfRedactieReviewUpdateApi;
assert.ok(api, 'redactie-review-update.js did not expose test hooks on globalThis');

const {
  onRequest,
  ALLOWED_REVIEW_TARGET_TABS,
  ALLOWED_PROCESS_STEPS,
  ALLOWED_REVIEW_STATUSES,
  ALLOWED_RECORD_TYPES,
  ALLOWED_REDACTIE_DECISIONS,
  isLabTab,
  buildReviewUpdatePayload,
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

function callUpdate(method, opts){
  opts = opts || {};
  const headers = new Map(Object.entries(opts.headers || {}));
  const request = {
    method,
    url: PREVIEW_ORIGIN + '/api/redactie-review-update',
    headers: { get(k){ return headers.get(String(k).toLowerCase()) || headers.get(k) || null; } },
    text: async () => opts.body || '',
    cf: {},
  };
  const env = opts.envReplace
    ? (opts.env || {})
    : Object.assign({ CF_PAGES_BRANCH: 'test/regional-editorial-contributor-intake' }, opts.env || {});
  return onRequest({ request, env });
}

const validUpdateBody = {
  submission_id: 'sub_lab_demo_001',
  record_type: 'org',
  target_tab: 'LAB_Intake_Submissions',
  review_update: {
    process_step: 'in_review',
    review_status: 'in_review',
    reminder: 'Controleer regio',
    next_required_action: 'Controleer dubbel',
    assigned_to: 'redactie',
    due_date: '2026-05-03',
    review_notes_internal: 'Eerste pass.'
  },
  edited_publication_proposal: {
    edited_title: 'Aangepaste titel',
    edited_summary: 'Korte samenvatting voor publicatie.',
    change_note: 'Titel verkort.',
    edited_by: 'AB'
  },
  original_reference: {
    submission_id: 'sub_lab_demo_001',
    title: 'Originele titel',
    summary: 'Originele samenvatting.',
    source_tab: 'LAB_Intake_Submissions'
  },
  changed_fields: ['edited_title']
};

// ── Pure helper checks ───────────────────────────────────────────────────

check('ALLOWED_REVIEW_TARGET_TABS only contains LAB_* tabs', () => {
  for (const t of ALLOWED_REVIEW_TARGET_TABS){
    assert.ok(/^LAB_/.test(t), 'tab is not LAB_*: ' + t);
  }
  assert.ok(ALLOWED_REVIEW_TARGET_TABS.indexOf('Directory_Master') === -1);
});

check('isLabTab rejects Directory_Master', () => {
  assert.equal(isLabTab('Directory_Master'), false);
  assert.equal(isLabTab('LAB_Intake_Submissions'), true);
  assert.equal(isLabTab('LAB_Workflow_Events'), true);
  assert.equal(isLabTab('LAB_Backend_Log'), false); // not in review-target allowlist
  assert.equal(isLabTab(''), false);
  assert.equal(isLabTab(null), false);
});

check('ALLOWED_PROCESS_STEPS includes the canonical seven', () => {
  for (const k of ['binnengekomen','in_review','wachten_op_indiener','klaar_voor_akkoord','akkoord_voor_promote','afgewezen','gearchiveerd']){
    assert.ok(ALLOWED_PROCESS_STEPS.indexOf(k) !== -1, 'missing process step: ' + k);
  }
});

check('ALLOWED_REVIEW_STATUSES includes approved_lab_promote', () => {
  assert.ok(ALLOWED_REVIEW_STATUSES.indexOf('approved_lab_promote') !== -1);
});

check('buildReviewUpdatePayload: valid body produces no errors and strips contact', () => {
  const dirty = Object.assign({}, validUpdateBody, {
    edited_publication_proposal: Object.assign({}, validUpdateBody.edited_publication_proposal, {
      contact: { email: 'leak@example.org' },
      raw_payload_json: '{...}'
    })
  });
  const { errors, payload } = buildReviewUpdatePayload(dirty);
  assert.deepEqual(errors, []);
  assert.equal(payload.contact_disclosed, false);
  assert.equal(payload.directory_master_touched, false);
  assert.equal(payload.automatic_publication, false);
  // Defence in depth: serialise and ensure no leaked email or raw payload
  const blob = JSON.stringify(payload);
  assert.ok(blob.indexOf('leak@example.org') === -1, 'email leaked through edited_publication_proposal');
  assert.ok(blob.indexOf('raw_payload_json') === -1, 'raw_payload_json leaked');
});

check('buildReviewUpdatePayload: Directory_Master target produces error', () => {
  const bad = Object.assign({}, validUpdateBody, { target_tab: 'Directory_Master' });
  const { errors } = buildReviewUpdatePayload(bad);
  assert.ok(errors.length >= 1);
  assert.ok(errors.some(e => /target_tab/.test(e)));
});

check('buildReviewUpdatePayload: unknown process step produces error', () => {
  const bad = Object.assign({}, validUpdateBody, {
    review_update: Object.assign({}, validUpdateBody.review_update, { process_step: 'directly_to_production' })
  });
  const { errors } = buildReviewUpdatePayload(bad);
  assert.ok(errors.some(e => /process_step/.test(e)));
});

check('buildReviewUpdatePayload: missing submission_id and record_type produce errors', () => {
  const bad = Object.assign({}, validUpdateBody, { submission_id: '', record_type: 'something_else' });
  const { errors } = buildReviewUpdatePayload(bad);
  assert.ok(errors.some(e => /submission_id required/.test(e)));
  assert.ok(errors.some(e => /record_type/.test(e)));
});

check('buildReviewUpdatePayload: process_step_reminder is injected from STATUS_STEP_REMINDERS', () => {
  const { payload } = buildReviewUpdatePayload(validUpdateBody);
  assert.ok(typeof payload.process_step_reminder === 'string' && payload.process_step_reminder.length > 0);
});

// ── Change-request / hide_delete record_type acceptance ──────────────────

check('ALLOWED_RECORD_TYPES includes org, editorial, change_request and hide_delete', () => {
  assert.ok(ALLOWED_RECORD_TYPES.indexOf('org') !== -1);
  assert.ok(ALLOWED_RECORD_TYPES.indexOf('editorial') !== -1);
  assert.ok(ALLOWED_RECORD_TYPES.indexOf('change_request') !== -1);
  assert.ok(ALLOWED_RECORD_TYPES.indexOf('hide_delete') !== -1);
});

const changeRequestUpdateBody = {
  submission_id: 'sub_lab_demo_005',
  record_type: 'change_request',
  target_tab: 'LAB_Redactie_Reviews',
  source_tab: 'LAB_Change_Requests',
  review_update: {
    process_step: 'in_review',
    review_status: 'in_review',
    reminder: 'Verifieer adres en sector',
    next_required_action: 'Verifieer bevoegdheid + bron',
    assigned_to: 'redactie',
    due_date: '2026-05-04',
    review_notes_internal: 'Pass 1: bron lijkt te kloppen.'
  },
  change_request_review: {
    redactie_decision: 'approve',
    redactie_decision_reason: 'Persbericht verifieert verhuizing en sector-shift.',
    requested_action: 'update',
    sub_mode: 'change_request',
    target_listing_name: 'Stichting Voorbeeld Noord',
    target_listing_url: 'https://esrf.net/directory/voorbeeld-noord',
    change_description: 'Adres en sector kloppen niet meer.',
    change_description_existing: 'Stichting Voorbeeld Noord — sector: Beveiliging — locatie: Drenthe',
    change_description_requested: 'Stichting Voorbeeld Noord — sector: Crisisbeheersing — locatie: Groningen',
    reason: 'Organisatie is verhuisd en kerntaken zijn formeel verschoven.',
    evidence_url: 'https://example.org/persbericht-verhuizing',
    requester_authorization: 'authorized_representative',
    authorization_confirmation: 'yes'
  }
};

check('buildReviewUpdatePayload: change_request body produces no errors and preserves CR fields', () => {
  const { errors, payload } = buildReviewUpdatePayload(changeRequestUpdateBody);
  assert.deepEqual(errors, []);
  assert.equal(payload.record_type, 'change_request');
  assert.ok(payload.change_request_review, 'change_request_review block missing on payload');
  assert.equal(payload.change_request_review.redactie_decision, 'approve');
  assert.equal(payload.change_request_review.requested_action, 'update');
  assert.equal(payload.change_request_review.sub_mode, 'change_request');
  assert.equal(payload.change_request_review.target_listing_name, 'Stichting Voorbeeld Noord');
  assert.equal(payload.change_request_review.requester_authorization, 'authorized_representative');
  assert.equal(payload.change_request_review.authorization_confirmation, 'yes');
  assert.equal(payload.directory_master_touched, false);
  assert.equal(payload.automatic_publication, false);
});

check('buildReviewUpdatePayload: hide_delete record_type accepted; CR block flagged sub_mode hide_delete', () => {
  const body = Object.assign({}, changeRequestUpdateBody, {
    submission_id: 'sub_lab_demo_006',
    record_type: 'hide_delete',
    change_request_review: Object.assign({}, changeRequestUpdateBody.change_request_review, {
      requested_action: 'delete',
      sub_mode: 'hide_delete',
      target_listing_name: 'Voorbeeld Coöperatie Oost',
      target_listing_url: '',
      reason: 'Organisatie bestaat niet meer.',
    }),
  });
  const { errors, payload } = buildReviewUpdatePayload(body);
  assert.deepEqual(errors, []);
  assert.equal(payload.record_type, 'hide_delete');
  assert.equal(payload.change_request_review.requested_action, 'delete');
  assert.equal(payload.change_request_review.sub_mode, 'hide_delete');
  // hide_delete record_type with no explicit sub_mode still defaults sensibly.
  const bodyNoSubMode = Object.assign({}, body, {
    change_request_review: Object.assign({}, body.change_request_review, { sub_mode: '' }),
  });
  const { payload: p2 } = buildReviewUpdatePayload(bodyNoSubMode);
  assert.equal(p2.change_request_review.sub_mode, 'hide_delete');
});

check('buildReviewUpdatePayload: change_request rejects unknown redactie_decision', () => {
  const bad = Object.assign({}, changeRequestUpdateBody, {
    change_request_review: Object.assign({}, changeRequestUpdateBody.change_request_review, {
      redactie_decision: 'publish_now',
    }),
  });
  const { errors } = buildReviewUpdatePayload(bad);
  assert.ok(errors.some(e => /redactie_decision/.test(e)), 'expected redactie_decision validation error');
});

check('buildReviewUpdatePayload: change_request strips contact PII from change_request_review', () => {
  const dirty = Object.assign({}, changeRequestUpdateBody, {
    change_request_review: Object.assign({}, changeRequestUpdateBody.change_request_review, {
      contact: { email: 'leak-cr@example.org', phone: '+31 6 9999' },
      raw_payload_json: '{"foo":1}',
    }),
  });
  const { errors, payload } = buildReviewUpdatePayload(dirty);
  assert.deepEqual(errors, []);
  const blob = JSON.stringify(payload);
  assert.ok(blob.indexOf('leak-cr@example.org') === -1, 'CR contact email leaked');
  assert.ok(blob.indexOf('raw_payload_json') === -1, 'CR raw_payload_json leaked');
});

check('buildReviewUpdatePayload: org/editorial bodies do not get a change_request_review block', () => {
  const { payload: orgPayload } = buildReviewUpdatePayload(validUpdateBody);
  assert.equal(orgPayload.change_request_review, undefined,
    'org record_type should not produce a change_request_review block');
  const editorialBody = Object.assign({}, validUpdateBody, { record_type: 'editorial' });
  const { payload: edPayload } = buildReviewUpdatePayload(editorialBody);
  assert.equal(edPayload.change_request_review, undefined,
    'editorial record_type should not produce a change_request_review block');
});

// ── End-to-end via onRequest ─────────────────────────────────────────────

await asyncCheck('production env returns 404', async () => {
  const res = await callUpdate('POST', {
    envReplace: true,
    env: { CF_PAGES_BRANCH: 'main' },
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(validUpdateBody),
  });
  assert.equal(res.status, 404);
});

await asyncCheck('forbidden origin returns 403', async () => {
  const res = await callUpdate('POST', {
    headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
    body: JSON.stringify(validUpdateBody),
  });
  assert.equal(res.status, 403);
});

await asyncCheck('valid body without access code → 200, mode:sample, dry_run:true, save_status:not_saved with explicit save_message', async () => {
  const res = await callUpdate('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(validUpdateBody),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.mode, 'sample');
  assert.equal(data.dry_run, true);
  assert.equal(data.live_write_ready, false);
  assert.equal(data.save_status, 'not_saved');
  // Exact Dutch copy required by the user spec.
  assert.equal(data.save_message, 'Opslaan is nog niet actief; er wordt niets opgeslagen.');
  // The reason should explain WHY (which env var is missing). On this
  // call, no access code is configured.
  assert.match(data.live_write_blocked_reason, /access code not configured/i);
  // Activation hint must list all four required env vars so ops knows
  // exactly what to set.
  assert.ok(Array.isArray(data.activation_required) && data.activation_required.length >= 4);
  assert.ok(data.activation_required.some(s => /REDACTIE_REVIEW_WRITE_ENABLED/.test(s)));
  assert.equal(data.directory_master_touched, false);
  assert.equal(data.automatic_publication, false);
  assert.match(data.warning, /Directory_Master/);
  // would_write summary is sanitised
  assert.equal(data.would_write.target_tab, 'LAB_Intake_Submissions');
});

await asyncCheck('Directory_Master as target_tab → 400', async () => {
  const res = await callUpdate('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(Object.assign({}, validUpdateBody, { target_tab: 'Directory_Master' })),
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.ok(data.errors.some(e => /target_tab/.test(e)));
});

await asyncCheck('access code valid but REDACTIE_REVIEW_WRITE_ENABLED missing → save_status:not_saved with reason', async () => {
  // Three of four gates pass; the toggle env var is missing — endpoint
  // must stay dry-run and tell ops which var is missing.
  const res = await callUpdate('POST', {
    env: {
      REDACTIE_REVIEW_ACCESS_CODE: 'lab-code',
      REDACTIE_REVIEW_WEBHOOK_URL: 'https://script.example/exec',
      REDACTIE_REVIEW_WEBHOOK_SECRET: 'shh',
      // REDACTIE_REVIEW_WRITE_ENABLED intentionally NOT set
    },
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(Object.assign({}, validUpdateBody, { access_code: 'lab-code' })),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.mode, 'lab');
  assert.equal(data.dry_run, true);
  assert.equal(data.live_write_ready, false);
  assert.equal(data.save_status, 'not_saved');
  assert.equal(data.save_message, 'Opslaan is nog niet actief; er wordt niets opgeslagen.');
  assert.match(data.live_write_blocked_reason, /REDACTIE_REVIEW_WRITE_ENABLED/);
});

// ── Live-save path with mocked Apps Script fetch ───────────────────────
// Each of the next checks installs a fetch mock that intercepts the call
// to the (fake) Apps Script /exec URL, asserts the outbound body shape,
// and returns a canned response. We restore globalThis.fetch after each
// check so the network never actually runs.
async function withMockedFetch(impl, fn){
  const originalFetch = globalThis.fetch;
  let calls = [];
  globalThis.fetch = async function(url, options){
    calls.push({ url: String(url), options: options || {} });
    return await impl(url, options);
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const labEnv = {
  REDACTIE_REVIEW_ACCESS_CODE: 'lab-code',
  REDACTIE_REVIEW_WEBHOOK_URL: 'https://script.example/exec',
  REDACTIE_REVIEW_WEBHOOK_SECRET: 'shh-secret',
  REDACTIE_REVIEW_WRITE_ENABLED: 'true',
};

await asyncCheck('all four gates pass + Apps Script accepts → save_status:saved with saved_to', async () => {
  const fakeUpstream = {
    ok: true,
    update_result: {
      review_id: 'rev_lab_test_001',
      target_tab: 'LAB_Redactie_Reviews',
      rows_written: 2,
    },
  };
  await withMockedFetch(async function(_url, _opts){
    return new Response(JSON.stringify(fakeUpstream), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }, async function(calls){
    const res = await callUpdate('POST', {
      env: labEnv,
      headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({}, validUpdateBody, { access_code: 'lab-code' })),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.mode, 'lab');
    assert.equal(data.dry_run, false);
    assert.equal(data.live_write_ready, true);
    assert.equal(data.save_status, 'saved');
    // Exact Dutch save message required by spec.
    assert.match(data.save_message, /Opgeslagen in LAB_Redactie_Reviews/);
    assert.match(data.save_message, /LAB_Workflow_Events/);
    assert.match(data.save_message, /Originele inzending ongewijzigd/);
    assert.match(data.save_message, /Directory_Master ongewijzigd/);
    assert.equal(data.saved_to.review_tab, 'LAB_Redactie_Reviews');
    assert.equal(data.saved_to.events_tab, 'LAB_Workflow_Events');
    assert.equal(data.saved_to.review_id, 'rev_lab_test_001');
    // Outbound webhook call assertions
    assert.equal(calls.length, 1, 'expected exactly one fetch call');
    assert.equal(calls[0].url, 'https://script.example/exec');
    const sent = JSON.parse(String(calls[0].options.body || '{}'));
    assert.equal(sent.action, 'submit_review_update');
    assert.equal(sent.shared_secret, 'shh-secret');
    assert.equal(sent.target_tab, 'LAB_Redactie_Reviews');
    assert.equal(sent.include_contact, false, 'include_contact must be hard-coded false on save path');
  });
});

await asyncCheck('change_request save: 200 saved + outbound body carries change_request_review block', async () => {
  const fakeUpstream = {
    ok: true,
    update_result: { review_id: 'rev_cr_001', target_tab: 'LAB_Redactie_Reviews', rows_written: 2 },
  };
  await withMockedFetch(async function(){
    return new Response(JSON.stringify(fakeUpstream), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }, async function(calls){
    const res = await callUpdate('POST', {
      env: labEnv,
      headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({}, changeRequestUpdateBody, { access_code: 'lab-code' })),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.save_status, 'saved');
    assert.equal(calls.length, 1);
    const sent = JSON.parse(String(calls[0].options.body || '{}'));
    assert.equal(sent.record_type, 'change_request');
    assert.equal(sent.target_tab, 'LAB_Redactie_Reviews');
    assert.ok(sent.change_request_review, 'change_request_review missing on outbound webhook body');
    assert.equal(sent.change_request_review.redactie_decision, 'approve');
    assert.equal(sent.change_request_review.requested_action, 'update');
    assert.equal(sent.change_request_review.target_listing_name, 'Stichting Voorbeeld Noord');
    // Defence in depth: never publishes, never touches Directory_Master.
    assert.equal(data.directory_master_touched, false);
    assert.equal(data.automatic_publication, false);
  });
});

await asyncCheck('hide_delete save: 200 saved + outbound body carries hide_delete sub_mode and delete action', async () => {
  await withMockedFetch(async function(){
    return new Response(JSON.stringify({ ok: true, update_result: { review_id: 'rev_cr_002' } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }, async function(calls){
    const hideDeleteBody = Object.assign({}, changeRequestUpdateBody, {
      access_code: 'lab-code',
      submission_id: 'sub_lab_demo_006',
      record_type: 'hide_delete',
      change_request_review: Object.assign({}, changeRequestUpdateBody.change_request_review, {
        requested_action: 'delete',
        sub_mode: 'hide_delete',
        target_listing_name: 'Voorbeeld Coöperatie Oost',
      }),
    });
    const res = await callUpdate('POST', {
      env: labEnv,
      headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify(hideDeleteBody),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.save_status, 'saved');
    const sent = JSON.parse(String(calls[0].options.body || '{}'));
    assert.equal(sent.record_type, 'hide_delete');
    assert.equal(sent.change_request_review.sub_mode, 'hide_delete');
    assert.equal(sent.change_request_review.requested_action, 'delete');
  });
});

await asyncCheck('outbound webhook body never contains contact PII or REDACTIE_REVIEW_* secrets', async () => {
  const SENSITIVE = 'leak-on-save@example.org';
  await withMockedFetch(async function(){
    return new Response(JSON.stringify({ ok: true, update_result: { review_id: 'rev_x' } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }, async function(calls){
    await callUpdate('POST', {
      env: labEnv,
      headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({}, validUpdateBody, {
        access_code: 'lab-code',
        edited_publication_proposal: Object.assign({}, validUpdateBody.edited_publication_proposal, {
          contact: { email: SENSITIVE, phone: '+31 6 11111111' },
          raw_payload_json: '{"foo":"bar"}',
        }),
        original_reference: Object.assign({}, validUpdateBody.original_reference, {
          contact: { email: SENSITIVE },
        }),
      })),
    });
    const sentRaw = String(calls[0].options.body || '');
    assert.ok(sentRaw.indexOf(SENSITIVE) === -1, 'contact email leaked into outbound webhook body');
    assert.ok(sentRaw.indexOf('raw_payload_json') === -1, 'raw_payload_json leaked into outbound webhook body');
    // Defence-in-depth: never echo the env var names that hold secrets.
    assert.ok(sentRaw.indexOf('REDACTIE_REVIEW_ACCESS_CODE') === -1);
    assert.ok(sentRaw.indexOf('REDACTIE_REVIEW_WEBHOOK_URL') === -1);
    // The shared_secret IS sent — that is the auth surface — but ONLY
    // as the body field, not as a leaked env-var name in any other place.
  });
});

await asyncCheck('Directory_Master as target_tab is refused before any fetch', async () => {
  let fetched = false;
  await withMockedFetch(async function(){
    fetched = true;
    return new Response('{}', { status: 200 });
  }, async function(){
    const res = await callUpdate('POST', {
      env: labEnv,
      headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({}, validUpdateBody, {
        access_code: 'lab-code',
        target_tab: 'Directory_Master',
      })),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.errors && data.errors.some(e => /target_tab/.test(e)));
    assert.equal(fetched, false, 'fetch must NEVER be called when target_tab is Directory_Master');
  });
});

await asyncCheck('upstream Apps Script error → 502 with save_status:failed', async () => {
  await withMockedFetch(async function(){
    return new Response('upstream blew up', { status: 500 });
  }, async function(){
    const res = await callUpdate('POST', {
      env: labEnv,
      headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({}, validUpdateBody, { access_code: 'lab-code' })),
    });
    assert.equal(res.status, 502);
    const data = await res.json();
    assert.equal(data.ok, false);
    assert.equal(data.save_status, 'failed');
    assert.match(data.save_message, /Opslaan in LAB-tabbladen is mislukt/);
    assert.match(String(data.upstream_error || ''), /upstream_status_500/);
  });
});

await asyncCheck('upstream returns ok:false → 502 with save_status:failed and no leakage', async () => {
  const SENSITIVE_RESP_KEY = 'shared_secret';
  await withMockedFetch(async function(){
    return new Response(JSON.stringify({
      ok: false,
      reason: 'forbidden_target',
      // Defensive fixture: Apps Script accidentally echoes a forbidden key.
      shared_secret: 'should-be-stripped',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, async function(){
    const res = await callUpdate('POST', {
      env: labEnv,
      headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({}, validUpdateBody, { access_code: 'lab-code' })),
    });
    assert.equal(res.status, 502);
    const blob = await res.text();
    assert.ok(blob.indexOf('should-be-stripped') === -1, 'shared_secret value leaked from upstream into response');
    assert.ok(blob.indexOf(SENSITIVE_RESP_KEY) === -1, 'shared_secret key leaked from upstream into response');
  });
});

await asyncCheck('contact details in edited_publication_proposal are stripped from response payload', async () => {
  const SENSITIVE = 'leak@example.org';
  const res = await callUpdate('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(Object.assign({}, validUpdateBody, {
      edited_publication_proposal: Object.assign({}, validUpdateBody.edited_publication_proposal, {
        contact: { email: SENSITIVE, phone: '+31 6 12345678' },
        raw_payload_json: '{}',
      }),
      original_reference: Object.assign({}, validUpdateBody.original_reference, {
        contact: { email: SENSITIVE },
      }),
    })),
  });
  const blob = await res.text();
  assert.ok(blob.indexOf(SENSITIVE) === -1, 'email leaked into update response');
  assert.ok(blob.indexOf('raw_payload_json') === -1, 'raw_payload_json leaked into update response');
});

await asyncCheck('non-JSON content type returns 415', async () => {
  const res = await callUpdate('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'text/plain' },
    body: 'foo',
  });
  assert.equal(res.status, 415);
});

await asyncCheck('GET method returns 405', async () => {
  const res = await callUpdate('GET', { headers: { origin: PREVIEW_ORIGIN } });
  assert.equal(res.status, 405);
});

console.log('');
if (failures > 0){
  console.log(failures + ' check(s) FAILED');
  process.exit(1);
}
console.log('All checks passed.');
