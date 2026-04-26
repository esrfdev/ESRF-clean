// Self-contained test for functions/api/intake.js
//
// Run with:   node functions/api/intake.test.mjs
//
// Exits 0 on success, 1 on any failure. No external dependencies.
// Tests the validation, sanitisation, issue-preview, lab-row builders,
// notification minimal-payload contract, and Directory_Master safety net
// of the /api/intake handler in isolation.

import assert from 'node:assert/strict';

await import('./intake.js');
const api = globalThis.__esrfIntake;
assert.ok(api, 'intake.js did not expose test hooks on globalThis');

const {
  validateAndSanitize,
  buildIssuePreview,
  buildSheetRow,
  buildIntakeSubmissionRow,
  buildEditorialIntakeRow,
  buildPlaceCandidateRow,
  buildBackendLogRow,
  buildWorkflowEventRow,
  buildNotificationMessage,
  needsPlaceCandidateRow,
  nextRequiredAction,
  LAB_SPREADSHEET,
  OFFICE_IDENTITY,
  FORBIDDEN_NOTIFY_KEYS,
  assertLabPayloadSafe,
  assertNotificationSafe,
  onRequest,
  sanitize,
  sanitizeLong,
  sanitizeUrl,
  sanitizeNotifyRecipient,
  isAllowedOrigin,
  mdEscapeInline,
} = api;

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
  assert.equal(sanitize('a"b<c>d'), 'abd');
  assert.equal(sanitize('a"b<c d'), 'abc d');
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
  assert.equal(isAllowedOrigin('http://www.esrf.net'), false);
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

function payloadOf(input) {
  const r = validateAndSanitize(input);
  assert.ok(!r.error, r.error);
  // Simulate the request handler attaching submission_id.
  r.payload.meta.submission_id = 'sub_test_0001';
  r.payload.meta.request_id = 'req_test_0001';
  return r.payload;
}

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

// ─── back-compat sheet row helper ────────────────────────────────────────
check('buildSheetRow (legacy alias) still produces a flat row with refs', () => {
  const payload = validateAndSanitize({
    intake_mode: 'both',
    contact: goodContact,
    organisation_listing: goodOrg,
    editorial_contribution: goodEd,
    privacy: goodPrivacy,
  }).payload;
  const row = buildSheetRow(payload, { issue_url: 'https://github.com/x/y/issues/12', issue_number: 12 });
  assert.equal(row.mode, 'both');
  assert.equal(row.name, 'Acme Veiligheid');
  assert.equal(row.country_code, 'NL');
  assert.equal(row.contact_email, 'anna@example.org');
  assert.equal(row.issue_url, 'https://github.com/x/y/issues/12');
  assert.equal(row.review_status, 'new');
  // Sheet row is the SSoT register; it must NOT inline editorial body.
  assert.ok(!('editorial_summary' in row));
  assert.ok(!JSON.stringify(row).includes('Joint dispatch beats parallel dispatch'));
});

// ─── LAB_Intake_Submissions row matches headers exactly ──────────────────
const LAB_INTAKE_HEADERS = [
  'submission_id','received_at','environment','submission_type','mode','org_id_match','name','website',
  'country_code','country_name_local','region','city_raw','city_match_status','sector_raw','description_en',
  'contact_name','contact_email','contact_role','consent_publish','source_url','notes_submitter',
  'review_status','next_required_action','assigned_to','due_date','linked_editorial_id',
  'notification_status','notification_last_sent_at','created_by_flow','raw_payload_json','review_notes_internal',
];
check('buildIntakeSubmissionRow contains every documented LAB_Intake_Submissions header', () => {
  const payload = payloadOf({
    intake_mode: 'both',
    contact: goodContact,
    organisation_listing: goodOrg,
    editorial_contribution: goodEd,
    privacy: goodPrivacy,
  });
  const row = buildIntakeSubmissionRow(payload, { issue_url: 'https://example/issues/1', issue_number: 1 });
  for (const h of LAB_INTAKE_HEADERS) {
    assert.ok(Object.prototype.hasOwnProperty.call(row, h), 'missing header ' + h);
  }
  assert.equal(row.mode, 'both');
  assert.equal(row.submission_type, 'org+editorial');
  assert.equal(row.review_status, 'new');
  assert.equal(row.country_code, 'NL');
  // Editorial body MUST NOT live in the intake submissions row.
  assert.ok(!JSON.stringify(row).includes('Joint dispatch beats parallel dispatch'));
});

// ─── Editorial-only route writes editorial row, no listing fields ───────
check('editorial-only route produces editorial row and submission_type=editorial', () => {
  const payload = payloadOf({
    intake_mode: 'editorial',
    contact: goodContact,
    editorial_contribution: goodEd,
    privacy: goodPrivacy,
  });
  const intake = buildIntakeSubmissionRow(payload, {});
  assert.equal(intake.submission_type, 'editorial');
  assert.equal(intake.sector_raw, '');
  const editorial = buildEditorialIntakeRow(payload, {});
  assert.ok(editorial.editorial_id.startsWith('ed_'));
  assert.equal(editorial.organization_name, 'Acme Veiligheid');
  assert.equal(editorial.title, 'Lessons in regional cooperation');
  assert.equal(editorial.editorial_status, 'received');
  assert.equal(editorial.consent_publish, 'yes');
  assert.equal(editorial.submission_id, payload.meta.submission_id);
});

// ─── Combined route writes both ──────────────────────────────────────────
check('combined route emits both intake row and editorial row', () => {
  const payload = payloadOf({
    intake_mode: 'both',
    contact: goodContact,
    organisation_listing: goodOrg,
    editorial_contribution: goodEd,
    privacy: goodPrivacy,
  });
  const intake = buildIntakeSubmissionRow(payload, {});
  const editorial = buildEditorialIntakeRow(payload, {});
  assert.equal(intake.submission_type, 'org+editorial');
  assert.equal(intake.sector_raw, 'Overheid');
  assert.equal(editorial.title, goodEd.topic);
});

// ─── Unknown place candidate route ───────────────────────────────────────
check('unknown place triggers a LAB_Place_Candidates row', () => {
  const payload = payloadOf({
    intake_mode: 'org',
    contact: {
      ...goodContact,
      place: 'Klein Dorpje',
      place_known: false,
      place_addition_requested: true,
      place_addition_candidate: 'Klein Dorpje',
      place_addition_country: 'NL',
      place_addition_region: 'Friesland',
    },
    organisation_listing: goodOrg,
    privacy: goodPrivacy,
  });
  assert.equal(needsPlaceCandidateRow(payload), true);
  const row = buildPlaceCandidateRow(payload);
  assert.ok(row.candidate_id.startsWith('place_'));
  assert.equal(row.city_raw, 'Klein Dorpje');
  assert.equal(row.country_code, 'NL');
  assert.equal(row.region, 'Friesland');
  assert.equal(row.review_status, 'new');
});

check('known place does NOT trigger a place candidate row', () => {
  const payload = payloadOf({
    intake_mode: 'org',
    contact: { ...goodContact, place_known: true, place_addition_requested: false },
    organisation_listing: goodOrg,
    privacy: goodPrivacy,
  });
  assert.equal(needsPlaceCandidateRow(payload), false);
});

// ─── Notification: minimal, no PII, no editorial body ───────────────────
check('notification message excludes PII and editorial body', () => {
  const payload = payloadOf({
    intake_mode: 'both',
    contact: goodContact,
    organisation_listing: goodOrg,
    editorial_contribution: goodEd,
    privacy: goodPrivacy,
  });
  const msg = buildNotificationMessage(payload, {
    submission_id: payload.meta.submission_id,
    request_id: payload.meta.request_id,
    workflow_status: 'dry_run',
    next_required_action: 'something',
    related_sheet: 'LAB_Intake_Submissions',
  });
  const text = JSON.stringify(msg);
  // PII MUST NOT leak.
  assert.ok(!text.includes('anna@example.org'), 'email leaked');
  assert.ok(!text.includes('+31 6 12345678'), 'phone leaked');
  assert.ok(!text.includes('Anna Jansen'), 'name leaked');
  // Editorial body MUST NOT leak.
  assert.ok(!text.includes('Joint dispatch beats parallel dispatch'), 'lesson body leaked');
  assert.ok(!text.includes('Why Zuid-Holland responded faster'), 'angle body leaked');
  assert.ok(!text.includes('A short summary of the contribution'), 'summary leaked');
  // Required minimal fields present.
  assert.equal(msg.org_name, 'Acme Veiligheid');
  assert.equal(msg.country, 'NL');
  assert.equal(msg.region, 'Zuid-Holland');
  assert.equal(msg.workflow_status, 'dry_run');
  assert.equal(msg.related_sheet, 'LAB_Intake_Submissions');
  assert.equal(msg.type, 'org+editorial');
  // Channel is the ESRF mailnotificatie / mailrelay-webhook — never
  // a Gmail-specific integration.
  assert.equal(msg.notification_channel, 'esrf_mail_relay_or_webhook');
  assert.ok(!/gmail/i.test(text), 'Gmail wording must not appear in notification');
  // No recipient leaked when none was configured.
  assert.equal(msg.notify_to_recipient, undefined);
});

// ─── Notification recipient metadata (operational, not PII) ─────────────
check('notification message exposes notify_to_recipient ONLY when configured + valid', () => {
  const payload = payloadOf({
    intake_mode: 'org',
    contact: goodContact,
    organisation_listing: goodOrg,
    privacy: goodPrivacy,
  });
  // Documented default recipient is the operational ESRF inbox.
  const ok = buildNotificationMessage(payload, {
    submission_id: 's1', request_id: 'r1',
    workflow_status: 'stored', next_required_action: 'x',
    related_sheet: 'LAB_Intake_Submissions',
    notify_to: 'office@esrf.net',
  });
  assert.equal(ok.notify_to_recipient, 'office@esrf.net');
  // Submitter PII must STILL not leak even when recipient is set.
  const text = JSON.stringify(ok);
  assert.ok(!text.includes('anna@example.org'), 'submitter email leaked when recipient set');
  assert.ok(!text.includes('Anna Jansen'), 'submitter name leaked when recipient set');

  // Invalid recipient → field omitted (we never reflect garbage).
  const bad = buildNotificationMessage(payload, {
    submission_id: 's1', request_id: 'r1',
    workflow_status: 'stored', next_required_action: 'x',
    related_sheet: 'LAB_Intake_Submissions',
    notify_to: 'not an email',
  });
  assert.equal(bad.notify_to_recipient, undefined);

  // Empty recipient → field omitted.
  const empty = buildNotificationMessage(payload, {
    submission_id: 's1', request_id: 'r1',
    workflow_status: 'stored', next_required_action: 'x',
    related_sheet: 'LAB_Intake_Submissions',
    notify_to: '',
  });
  assert.equal(empty.notify_to_recipient, undefined);
});

check('sanitizeNotifyRecipient accepts office@esrf.net and rejects junk', () => {
  assert.equal(sanitizeNotifyRecipient('office@esrf.net'), 'office@esrf.net');
  assert.equal(sanitizeNotifyRecipient('  office@esrf.net  '), 'office@esrf.net');
  assert.equal(sanitizeNotifyRecipient(''), '');
  assert.equal(sanitizeNotifyRecipient(null), '');
  assert.equal(sanitizeNotifyRecipient('not-an-email'), '');
  assert.equal(sanitizeNotifyRecipient('a@b'), ''); // missing TLD dot
  assert.equal(sanitizeNotifyRecipient('<x>@y.z'), ''); // angle brackets
  assert.equal(sanitizeNotifyRecipient('a"b@y.z'), ''); // quote
});

// Notification rows / docs must not be tagged "Gmail webhook" anywhere.
check('workflow event row labels notification channel as ESRF mail relay/webhook (not Gmail)', () => {
  const payload = payloadOf({
    intake_mode: 'org', contact: goodContact, organisation_listing: goodOrg, privacy: goodPrivacy,
  });
  const evt = buildWorkflowEventRow(payload, {
    event_type: 'intake_received', workflow_step: 'stored',
    status_from: '', status_to: 'new',
    next_required_action: 'x', related_sheet: 'LAB_Intake_Submissions',
  });
  assert.equal(evt.notification_channel, 'esrf_mail_relay_or_webhook');
  assert.ok(!/gmail/i.test(JSON.stringify(evt)));
});

// ─── No Directory_Master target anywhere in the lab payload ─────────────
check('LAB spreadsheet config forbids Directory_Master writes', () => {
  assert.ok(LAB_SPREADSHEET.forbidden_targets.includes('Directory_Master'));
  assert.equal(LAB_SPREADSHEET.target_prefix, 'LAB_');
  for (const tab of Object.values(LAB_SPREADSHEET.tabs)) {
    assert.ok(tab.startsWith('LAB_'), 'tab not prefixed: ' + tab);
  }
});

// ─── Backend log + workflow event row builders ──────────────────────────
check('buildBackendLogRow + buildWorkflowEventRow produce plausible rows', () => {
  const payload = payloadOf({
    intake_mode: 'org',
    contact: goodContact,
    organisation_listing: goodOrg,
    privacy: goodPrivacy,
  });
  const log = buildBackendLogRow(payload, { request_id: 'req_test', status_code: 200, dry_run: true, validation_result: 'ok', workflow_step: 'dry_run' });
  assert.ok(log.log_id.startsWith('log_'));
  assert.equal(log.endpoint, '/api/intake');
  assert.equal(log.dry_run, true);
  assert.equal(log.validation_result, 'ok');
  const evt = buildWorkflowEventRow(payload, {
    event_type: 'intake_received_dry_run',
    workflow_step: 'dry_run',
    status_from: '',
    status_to: 'preview',
    next_required_action: 'configure webhook',
    related_sheet: 'LAB_Intake_Submissions',
  });
  assert.ok(evt.event_id.startsWith('evt_'));
  assert.equal(evt.workflow_step, 'dry_run');
  assert.equal(evt.related_sheet, 'LAB_Intake_Submissions');
  assert.equal(evt.actor, 'backend');
});

// ─── nextRequiredAction copy depends on stage and content ───────────────
check('nextRequiredAction returns dry-run copy when sheet not configured', () => {
  const payload = payloadOf({ intake_mode: 'org', contact: goodContact, organisation_listing: goodOrg, privacy: goodPrivacy });
  const txt = nextRequiredAction(payload, 'dry_run');
  assert.ok(/SHEETS_WEBHOOK_URL/i.test(txt));
});

// ─── Security gate: assertLabPayloadSafe ────────────────────────────────
check('assertLabPayloadSafe accepts a well-formed LAB_ payload', () => {
  assertLabPayloadSafe({
    target_prefix: 'LAB_',
    forbidden_targets: ['Directory_Master'],
    rows: { LAB_Intake_Submissions: { submission_id: 's1' } },
  });
});

check('assertLabPayloadSafe REFUSES Directory_Master target', () => {
  assert.throws(() => assertLabPayloadSafe({
    target_prefix: 'LAB_',
    forbidden_targets: ['Directory_Master'],
    rows: { Directory_Master: { name: 'rogue' } },
  }), /Directory_Master|forbidden tab/);
});

check('assertLabPayloadSafe REFUSES non-LAB_ target tabs', () => {
  assert.throws(() => assertLabPayloadSafe({
    target_prefix: 'LAB_',
    forbidden_targets: ['Directory_Master'],
    rows: { OTHER_Tab: { x: 1 } },
  }), /not LAB_-prefixed|LAB_/);
});

check('assertLabPayloadSafe REFUSES wrong target_prefix', () => {
  assert.throws(() => assertLabPayloadSafe({
    target_prefix: 'PROD_',
    forbidden_targets: ['Directory_Master'],
    rows: { PROD_Intake_Submissions: { x: 1 } },
  }), /target_prefix/);
});

check('assertLabPayloadSafe REFUSES payload missing Directory_Master in forbidden_targets', () => {
  assert.throws(() => assertLabPayloadSafe({
    target_prefix: 'LAB_',
    forbidden_targets: [],
    rows: { LAB_Intake_Submissions: { x: 1 } },
  }), /Directory_Master/);
});

// ─── Security gate: assertNotificationSafe ──────────────────────────────
check('assertNotificationSafe accepts a documented minimal payload', () => {
  assertNotificationSafe({
    schema_version: 1, submission_id: 's1', request_id: 'r1',
    environment: 'TEST', mode: 'org', type: 'org',
    org_name: 'Acme', country: 'NL', region: 'Zuid-Holland',
    workflow_status: 'stored', next_required_action: 'review',
    related_sheet: 'LAB_Intake_Submissions', notification_channel: 'esrf_mail_relay_or_webhook',
    note: 'minimal', notify_to_recipient: 'office@esrf.net',
  });
});

check('assertNotificationSafe rejects every forbidden PII / editorial key', () => {
  for (const k of FORBIDDEN_NOTIFY_KEYS) {
    const m = { schema_version: 1, [k]: 'leaked' };
    assert.throws(() => assertNotificationSafe(m), new RegExp('forbidden key ' + k));
  }
});

check('FORBIDDEN_NOTIFY_KEYS covers every documented PII / editorial body field', () => {
  const must = [
    'contact_email','contact_phone','contact_name','email','phone','name',
    'summary','regional_angle','lesson','editorial_summary','editorial_body',
    'description_en','raw_payload_json',
  ];
  for (const k of must) {
    assert.ok(FORBIDDEN_NOTIFY_KEYS.includes(k), 'missing forbidden key ' + k);
  }
});

// ─── Office identity ────────────────────────────────────────────────────
check('OFFICE_IDENTITY exposes office@esrf.net as the official recipient', () => {
  assert.equal(OFFICE_IDENTITY.official_recipient, 'office@esrf.net');
  assert.ok(/esrf\.net$/i.test(OFFICE_IDENTITY.official_recipient));
  // ai.agent.wm@gmail.com is a non-production identity only.
  assert.ok(Array.isArray(OFFICE_IDENTITY.non_production_identities));
  assert.ok(OFFICE_IDENTITY.non_production_identities.includes('ai.agent.wm@gmail.com'));
  assert.ok(/non-production/i.test(OFFICE_IDENTITY.note));
});

check('OFFICE_IDENTITY note explicitly forbids ai.agent.wm@gmail.com as production recipient', () => {
  const haystack = JSON.stringify(OFFICE_IDENTITY).toLowerCase();
  assert.ok(haystack.includes('ai.agent.wm@gmail.com'));
  // The note text mentions production-blocked status for the legacy id.
  assert.ok(/never.*production|non.production/i.test(OFFICE_IDENTITY.note));
});

// ─── HTTP method handling: POST-only endpoint ───────────────────────────
async function callOnRequest(method, opts) {
  opts = opts || {};
  const headers = new Map(Object.entries(opts.headers || {}));
  const request = {
    method,
    url: 'https://test-regional-editorial-cont.esrf-clean.pages.dev/api/intake',
    headers: {
      get(k) { return headers.get(String(k).toLowerCase()) || headers.get(k) || null; },
    },
    text: async () => opts.body || '',
    cf: {},
  };
  const ctx = { request, env: opts.env || {} };
  return await onRequest(ctx);
}

check('GET /api/intake returns 405 (POST-only)', async () => {
  const res = await callOnRequest('GET');
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'POST, OPTIONS');
});

check('PUT /api/intake returns 405 (POST-only)', async () => {
  const res = await callOnRequest('PUT');
  assert.equal(res.status, 405);
});

check('DELETE /api/intake returns 405 (POST-only)', async () => {
  const res = await callOnRequest('DELETE');
  assert.equal(res.status, 405);
});

// We can't actually await async checks via the sync `check()` runner
// without converting it; instead, gate the async tests behind a small
// async runner block. The previous `check(... async ...)` calls return
// a promise that resolves to undefined — assertion errors throw inside
// the async fn and become an unhandled rejection. To keep the failure
// count accurate, run these synchronously below.
async function asyncCheck(name, fn) {
  try { await fn(); console.log('  ok  — ' + name); }
  catch (e) { failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}

await asyncCheck('GET method is rejected (POST-only)', async () => {
  const res = await callOnRequest('GET');
  assert.equal(res.status, 405);
});

await asyncCheck('PUT method is rejected (POST-only)', async () => {
  const res = await callOnRequest('PUT');
  assert.equal(res.status, 405);
});

// ─── HTTP origin allowlist enforcement (forbidden origin path) ──────────
await asyncCheck('POST from disallowed origin returns 403', async () => {
  const res = await callOnRequest('POST', {
    headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 403);
});

// ─── Content-Type enforcement ───────────────────────────────────────────
await asyncCheck('POST with non-JSON content-type returns 415', async () => {
  const res = await callOnRequest('POST', {
    headers: { origin: 'https://www.esrf.net', 'content-type': 'text/plain' },
    body: '{}',
  });
  assert.equal(res.status, 415);
});

// ─── Payload size enforcement ───────────────────────────────────────────
await asyncCheck('POST with body > 64 KiB returns 413', async () => {
  const big = 'x'.repeat(64 * 1024 + 1);
  const res = await callOnRequest('POST', {
    headers: { origin: 'https://www.esrf.net', 'content-type': 'application/json' },
    body: '{"intake_mode":"org","contact":{"name":"' + big + '"}}',
  });
  assert.equal(res.status, 413);
});

// ─── JSON parse / object enforcement ────────────────────────────────────
await asyncCheck('POST with invalid JSON returns 400', async () => {
  const res = await callOnRequest('POST', {
    headers: { origin: 'https://www.esrf.net', 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(res.status, 400);
});

await asyncCheck('POST with JSON array (not object) returns 400', async () => {
  const res = await callOnRequest('POST', {
    headers: { origin: 'https://www.esrf.net', 'content-type': 'application/json' },
    body: '[1,2,3]',
  });
  assert.equal(res.status, 400);
});

// ─── Honeypot + form-fill timer ─────────────────────────────────────────
await asyncCheck('POST with honeypot value returns 400 (bot)', async () => {
  const res = await callOnRequest('POST', {
    headers: { origin: 'https://www.esrf.net', 'content-type': 'application/json' },
    body: JSON.stringify({ intake_mode: 'org', company_website_hp: 'http://spam.example', form_duration_ms: 9999 }),
  });
  assert.equal(res.status, 400);
});

await asyncCheck('POST with too-fast form fill returns 400', async () => {
  const res = await callOnRequest('POST', {
    headers: { origin: 'https://www.esrf.net', 'content-type': 'application/json' },
    body: JSON.stringify({ intake_mode: 'org', form_duration_ms: 100 }),
  });
  assert.equal(res.status, 400);
});

// ─── Dry-run default (no env vars set) ──────────────────────────────────
await asyncCheck('Default dry-run when no INTAKE_SHEET_WEBHOOK_URL configured', async () => {
  const body = {
    intake_mode: 'org',
    form_duration_ms: 9999,
    contact: {
      name: 'Anna Jansen', organisation: 'Acme', role: 'Coordinator',
      email: 'anna@example.org', country_code: 'NL',
      country_label: 'Nederland', place: 'Rotterdam',
      website: 'https://acme.example.org',
    },
    organisation_listing: { sector: 'gov', sector_label: 'Overheid', city: 'Rotterdam', description: 'd' },
    privacy: { gdpr_privacy_policy: true },
  };
  const res = await callOnRequest('POST', {
    headers: { origin: 'https://www.esrf.net', 'content-type': 'application/json' },
    body: JSON.stringify(body),
    env: {},
  });
  assert.equal(res.status, 200);
  const j = JSON.parse(await res.text());
  assert.equal(j.ok, true);
  assert.equal(j.dry_run, true);
  assert.equal(j.sheet_dry_run, true);
  assert.equal(j.notification_status, 'dry_run_not_configured');
  assert.equal(j.workflow.status, 'dry_run');
  // Office identity surfaced in the response.
  assert.equal(j.storage_architecture.official_identity.official_recipient, 'office@esrf.net');
  assert.equal(j.storage_architecture.production_readiness.status, 'security_review_ready_production_blocked');
  // Default dry-run preview must not leak PII via the notification message.
  const text = JSON.stringify(j.notification_message);
  assert.ok(!text.includes('anna@example.org'), 'dry-run notification leaked email');
  assert.ok(!text.includes('Anna Jansen'), 'dry-run notification leaked name');
});

// ─── Editorial consent: required ────────────────────────────────────────
await asyncCheck('Editorial mode without edit_and_publish consent returns 400', async () => {
  const body = {
    intake_mode: 'editorial',
    form_duration_ms: 9999,
    contact: {
      name: 'Anna', organisation: 'Acme', role: 'Coord',
      email: 'a@b.org', country_code: 'NL', country_label: 'NL',
    },
    editorial_contribution: {
      topic: 'T', summary: 'S', regional_angle: 'R', lesson: 'L',
      consent: { edit_and_publish: false, editorial_may_contact: true, no_confidential_information: true },
    },
    privacy: { gdpr_privacy_policy: true },
  };
  const res = await callOnRequest('POST', {
    headers: { origin: 'https://www.esrf.net', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 400);
});

// ─── GDPR consent: required ─────────────────────────────────────────────
await asyncCheck('Missing gdpr_privacy_policy returns 400', async () => {
  const body = {
    intake_mode: 'org', form_duration_ms: 9999,
    contact: {
      name: 'A', organisation: 'B', role: 'r', email: 'a@b.org',
      country_code: 'NL', country_label: 'NL', website: 'https://x.org',
    },
    organisation_listing: { sector: 'gov' },
    privacy: { gdpr_privacy_policy: false },
  };
  const res = await callOnRequest('POST', {
    headers: { origin: 'https://www.esrf.net', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 400);
});

// ─── Error messages do not leak internal details ────────────────────────
await asyncCheck('Validation error message is generic, not stack/secrets', async () => {
  const res = await callOnRequest('POST', {
    headers: { origin: 'https://www.esrf.net', 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 400);
  const t = await res.text();
  assert.ok(!/at\s+\w+\s+\(/.test(t), 'response leaked a stack trace');
  assert.ok(!/SHEETS_WEBHOOK_SECRET|GITHUB_TOKEN/.test(t), 'response leaked an env var name');
});

// ─── First-phase Apps Script reference is SPREADSHEET-ONLY ─────────────
// The first lab-write activation must not request any mail-sending
// OAuth scope. These tests fail if a MailApp/GmailApp/script.send_mail
// reference creeps back into the Apps Script source, or if the
// manifest's oauthScopes is no longer pinned to spreadsheets-only,
// or if the source starts requiring a NOTIFY_TO Script Property.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __thisFile = fileURLToPath(import.meta.url);
const __thisDir = dirname(__thisFile);
const REPO_ROOT = resolve(__thisDir, '..', '..');
const APPS_SCRIPT_PATH = resolve(REPO_ROOT, 'docs', 'apps-script-intake-webhook.gs');
const APPS_SCRIPT_MANIFEST_PATH = resolve(REPO_ROOT, 'docs', 'appsscript.json');
const FUTURE_MAIL_DOC_PATH = resolve(REPO_ROOT, 'docs', 'apps-script-mail-notification.future.md');

const APPS_SCRIPT_SRC = readFileSync(APPS_SCRIPT_PATH, 'utf8');

// Strip block + line comments so the lexical assertions only inspect
// executable code. The script is plain Apps Script (ES5-ish), so
// /* … */ and // … are sufficient.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const APPS_SCRIPT_CODE = stripComments(APPS_SCRIPT_SRC);

check('apps-script reference contains no MailApp call in executable code', () => {
  assert.ok(
    !/\bMailApp\b/.test(APPS_SCRIPT_CODE),
    'docs/apps-script-intake-webhook.gs must not reference MailApp in executable code (first-phase webhook is spreadsheet-only)'
  );
});
check('apps-script reference contains no GmailApp call', () => {
  assert.ok(
    !/\bGmailApp\b/.test(APPS_SCRIPT_CODE),
    'docs/apps-script-intake-webhook.gs must not reference GmailApp (first-phase webhook is spreadsheet-only)'
  );
});
check('apps-script reference does not call sendEmail / send_mail', () => {
  assert.ok(
    !/\bsendEmail\s*\(/.test(APPS_SCRIPT_CODE),
    'docs/apps-script-intake-webhook.gs must not call sendEmail (first-phase webhook is spreadsheet-only)'
  );
  assert.ok(
    !/\bsend_mail\b/.test(APPS_SCRIPT_CODE),
    'docs/apps-script-intake-webhook.gs must not reference script.send_mail in executable code'
  );
});
check('apps-script reference does not require NOTIFY_TO Script Property', () => {
  // NOTIFY_TO must not be referenced in executable code at all in the
  // spreadsheet-only first phase. (Comment-only mentions are allowed
  // and were already stripped before this assertion.)
  assert.ok(
    !/NOTIFY_TO/.test(APPS_SCRIPT_CODE),
    'docs/apps-script-intake-webhook.gs must not read NOTIFY_TO in the spreadsheet-only first phase'
  );
  assert.ok(
    !/NOTIFY_FROM_NAME/.test(APPS_SCRIPT_CODE),
    'docs/apps-script-intake-webhook.gs must not read NOTIFY_FROM_NAME in the spreadsheet-only first phase'
  );
  assert.ok(
    !/NOTIFY_SUBJECT_PREFIX/.test(APPS_SCRIPT_CODE),
    'docs/apps-script-intake-webhook.gs must not read NOTIFY_SUBJECT_PREFIX in the spreadsheet-only first phase'
  );
});
check('apps-script reference reports notification as pending separate deployment', () => {
  // The first-phase doPost() returns mail_notification_status set to a
  // sentinel that makes the deferred state explicit.
  assert.ok(
    /pending_separate_deployment/.test(APPS_SCRIPT_SRC),
    'docs/apps-script-intake-webhook.gs must surface mail_notification_status: "pending_separate_deployment"'
  );
});

const APPS_SCRIPT_MANIFEST = JSON.parse(readFileSync(APPS_SCRIPT_MANIFEST_PATH, 'utf8'));
check('appsscript.json oauthScopes is spreadsheets-only', () => {
  const scopes = APPS_SCRIPT_MANIFEST.oauthScopes;
  assert.ok(Array.isArray(scopes), 'appsscript.json must declare an oauthScopes array');
  assert.ok(scopes.length >= 1, 'oauthScopes must list at least one scope');
  for (const s of scopes) {
    assert.ok(
      /^https:\/\/www\.googleapis\.com\/auth\/spreadsheets(\.currentonly)?$/.test(s),
      'oauthScopes contains non-spreadsheets scope: ' + s
    );
  }
  assert.ok(
    !scopes.some((s) => /script\.send_mail|gmail/.test(s)),
    'first-phase appsscript.json must not declare any mail scope'
  );
});
check('deferred mail-notification route is documented separately', () => {
  // Spec gate: the deferred route MUST exist as documentation only;
  // there must be no .gs source file for it in this branch.
  const futureDoc = readFileSync(FUTURE_MAIL_DOC_PATH, 'utf8');
  assert.ok(
    /script\.send_mail/.test(futureDoc),
    'docs/apps-script-mail-notification.future.md must call out the script.send_mail scope as deferred'
  );
  assert.ok(
    /separate Apps Script (project|deployment)/i.test(futureDoc),
    'docs/apps-script-mail-notification.future.md must state the mail route lives in a separate Apps Script project/deployment'
  );
});
check('first-phase notification remains disabled / pending in the backend', () => {
  // Without INTAKE_NOTIFY_TO / INTAKE_NOTIFY_WEBHOOK configured, the
  // Cloudflare backend keeps the notification disabled / pending —
  // this is the "notification disabled / pending" contract for the
  // first lab-write activation. We exercise the same builder used
  // in production (buildNotificationMessage) with no notify_to in
  // ctx, mirroring the unset-env-var state.
  const payload = payloadOf({
    intake_mode: 'org',
    contact: goodContact,
    organisation_listing: goodOrg,
    privacy: goodPrivacy,
  });
  const msg = buildNotificationMessage(payload, {
    submission_id: payload.meta.submission_id,
    request_id: payload.meta.request_id,
    workflow_status: 'dry_run',
    next_required_action: 'first-phase: configure SHEETS_WEBHOOK only',
    related_sheet: 'LAB_Intake_Submissions',
    // notify_to deliberately omitted — INTAKE_NOTIFY_TO is unset in
    // the first-phase activation.
  });
  // notify_to_recipient must NOT appear when the operator has not
  // explicitly opted in to a recipient.
  assert.equal(msg.notify_to_recipient, undefined);
  // The minimal message must still pass the notification-safety
  // gate (no PII / editorial body).
  assertNotificationSafe(msg);
  // Channel name is preserved so future deferred mail-route
  // deployments wire onto the same contract.
  assert.equal(msg.notification_channel, 'esrf_mail_relay_or_webhook');
});

// ─── summary ─────────────────────────────────────────────────────────────
if (failures) {
  console.log('\n' + failures + ' test(s) FAILED');
  process.exit(1);
}
console.log('\nall tests passed');
