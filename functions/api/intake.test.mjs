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

// ─── summary ─────────────────────────────────────────────────────────────
if (failures) {
  console.log('\n' + failures + ' test(s) FAILED');
  process.exit(1);
}
console.log('\nall tests passed');
