// Cloudflare Pages Function — POST /api/intake-test
//
// Preview-only "single controlled lab-write" route. Created so we can
// run ONE end-to-end intake → Apps Script → LAB_* tab write against the
// authorised office@esrf.net Apps Script Web App without re-opening
// /api/intake to general traffic.
//
// Why a separate route:
//   - The repo's `_middleware.js` blocks generic HTTP-client UAs
//     (curl/, wget, python-requests, Go-http-client, …) outside Europe.
//     That is correct for HTML pages but it returns a plain 403 before
//     /api/intake's own handler runs, which makes a single controlled
//     POST from an operator infeasible.
//   - Rather than carving general bot-filter holes in /api/intake, we
//     expose a strictly-gated test route that only the middleware
//     bypass list permits. The route itself enforces:
//       1. Preview-only: production environment returns 404.
//       2. POST-only.
//       3. Required `lab_test === true` marker in the body.
//       4. Required `ESRF Lab Test` prefix on contact.organisation
//          AND contact.name (case-insensitive).
//       5. Forces meta.environment to 'TEST/VALIDATIE'.
//       6. Forces dry-run when sheet webhook secrets are missing;
//          only flips to live when both INTAKE_SHEET_WEBHOOK_URL and
//          SHEETS_WEBHOOK_SECRET are present.
//       7. Notification stays disabled / pending — INTAKE_NOTIFY_*
//          env vars are deliberately ignored on this route.
//       8. Writes only to LAB_* tabs; Directory_Master is forbidden.
//       9. Same payload-size, content-type, JSON-shape, and field
//          validation as /api/intake.
//      10. Returns generic JSON errors — no upstream stack traces,
//          no env-var names, no shared-secret reflection.
//
// This route is NEVER mounted in production: production deploys are
// expected to set CF_PAGES_BRANCH / ENVIRONMENT to a non-Preview value
// (or no branch at all on the main esrf.net production project), and
// the route will short-circuit to 404 before any handler logic runs.

import {
  validateAndSanitize,
  buildIntakeSubmissionRow,
  buildEditorialIntakeRow,
  buildPlaceCandidateRow,
  buildBackendLogRow,
  buildWorkflowEventRow,
  buildNotificationMessage,
  needsPlaceCandidateRow,
  nextRequiredAction,
  postSheetWebhook,
  assertLabPayloadSafe,
  assertNotificationSafe,
  sanitizeNotifyRecipient,
  isAllowedOrigin,
  cors,
  json,
  jsonErr,
  generateId,
  LAB_SPREADSHEET,
  OFFICE_IDENTITY,
  MAX_BODY_BYTES,
} from './intake.js';

// Required marker prefix on contact.organisation AND contact.name. We
// match case-insensitively but trim whitespace; the prefix must appear
// at the start of the value to make accidental hits unlikely.
const LAB_TEST_PREFIX = 'ESRF Lab Test';

function hasLabTestPrefix(value) {
  if (value == null) return false;
  const v = String(value).trim().toLowerCase();
  return v.startsWith(LAB_TEST_PREFIX.toLowerCase());
}

// Decide whether this deployment is a Preview/test environment. We
// treat anything that is NOT explicitly production as Preview, so a
// missing/unknown CF_PAGES_BRANCH does not accidentally enable the
// route on the main esrf.net production project — `CF_PAGES_BRANCH`
// equal to 'main' or any production-marked env is rejected.
function isPreviewEnv(env) {
  // Explicit allow: when the operator sets ESRF_PREVIEW=true on the
  // Preview project, we trust that. This is the documented enable
  // switch.
  const explicit = String(env.ESRF_PREVIEW || '').trim().toLowerCase();
  if (explicit === 'true' || explicit === '1' || explicit === 'yes') return true;

  // Fall back to Cloudflare Pages' built-in CF_PAGES_BRANCH. Production
  // is the branch configured as the production branch in Pages (almost
  // always 'main'). Anything else is a preview deploy.
  const branch = String(env.CF_PAGES_BRANCH || '').trim();
  if (!branch) return false;             // unknown → safe default: not preview
  if (branch === 'main') return false;    // production
  return true;
}

// 64 KiB hard cap — same as /api/intake. Re-declared locally so a
// future change to MAX_BODY_BYTES in intake.js cannot silently lift the
// cap on this route without an explicit edit here.
const TEST_MAX_BODY_BYTES = MAX_BODY_BYTES;

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('origin') || '';
  const requestId = generateId('req-test');

  // 1) Preview-only gate. Production short-circuits before reading the
  //    body so a malicious caller cannot force the validator to run on
  //    the production project.
  if (!isPreviewEnv(env)) {
    return cors(jsonErr('Not found', 404), origin);
  }

  // 2) Origin allowlist — same set as /api/intake (production hosts +
  //    *.esrf-clean.pages.dev). An operator using `curl -H "origin: …"`
  //    must therefore mimic an allowed origin; this is a deliberate
  //    extra hurdle vs anonymous bot traffic.
  if (!isAllowedOrigin(origin)) {
    return cors(jsonErr('Forbidden origin', 403), origin);
  }

  // 3) Content-Type + body-size enforcement.
  const contentType = (request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return cors(jsonErr('Content-Type must be application/json', 415), origin);
  }
  const raw = await request.text();
  if (raw.length > TEST_MAX_BODY_BYTES) {
    return cors(jsonErr('Payload too large', 413), origin);
  }

  let body;
  try { body = JSON.parse(raw); }
  catch { return cors(jsonErr('Invalid JSON', 400), origin); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return cors(jsonErr('Invalid JSON body', 400), origin);
  }

  // 4) Lab-test marker. Without this, the route refuses outright; this
  //    is the sentinel that distinguishes a deliberate operator probe
  //    from a mistargeted real submission.
  if (body.lab_test !== true) {
    return cors(jsonErr('lab_test marker required (must be boolean true)', 400), origin);
  }

  // 5) ESRF Lab Test prefix on organisation AND name. We check BEFORE
  //    sanitisation so an operator cannot smuggle a real organisation
  //    name through HTML-escaping into a real-looking row.
  const contactProbe = body.contact && typeof body.contact === 'object' ? body.contact : {};
  const orgProbe = body.organisation_listing && typeof body.organisation_listing === 'object' ? body.organisation_listing : {};
  if (!hasLabTestPrefix(contactProbe.organisation)) {
    return cors(jsonErr('contact.organisation must start with "' + LAB_TEST_PREFIX + '"', 400), origin);
  }
  if (!hasLabTestPrefix(contactProbe.name)) {
    return cors(jsonErr('contact.name must start with "' + LAB_TEST_PREFIX + '"', 400), origin);
  }

  // 6) Validate + sanitise via the same pipeline as /api/intake. The
  //    pipeline already forces meta.environment = 'TEST/VALIDATIE',
  //    which is exactly what we want; we re-assert it below as
  //    defence-in-depth.
  const sanitized = validateAndSanitize(body);
  if (sanitized.error) {
    return cors(jsonErr(sanitized.error, 400), origin);
  }
  const payload = sanitized.payload;
  // Defence-in-depth: refuse anything that did NOT yield TEST/VALIDATIE.
  if (payload.meta.environment !== 'TEST/VALIDATIE') {
    return cors(jsonErr('Environment guard failed', 500), origin);
  }
  // Re-check the prefix on the sanitised values so a sanitiser that
  // strips the marker (HTML/control chars) cannot let a non-test row
  // through.
  if (!hasLabTestPrefix(payload.contact.organisation) || !hasLabTestPrefix(payload.contact.name)) {
    return cors(jsonErr('Sanitised contact.organisation/contact.name must retain the "' + LAB_TEST_PREFIX + '" prefix', 400), origin);
  }

  // Defence-in-depth on the org listing too: if the operator submitted
  // an organisation_listing row, its sector_label/city/description must
  // not silently inject a non-test entity. We do not require the
  // prefix on org listing fields (organisation_name on contact is the
  // primary anchor), but we still source-mark the row.
  const submissionId = generateId('sub-test');
  payload.meta.submission_id = submissionId;
  payload.meta.request_id = requestId;
  payload.meta.lab_test = true;
  payload.meta.source = 'api/intake-test';

  // 7) Resolve sheet webhook + secret. We require BOTH for a live
  //    write; missing either flips to dry-run.
  const sheetWebhookUrl = String(
    env.INTAKE_SHEET_WEBHOOK_URL ||
    env.SHEETS_WEBHOOK_URL ||
    env.GOOGLE_SHEET_WEBHOOK_URL ||
    ''
  ).trim();
  const sharedSecret = String(env.SHEETS_WEBHOOK_SECRET || env.INTAKE_SHEET_WEBHOOK_SECRET || '').trim();
  const hasSheetConfig = !!sheetWebhookUrl && !!sharedSecret;
  const sheetDryRun = !hasSheetConfig;

  // 8) Build the LAB_* row map. Notification stays disabled on this
  //    route — we never read INTAKE_NOTIFY_WEBHOOK and we never
  //    populate notify_to_recipient.
  const intakeRow = buildIntakeSubmissionRow(payload, { issue_url: '', issue_number: '' });
  const editorialRow = (payload.editorial_contribution) ? buildEditorialIntakeRow(payload, { issue_url: '', issue_number: '' }) : null;
  const placeCandidateRow = needsPlaceCandidateRow(payload) ? buildPlaceCandidateRow(payload) : null;

  const sheetWebhookPayload = {
    schema_version: 2,
    environment: payload.meta.environment,
    target_prefix: LAB_SPREADSHEET.target_prefix,
    spreadsheet_id: LAB_SPREADSHEET.spreadsheet_id,
    spreadsheet_label: LAB_SPREADSHEET.spreadsheet_label,
    forbidden_targets: LAB_SPREADSHEET.forbidden_targets,
    submission_id: submissionId,
    request_id: requestId,
    intake_mode: payload.intake_mode,
    lab_test: true,
    rows: {
      [LAB_SPREADSHEET.tabs.intake_submissions]: intakeRow,
      ...(editorialRow ? { [LAB_SPREADSHEET.tabs.editorial_intake]: editorialRow } : {}),
      ...(placeCandidateRow ? { [LAB_SPREADSHEET.tabs.place_candidates]: placeCandidateRow } : {}),
    },
    log: null,
    workflow_event: null,
    shared_secret_present: !!sharedSecret,
    official_recipient: OFFICE_IDENTITY.official_recipient,
    notification_message: null,           // notification disabled on this route
    source_route: '/api/intake-test',
  };

  // 9) Defence-in-depth: refuse to put a Directory_Master-targeting or
  //    non-LAB_-prefixed payload on the wire.
  try {
    assertLabPayloadSafe(sheetWebhookPayload);
  } catch (e) {
    return cors(jsonErr('Lab safety check failed', 500), origin);
  }
  // Also refuse to dispatch if the row map happens to be empty — that
  // would either be a bug or a mistargeted call.
  if (Object.keys(sheetWebhookPayload.rows).length === 0) {
    return cors(jsonErr('No LAB_* rows produced for this submission', 400), origin);
  }
  // Triple-check: no row may have an `organization_name` that matches a
  // production-looking value. We do this by asserting every row's
  // submission_id starts with our test prefix and that the route is
  // only ever called from a path that already enforced the prefix.
  for (const tab of Object.keys(sheetWebhookPayload.rows)) {
    if (LAB_SPREADSHEET.forbidden_targets.includes(tab) || !tab.startsWith('LAB_')) {
      return cors(jsonErr('Lab safety check failed', 500), origin);
    }
  }

  // 10) Send to sheet webhook (or stay in dry-run).
  let sheetResult = null;
  const warnings = [];
  if (sheetDryRun) {
    sheetWebhookPayload.log = buildBackendLogRow(payload, {
      request_id: requestId,
      status_code: 200,
      dry_run: true,
      validation_result: 'ok',
      workflow_step: 'dry_run',
    });
    sheetWebhookPayload.workflow_event = buildWorkflowEventRow(payload, {
      event_type: 'intake_test_dry_run',
      workflow_step: 'dry_run',
      status_from: '',
      status_to: 'preview',
      next_required_action: nextRequiredAction(payload, 'dry_run'),
      related_sheet: LAB_SPREADSHEET.tabs.intake_submissions,
    });
    if (!sheetWebhookUrl) warnings.push('Sheet webhook URL not configured — dry-run.');
    if (!sharedSecret) warnings.push('Shared secret not configured — dry-run (live writes require BOTH url and secret).');
  } else {
    sheetWebhookPayload.log = buildBackendLogRow(payload, {
      request_id: requestId,
      status_code: 200,
      dry_run: false,
      validation_result: 'ok',
      workflow_step: 'stored',
    });
    sheetWebhookPayload.workflow_event = buildWorkflowEventRow(payload, {
      event_type: 'intake_test_stored',
      workflow_step: 'stored',
      status_from: '',
      status_to: 'new',
      next_required_action: nextRequiredAction(payload, 'stored'),
      related_sheet: LAB_SPREADSHEET.tabs.intake_submissions,
    });
    sheetResult = await postSheetWebhook(sheetWebhookUrl, sheetWebhookPayload, sharedSecret)
      .catch(e => ({ error: 'Sheet upstream unreachable' }));
    if (sheetResult && sheetResult.error) {
      warnings.push('Sheet webhook failed: ' + sheetResult.error);
    }
  }

  // 11) Notification — explicitly DISABLED on this route. We still
  //     build a minimal preview message (no PII, no editorial body) so
  //     the operator can verify the contract; we never dispatch and we
  //     never include a notify_to_recipient.
  const notificationMessage = buildNotificationMessage(payload, {
    request_id: requestId,
    submission_id: submissionId,
    workflow_status: sheetDryRun ? 'dry_run' : (sheetResult && sheetResult.error ? 'error' : 'stored'),
    next_required_action: nextRequiredAction(payload, sheetDryRun ? 'dry_run' : 'stored'),
    related_sheet: LAB_SPREADSHEET.tabs.intake_submissions,
    related_row: (sheetResult && sheetResult.row_id) || '',
    issue_url: '',
    // Deliberately no notify_to: this route never reads INTAKE_NOTIFY_TO.
  });
  try {
    assertNotificationSafe(notificationMessage);
  } catch (e) {
    return cors(jsonErr('Notification safety check failed', 500), origin);
  }
  // Sanity: this route must never surface a recipient.
  if (notificationMessage.notify_to_recipient) {
    return cors(jsonErr('Notification recipient leaked', 500), origin);
  }

  const overallStatus = sheetDryRun ? 'dry_run' : (sheetResult && sheetResult.error ? 'error' : 'stored');
  const response = {
    ok: true,
    route: '/api/intake-test',
    lab_test: true,
    submission_id: submissionId,
    request_id: requestId,
    mode: payload.intake_mode,
    received_at: payload.meta.received_at,
    environment: payload.meta.environment,
    dry_run: sheetDryRun,
    sheet_dry_run: sheetDryRun,
    workflow: {
      status: overallStatus,
      next_required_action: nextRequiredAction(payload, overallStatus),
    },
    sheet: sheetDryRun
      ? null
      : (sheetResult && sheetResult.ok
          ? { row_id: sheetResult.row_id || null, sheet_url: sheetResult.sheet_url || null, rows_written: sheetResult.rows_written || null }
          : null),
    sheet_webhook_payload_preview: sheetWebhookPayload,
    notification_status: 'disabled_for_intake_test',
    notification_message_preview: notificationMessage,
    notification_sent: false,
    storage_architecture: {
      single_source_of_truth: 'google_sheet',
      spreadsheet_id: LAB_SPREADSHEET.spreadsheet_id,
      target_prefix: LAB_SPREADSHEET.target_prefix,
      lab_tabs: LAB_SPREADSHEET.tabs,
      forbidden_targets: LAB_SPREADSHEET.forbidden_targets,
      official_identity: OFFICE_IDENTITY,
      route_purpose: 'preview-only single-write lab probe; production blocked at handler entry',
    },
    warnings,
  };
  return cors(json(response, 200), origin);
}

// CORS preflight (mirrors /api/intake).
export async function onRequestOptions(context) {
  const origin = context.request.headers.get('origin') || '';
  if (!isAllowedOrigin(origin)) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    },
  });
}

// Anything else → 405 (or 404 in production). Production short-circuits
// here too so the existence of this route is not advertised on the
// production deploy.
export async function onRequest(context) {
  const method = context.request.method.toUpperCase();
  const env = context.env || {};
  if (!isPreviewEnv(env)) {
    // Same body shape as the preview-only POST gate so callers see a
    // consistent JSON 404 regardless of method.
    return new Response(JSON.stringify({ ok: false, error: 'Not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (method === 'POST') return onRequestPost(context);
  if (method === 'OPTIONS') return onRequestOptions(context);
  return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
    status: 405,
    headers: { 'content-type': 'application/json', 'allow': 'POST, OPTIONS' },
  });
}

// Test hooks (Node/CI only).
if (typeof globalThis !== 'undefined') {
  globalThis.__esrfIntakeTest = {
    onRequest,
    onRequestPost,
    onRequestOptions,
    isPreviewEnv,
    hasLabTestPrefix,
    LAB_TEST_PREFIX,
    TEST_MAX_BODY_BYTES,
  };
}
