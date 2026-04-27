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
  buildChangeRequestRow,
  VALID_MODES,
  VALID_CHANGE_ACTIONS,
  VALID_REQUESTER_AUTH,
  buildNotificationMessage,
  needsPlaceCandidateRow,
  nextRequiredAction,
  LAB_SPREADSHEET,
  OFFICE_IDENTITY,
  FORBIDDEN_NOTIFY_KEYS,
  NOTIFICATION_CONTRACT,
  MINIMAL_NOTIFICATION_DESIGN_STATUS,
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
  // cr_* columns preserve change-request data on LAB_Intake_Submissions until
  // the dedicated LAB_Change_Requests tab is deployed.
  'cr_sub_mode','cr_requested_action','cr_target_listing_name','cr_target_listing_url',
  'cr_change_description','cr_reason','cr_evidence_url','cr_requester_authorization',
  'cr_authorization_confirmation','cr_directory_master_touched','cr_automatic_publication',
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

// ─── Change-request / hide_delete mode ──────────────────────────────────
const goodChangeRequest = {
  target_listing_name: 'Stichting Voorbeeld Noord',
  target_listing_url: 'https://esrf.net/directory/voorbeeld-noord',
  requested_action: 'update',
  change_description: 'Adres en sector kloppen niet meer; verhuisd naar Groningen.',
  reason: 'Organisatie is verhuisd en kerntaken zijn verschoven.',
  evidence_url: 'https://example.org/persbericht-verhuizing',
  requester_authorization: 'authorized_representative',
  authorization_confirmation: 'yes',
};

check('VALID_MODES includes change_request and hide_delete', () => {
  assert.ok(VALID_MODES instanceof Set, 'VALID_MODES should be a Set');
  assert.ok(VALID_MODES.has('change_request'));
  assert.ok(VALID_MODES.has('hide_delete'));
  assert.ok(VALID_MODES.has('org'));
  assert.ok(!VALID_MODES.has('xyz'));
});

check('VALID_CHANGE_ACTIONS and VALID_REQUESTER_AUTH enforce the right enums', () => {
  assert.deepEqual([...VALID_CHANGE_ACTIONS].sort(), ['delete', 'hide', 'update']);
  assert.deepEqual(
    [...VALID_REQUESTER_AUTH].sort(),
    ['authorized_representative', 'employee', 'external_observer']
  );
});

check('change_request mode validates and produces payload.change_request', () => {
  const r = validateAndSanitize({
    intake_mode: 'change_request',
    contact: goodContact,
    change_request: goodChangeRequest,
    privacy: goodPrivacy,
  });
  assert.ok(!r.error, 'expected no error, got: ' + r.error);
  assert.equal(r.payload.intake_mode, 'change_request');
  assert.ok(r.payload.change_request);
  assert.equal(r.payload.change_request.requested_action, 'update');
  assert.equal(r.payload.change_request.target_listing_name, 'Stichting Voorbeeld Noord');
  assert.equal(r.payload.change_request.target_listing_url, 'https://esrf.net/directory/voorbeeld-noord');
  assert.equal(r.payload.change_request.authorization_confirmation, true);
  assert.equal(r.payload.change_request.sub_mode, 'change_request');
});

check('change_request rejects payload without target_listing_name or _url', () => {
  const r = validateAndSanitize({
    intake_mode: 'change_request',
    contact: goodContact,
    change_request: { ...goodChangeRequest, target_listing_name: '', target_listing_url: '' },
    privacy: goodPrivacy,
  });
  assert.ok(r.error && /target_listing/i.test(r.error), 'expected target_listing error, got: ' + r.error);
});

check('change_request rejects missing authorization_confirmation', () => {
  const r = validateAndSanitize({
    intake_mode: 'change_request',
    contact: goodContact,
    change_request: { ...goodChangeRequest, authorization_confirmation: false },
    privacy: goodPrivacy,
  });
  assert.ok(r.error && /authorization_confirmation/i.test(r.error));
});

check('change_request rejects unknown requester_authorization enum', () => {
  const r = validateAndSanitize({
    intake_mode: 'change_request',
    contact: goodContact,
    change_request: { ...goodChangeRequest, requester_authorization: 'random_role' },
    privacy: goodPrivacy,
  });
  assert.ok(r.error && /requester_authorization/i.test(r.error));
});

check('change_request rejects bogus target_listing_url scheme', () => {
  const r = validateAndSanitize({
    intake_mode: 'change_request',
    contact: goodContact,
    change_request: { ...goodChangeRequest, target_listing_url: 'javascript:alert(1)' },
    privacy: goodPrivacy,
  });
  assert.ok(r.error && /target_listing_url/i.test(r.error));
});

check('hide_delete mode constrains requested_action to hide or delete', () => {
  const okHide = validateAndSanitize({
    intake_mode: 'hide_delete',
    contact: goodContact,
    change_request: { ...goodChangeRequest, requested_action: 'hide' },
    privacy: goodPrivacy,
  });
  assert.ok(!okHide.error);
  assert.equal(okHide.payload.change_request.requested_action, 'hide');
  assert.equal(okHide.payload.change_request.sub_mode, 'hide_delete');

  const okDelete = validateAndSanitize({
    intake_mode: 'hide_delete',
    contact: goodContact,
    change_request: { ...goodChangeRequest, requested_action: 'delete' },
    privacy: goodPrivacy,
  });
  assert.ok(!okDelete.error);
  assert.equal(okDelete.payload.change_request.requested_action, 'delete');

  const bad = validateAndSanitize({
    intake_mode: 'hide_delete',
    contact: goodContact,
    change_request: { ...goodChangeRequest, requested_action: 'update' },
    privacy: goodPrivacy,
  });
  assert.ok(bad.error && /hide_delete/i.test(bad.error));
});

check('change_request mode does NOT require contact.organisation', () => {
  // Requester may be an external observer without their own organisation.
  const { organisation: _omit, ...contactNoOrg } = goodContact;
  const r = validateAndSanitize({
    intake_mode: 'change_request',
    contact: contactNoOrg,
    change_request: goodChangeRequest,
    privacy: goodPrivacy,
  });
  assert.ok(!r.error, 'expected no error, got: ' + r.error);
});

check('buildChangeRequestRow produces a LAB_Change_Requests row with the right shape', () => {
  const payload = payloadOf({
    intake_mode: 'change_request',
    contact: goodContact,
    change_request: goodChangeRequest,
    privacy: goodPrivacy,
  });
  const row = buildChangeRequestRow(payload, { issue_url: '', issue_number: '' });
  assert.ok(row.change_request_id && row.change_request_id.startsWith('chg_'));
  assert.equal(row.requested_action, 'update');
  assert.equal(row.target_listing_name, 'Stichting Voorbeeld Noord');
  assert.equal(row.target_listing_url, 'https://esrf.net/directory/voorbeeld-noord');
  assert.equal(row.requester_email, 'anna@example.org');
  assert.equal(row.requester_authorization, 'authorized_representative');
  assert.equal(row.authorization_confirmation, 'yes');
  assert.equal(row.directory_master_touched, 'no');
  assert.equal(row.automatic_publication, 'no');
  assert.equal(row.review_status, 'new');
  // Forbidden PII keys must NOT exist in this row shape
  assert.ok(!('raw_payload_json' in row));
});

check('change_request emits a linked LAB_Intake_Submissions row with submission_type=change_request:<action>', () => {
  const payload = payloadOf({
    intake_mode: 'change_request',
    contact: goodContact,
    change_request: { ...goodChangeRequest, requested_action: 'delete' },
    privacy: goodPrivacy,
  });
  const intake = buildIntakeSubmissionRow(payload, {});
  assert.equal(intake.submission_type, 'change_request:delete');
  // Listing reference comes from target_listing_*
  assert.equal(intake.name, 'Stichting Voorbeeld Noord');
  assert.equal(intake.consent_publish, 'change_request_only');
});

check('change_request populates cr_* columns on LAB_Intake_Submissions for fallback display', () => {
  const payload = payloadOf({
    intake_mode: 'change_request',
    contact: goodContact,
    change_request: { ...goodChangeRequest, requested_action: 'update' },
    privacy: goodPrivacy,
  });
  const row = buildIntakeSubmissionRow(payload, {});
  assert.equal(row.cr_sub_mode, 'change_request');
  assert.equal(row.cr_requested_action, 'update');
  assert.equal(row.cr_target_listing_name, 'Stichting Voorbeeld Noord');
  assert.equal(row.cr_target_listing_url, 'https://esrf.net/directory/voorbeeld-noord');
  assert.ok(row.cr_change_description && row.cr_change_description.length > 0);
  assert.ok(row.cr_reason && row.cr_reason.length > 0);
  assert.equal(row.cr_authorization_confirmation, 'yes');
  assert.equal(row.cr_directory_master_touched, 'no');
  assert.equal(row.cr_automatic_publication, 'no');
});

check('non-change-request submissions leave cr_* columns blank', () => {
  const payload = payloadOf({
    intake_mode: 'org',
    contact: goodContact,
    organisation_listing: goodOrg,
    privacy: goodPrivacy,
  });
  const row = buildIntakeSubmissionRow(payload, {});
  assert.equal(row.cr_sub_mode, '');
  assert.equal(row.cr_requested_action, '');
  assert.equal(row.cr_target_listing_name, '');
  assert.equal(row.cr_change_description, '');
  assert.equal(row.cr_authorization_confirmation, '');
});

check('change_request notification builder emits messageType change_request:<action> with no contact PII', () => {
  const payload = payloadOf({
    intake_mode: 'change_request',
    contact: goodContact,
    change_request: { ...goodChangeRequest, requested_action: 'hide' },
    privacy: goodPrivacy,
  });
  const msg = buildNotificationMessage(payload, {
    sheet_row_id: 'row_test',
    issue_url: '',
    notify_to: 'office@esrf.net',
  });
  assert.ok(msg, 'expected a notification message');
  // The contract puts the message-type under the `type` key.
  assert.equal(msg.type, 'change_request:hide');
  assert.equal(msg.org_name, 'Stichting Voorbeeld Noord');
  // Payload must NOT contain contact email/phone or raw payload
  const json = JSON.stringify(msg);
  assert.ok(!json.includes('anna@example.org'), 'notification leaked contact email');
  assert.ok(!json.includes('+31 6 12345678'), 'notification leaked contact phone');
  assert.ok(!json.includes('raw_payload_json'));
});

check('LAB_SPREADSHEET registers LAB_Change_Requests tab and forbids Directory_Master', () => {
  assert.equal(LAB_SPREADSHEET.tabs.change_requests, 'LAB_Change_Requests');
  assert.ok(LAB_SPREADSHEET.forbidden_targets.includes('Directory_Master'));
  assert.equal(LAB_SPREADSHEET.target_prefix, 'LAB_');
});

check('assertLabPayloadSafe accepts LAB_Change_Requests as a target tab', () => {
  assertLabPayloadSafe({
    target_prefix: 'LAB_',
    forbidden_targets: ['Directory_Master'],
    rows: { LAB_Change_Requests: { change_request_id: 'chg_x', requested_action: 'update' } },
  });
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
  // Spec gate: the deferred route lives in a SEPARATE Apps Script
  // project. It now has a prepared (not-deployed) source stub at
  // docs/apps-script-mail-notification.gs and a separate manifest at
  // docs/appsscript.mail-notification.json. Both must remain
  // explicitly disjoint from the first-phase spreadsheet-only project.
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

// ─── Separate mail-relay source (PREPARED, NOT ACTIVATED) ───────────────
// The mail-relay source lives at docs/apps-script-mail-notification.gs
// alongside its own manifest docs/appsscript.mail-notification.json. We
// pin its safety contract here so a future edit cannot silently widen
// the scope or echo PII back to the recipient.
const MAIL_RELAY_PATH = resolve(REPO_ROOT, 'docs', 'apps-script-mail-notification.gs');
const MAIL_RELAY_MANIFEST_PATH = resolve(REPO_ROOT, 'docs', 'appsscript.mail-notification.json');
const MAIL_RELAY_SRC = readFileSync(MAIL_RELAY_PATH, 'utf8');
const MAIL_RELAY_CODE = stripComments(MAIL_RELAY_SRC);

check('mail-relay source is the ONLY place that calls MailApp.sendEmail', () => {
  // The first-phase webhook must NOT call MailApp at all (already
  // covered above). The mail-relay source must call it exactly once.
  const matches = MAIL_RELAY_CODE.match(/MailApp\.sendEmail\s*\(/g) || [];
  assert.equal(matches.length, 1,
    'docs/apps-script-mail-notification.gs must call MailApp.sendEmail exactly once');
});

check('mail-relay source enforces shared-secret check before any side-effect', () => {
  // The unauthorised return must occur lexically before the
  // MailApp.sendEmail call. We approximate this by checking that
  // 'unauthorised' (the doPost reject string) appears before the
  // MailApp call in the source.
  const idxAuth = MAIL_RELAY_CODE.indexOf("'unauthorised'");
  const idxSend = MAIL_RELAY_CODE.indexOf('MailApp.sendEmail');
  assert.ok(idxAuth > 0 && idxSend > idxAuth,
    'mail-relay source must reject unauthorised requests before calling MailApp.sendEmail');
});

check('mail-relay source pins the FORBIDDEN_RECIPIENTS deny-list', () => {
  // ai.agent.wm@gmail.com must be hard-blocked at the Apps Script
  // level too, not only on the Cloudflare side.
  assert.ok(/FORBIDDEN_RECIPIENTS/.test(MAIL_RELAY_CODE),
    'mail-relay source must declare a FORBIDDEN_RECIPIENTS list');
  assert.ok(/ai\.agent\.wm@gmail\.com/.test(MAIL_RELAY_SRC),
    'mail-relay source must include ai.agent.wm@gmail.com on the deny-list');
});

check('mail-relay ALLOWED_FIELDS exactly mirrors NOTIFICATION_CONTRACT.allowed_keys', () => {
  // Lexical assertion: every allowed key in the Cloudflare contract
  // must appear in ALLOWED_FIELDS in the .gs source. Both sides must
  // agree on the wire shape.
  for (const k of NOTIFICATION_CONTRACT.allowed_keys) {
    assert.ok(MAIL_RELAY_CODE.indexOf("'" + k + "'") !== -1,
      'mail-relay source missing allowed_keys entry: ' + k);
  }
});

check('mail-relay FORBIDDEN_FIELDS pins every Cloudflare forbidden_keys entry', () => {
  for (const k of NOTIFICATION_CONTRACT.forbidden_keys) {
    assert.ok(MAIL_RELAY_CODE.indexOf("'" + k + "'") !== -1,
      'mail-relay source missing forbidden_keys entry: ' + k);
  }
});

check('mail-relay manifest declares ONLY script.send_mail scope', () => {
  const manifest = JSON.parse(readFileSync(MAIL_RELAY_MANIFEST_PATH, 'utf8'));
  assert.ok(Array.isArray(manifest.oauthScopes), 'mail-relay manifest must declare an oauthScopes array');
  assert.equal(manifest.oauthScopes.length, 1,
    'mail-relay manifest must declare EXACTLY one oauthScope (script.send_mail)');
  assert.equal(manifest.oauthScopes[0],
    'https://www.googleapis.com/auth/script.send_mail');
  // No spreadsheet scope — the two projects stay disjoint.
  for (const s of manifest.oauthScopes) {
    assert.ok(!/auth\/spreadsheets/.test(s),
      'mail-relay manifest must NOT contain auth/spreadsheets (that belongs to the first-phase project)');
  }
});

check('mail-relay source documents PREPARED/NOT-ACTIVATED status', () => {
  assert.ok(/PREPARED, NOT ACTIVATED/i.test(MAIL_RELAY_SRC),
    'mail-relay source must declare PREPARED, NOT ACTIVATED status in its header');
  assert.ok(/Rollback/i.test(MAIL_RELAY_SRC),
    'mail-relay source must document a Rollback procedure');
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

// ─── Minimal-notification design contract + status flag ────────────────
check('MINIMAL_NOTIFICATION_DESIGN_STATUS is the documented not-enabled value', () => {
  assert.equal(MINIMAL_NOTIFICATION_DESIGN_STATUS, 'minimal-notification-design-ready-not-enabled');
});

check('NOTIFICATION_CONTRACT exposes the documented status flag, channel, and pointers', () => {
  assert.equal(NOTIFICATION_CONTRACT.status, 'minimal-notification-design-ready-not-enabled');
  assert.equal(NOTIFICATION_CONTRACT.channel, 'esrf_mail_relay_or_webhook');
  // The note may mention Gmail explicitly to call out that the channel
  // is NOT Gmail-specific (defensive disclaimer). What it must NOT do is
  // claim that the channel IS a Gmail integration.
  assert.ok(/never gmail/i.test(NOTIFICATION_CONTRACT.channel_note),
    'NOTIFICATION_CONTRACT.channel_note must explicitly disclaim Gmail-specificity');
  assert.equal(NOTIFICATION_CONTRACT.spec_doc, 'docs/intake-minimal-notification-design.md');
  assert.equal(NOTIFICATION_CONTRACT.future_mail_relay_doc, 'docs/apps-script-mail-notification.future.md');
});

check('NOTIFICATION_CONTRACT.allowed_keys covers every key the builder emits + nothing else', () => {
  const payload = payloadOf({
    intake_mode: 'both',
    contact: goodContact,
    organisation_listing: goodOrg,
    editorial_contribution: goodEd,
    privacy: goodPrivacy,
  });
  const msg = buildNotificationMessage(payload, {
    submission_id: 's1', request_id: 'r1',
    workflow_status: 'stored',
    next_required_action: 'review',
    related_sheet: 'LAB_Intake_Submissions',
    related_row: '4',
    issue_url: 'https://github.com/x/y/issues/12',
    notify_to: 'office@esrf.net',
  });
  for (const k of Object.keys(msg)) {
    assert.ok(NOTIFICATION_CONTRACT.allowed_keys.includes(k),
      'builder emitted key not in NOTIFICATION_CONTRACT.allowed_keys: ' + k);
  }
  // The message must surface the documented operational keys.
  for (const required of ['submission_id','request_id','related_sheet','related_sheet_url','validation_lab_url','notification_channel']) {
    assert.ok(Object.prototype.hasOwnProperty.call(msg, required),
      'builder did not emit required key ' + required);
  }
  // related_sheet_url points at the LAB spreadsheet root only.
  assert.ok(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit$/.test(msg.related_sheet_url),
    'related_sheet_url is not a plain spreadsheet root URL: ' + msg.related_sheet_url);
});

check('NOTIFICATION_CONTRACT.forbidden_keys mirrors FORBIDDEN_NOTIFY_KEYS exactly', () => {
  const a = [...FORBIDDEN_NOTIFY_KEYS].sort();
  const b = [...NOTIFICATION_CONTRACT.forbidden_keys].sort();
  assert.deepEqual(a, b);
});

check('NOTIFICATION_CONTRACT.forbidden_keys covers operational secrets and raw payload', () => {
  const must = [
    'shared_secret', 'shared_secret_present',
    'INTAKE_SHEET_WEBHOOK_URL', 'SHEETS_WEBHOOK_URL',
    'SHEETS_WEBHOOK_SECRET', 'GITHUB_TOKEN',
    'INTAKE_NOTIFY_WEBHOOK', 'TURNSTILE_SECRET_KEY',
    'raw_payload_json',
  ];
  for (const k of must) {
    assert.ok(NOTIFICATION_CONTRACT.forbidden_keys.includes(k),
      'forbidden_keys missing ' + k);
  }
});

check('NOTIFICATION_CONTRACT activation checklist is non-empty and references office@esrf.net', () => {
  assert.ok(Array.isArray(NOTIFICATION_CONTRACT.activation_checklist));
  assert.ok(NOTIFICATION_CONTRACT.activation_checklist.length >= 5,
    'activation checklist must list at least 5 ordered steps');
  const text = NOTIFICATION_CONTRACT.activation_checklist.join(' | ');
  assert.ok(/office@esrf\.net/.test(text), 'activation checklist must mention office@esrf.net');
  assert.ok(/auth\/spreadsheets/.test(text), 'activation checklist must reference the spreadsheet-only first phase');
  assert.ok(/script\.send_mail/.test(text), 'activation checklist must mention the deferred script.send_mail scope');
});

check('NOTIFICATION_CONTRACT forbidden_recipients includes the legacy non-production identity', () => {
  assert.ok(Array.isArray(NOTIFICATION_CONTRACT.forbidden_recipients));
  assert.ok(NOTIFICATION_CONTRACT.forbidden_recipients.includes('ai.agent.wm@gmail.com'));
});

check('notification builder rejects unregistered keys at build time', () => {
  // Defence-in-depth: prove the builder's contract-allowed_keys check
  // fires by monkey-patching the contract to drop one key, calling the
  // builder, and confirming it throws. We restore on exit.
  const original = NOTIFICATION_CONTRACT.allowed_keys.slice();
  try {
    // Drop "org_name" so the builder's emitted payload contains an
    // unregistered key.
    NOTIFICATION_CONTRACT.allowed_keys.length = 0;
    for (const k of original) {
      if (k !== 'org_name') NOTIFICATION_CONTRACT.allowed_keys.push(k);
    }
    const payload = payloadOf({
      intake_mode: 'org', contact: goodContact, organisation_listing: goodOrg, privacy: goodPrivacy,
    });
    assert.throws(() => buildNotificationMessage(payload, {
      submission_id: 's', request_id: 'r',
      workflow_status: 'dry_run', next_required_action: 'x',
      related_sheet: 'LAB_Intake_Submissions',
    }), /key not in contract allowed_keys/);
  } finally {
    NOTIFICATION_CONTRACT.allowed_keys.length = 0;
    for (const k of original) NOTIFICATION_CONTRACT.allowed_keys.push(k);
  }
});

check('notification message excludes operational secrets and raw_payload_json', () => {
  const payload = payloadOf({
    intake_mode: 'both',
    contact: goodContact,
    organisation_listing: goodOrg,
    editorial_contribution: goodEd,
    privacy: goodPrivacy,
  });
  const msg = buildNotificationMessage(payload, {
    submission_id: 's1', request_id: 'r1',
    workflow_status: 'stored',
    next_required_action: 'review',
    related_sheet: 'LAB_Intake_Submissions',
    related_row: '4',
    issue_url: 'https://github.com/x/y/issues/12',
    notify_to: 'office@esrf.net',
  });
  // The message JSON must not contain any of the forbidden secret-like
  // keys, even as nested values.
  for (const k of [
    'shared_secret', 'SHEETS_WEBHOOK_SECRET', 'GITHUB_TOKEN',
    'INTAKE_SHEET_WEBHOOK_URL', 'INTAKE_NOTIFY_WEBHOOK',
    'TURNSTILE_SECRET_KEY', 'raw_payload_json',
  ]) {
    assert.ok(!Object.prototype.hasOwnProperty.call(msg, k), 'forbidden key surfaced: ' + k);
  }
  // assertNotificationSafe is the runtime gate.
  assertNotificationSafe(msg);
});

check('assertNotificationSafe rejects messages carrying operational secrets', () => {
  for (const k of ['shared_secret','SHEETS_WEBHOOK_SECRET','GITHUB_TOKEN','INTAKE_SHEET_WEBHOOK_URL','INTAKE_NOTIFY_WEBHOOK','TURNSTILE_SECRET_KEY']) {
    const m = { schema_version: 1, [k]: 'leak' };
    assert.throws(() => assertNotificationSafe(m), new RegExp('forbidden key ' + k));
  }
});

// ─── HTTP response surfacing of the contract + status flag ──────────────
await asyncCheck('Default dry-run surfaces notification_contract and minimal_notification_design_status', async () => {
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
  assert.equal(j.minimal_notification_design_status, 'minimal-notification-design-ready-not-enabled');
  assert.ok(j.notification_contract, 'response must surface notification_contract');
  assert.equal(j.notification_contract.status, 'minimal-notification-design-ready-not-enabled');
  assert.equal(j.notification_contract.channel, 'esrf_mail_relay_or_webhook');
  assert.ok(Array.isArray(j.notification_contract.allowed_keys));
  assert.ok(Array.isArray(j.notification_contract.forbidden_keys));
  assert.ok(j.notification_contract.forbidden_keys.includes('shared_secret'));
  assert.ok(j.notification_contract.forbidden_keys.includes('raw_payload_json'));
  assert.ok(j.notification_contract.forbidden_keys.includes('contact_email'));
  assert.ok(Array.isArray(j.notification_contract.activation_checklist));
  // The actual notification_message must still pass the contract.
  assertNotificationSafe(j.notification_message);
  for (const k of Object.keys(j.notification_message)) {
    assert.ok(j.notification_contract.allowed_keys.includes(k),
      'response notification_message contains key not in allowed_keys: ' + k);
  }
});

// ─── Spec doc presence ──────────────────────────────────────────────────
check('docs/intake-minimal-notification-design.md exists and references the status flag + activation checklist', () => {
  const designDoc = readFileSync(resolve(REPO_ROOT, 'docs', 'intake-minimal-notification-design.md'), 'utf8');
  assert.ok(/minimal-notification-design-ready-not-enabled/.test(designDoc),
    'design doc must reference the not-enabled status flag');
  assert.ok(/Activation checklist/i.test(designDoc),
    'design doc must include an activation checklist section');
  assert.ok(/office@esrf\.net/.test(designDoc),
    'design doc must call out office@esrf.net as the documented recipient');
  assert.ok(/raw_payload_json/.test(designDoc),
    'design doc must list raw_payload_json among forbidden keys');
  assert.ok(/SHEETS_WEBHOOK_SECRET/.test(designDoc),
    'design doc must list SHEETS_WEBHOOK_SECRET among forbidden secrets');
});

check('docs/apps-script-mail-notification.future.md links the design doc + lists the activation checklist', () => {
  const futureDoc = readFileSync(FUTURE_MAIL_DOC_PATH, 'utf8');
  assert.ok(/intake-minimal-notification-design\.md/.test(futureDoc),
    'future-mail doc must link the design doc');
  assert.ok(/Real-mail-test activation checklist/i.test(futureDoc),
    'future-mail doc must include the activation checklist section');
  assert.ok(/INTAKE_NOTIFY_TO/.test(futureDoc),
    'future-mail doc must reference INTAKE_NOTIFY_TO env var');
  assert.ok(/MINIMAL_NOTIFICATION_DESIGN_STATUS/.test(futureDoc),
    'future-mail doc must reference the design status flag');
});

// ─── summary ─────────────────────────────────────────────────────────────
if (failures) {
  console.log('\n' + failures + ' test(s) FAILED');
  process.exit(1);
}
console.log('\nall tests passed');
