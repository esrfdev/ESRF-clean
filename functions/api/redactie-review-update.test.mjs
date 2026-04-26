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

await asyncCheck('valid body without access code → 200, mode:sample, dry_run:true, live_write_ready:false', async () => {
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

await asyncCheck('valid access code yields mode:lab but live_write_ready remains false', async () => {
  const res = await callUpdate('POST', {
    env: {
      REDACTIE_REVIEW_ACCESS_CODE: 'lab-code',
      REDACTIE_REVIEW_WEBHOOK_URL: 'https://script.example/exec',
      REDACTIE_REVIEW_WEBHOOK_SECRET: 'shh',
      REDACTIE_REVIEW_WRITE_ENABLED: 'true',
    },
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(Object.assign({}, validUpdateBody, { access_code: 'lab-code' })),
  });
  const data = await res.json();
  assert.equal(data.mode, 'lab');
  // EVEN with all env vars set, live writes remain disabled on this branch.
  assert.equal(data.dry_run, true);
  assert.equal(data.live_write_ready, false);
  assert.match(data.live_write_blocked_reason, /not implemented|disabled/i);
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
