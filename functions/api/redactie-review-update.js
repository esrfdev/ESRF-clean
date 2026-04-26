// Cloudflare Pages Function — POST /api/redactie-review-update
//
// Preview-only LAB *dry-run* endpoint that builds the canonical review-
// update payload the redactie page would normally have to copy/paste
// into the Drive spreadsheet by hand. This route:
//
//   - Is gated by REDACTIE_REVIEW_ACCESS_CODE just like the read route.
//   - NEVER writes anywhere by default. It only validates the payload
//     and returns a sanitised, audit-shaped object that the operator
//     would paste into the LAB_* row.
//   - Refuses to target Directory_Master or any non-LAB_* tab. The
//     `target_tab` field on the request must start with the LAB_
//     prefix and be one of the documented review/status/event tabs.
//   - Strips contact details and forbidden keys from the payload.
//   - Surfaces a `dry_run: true` flag and a `would_write` summary so
//     the redactie can audit exactly what would be written if a real
//     write endpoint were ever activated.
//
// Live writes are intentionally NOT enabled. We document the contract
// here so the next safe step (a write-capable Apps Script Web App
// limited to LAB_Workflow_Events / status columns) has a single
// canonical payload to consume. If/when a write webhook becomes safe,
// the activation steps are listed in docs/redactie-validation-form.md
// and require an explicit env var (REDACTIE_REVIEW_WRITE_ENABLED=true)
// AND the webhook URL/secret. Until then this endpoint is dry-run only.

import {
  isAllowedOrigin,
  cors,
  json,
  jsonErr,
  generateId,
  sanitize,
  sanitizeLong,
  LAB_SPREADSHEET,
  MAX_BODY_BYTES,
} from './intake.js';

import {
  STATUS_STEP_REMINDERS,
  stripContact,
  stripForbiddenKeys,
  constantTimeEquals,
  isPreviewEnv,
} from './redactie-review.js';

// ── Config ───────────────────────────────────────────────────────────────

const UPDATE_MAX_BODY_BYTES = Math.min(MAX_BODY_BYTES, 32768); // 32 KiB cap

// Allowed LAB_* targets for review/status/event writes. Directory_Master
// is explicitly forbidden by LAB_SPREADSHEET.forbidden_targets, but we
// also enumerate the allowed set so a typo cannot become a write to a
// new tab we have not reviewed.
const ALLOWED_REVIEW_TARGET_TABS = [
  LAB_SPREADSHEET.tabs.intake_submissions, // status columns only
  LAB_SPREADSHEET.tabs.editorial_intake,   // status columns only
  LAB_SPREADSHEET.tabs.workflow_events,    // append-only event log
];

// Process steps and review statuses we accept. Mirrors the dropdowns in
// redactie-validation.html — the API is the authoritative source so
// the UI cannot smuggle a status string we have not reviewed.
const ALLOWED_PROCESS_STEPS = [
  'binnengekomen', 'in_review', 'wachten_op_indiener',
  'klaar_voor_akkoord', 'akkoord_voor_promote',
  'afgewezen', 'gearchiveerd',
];
const ALLOWED_REVIEW_STATUSES = [
  'in_review', 'pending_clarification',
  'approved_for_candidate', 'approved_for_directory_candidate',
  'approved_for_draft', 'approved_lab_promote',
  'rejected',
];

// ── Helpers ──────────────────────────────────────────────────────────────

function isLabTab(name) {
  if (!name || typeof name !== 'string') return false;
  if (LAB_SPREADSHEET.forbidden_targets.indexOf(name) !== -1) return false;
  if (!name.startsWith(LAB_SPREADSHEET.target_prefix)) return false;
  return ALLOWED_REVIEW_TARGET_TABS.indexOf(name) !== -1;
}

function buildReviewUpdatePayload(body) {
  const errors = [];

  const submissionId = sanitize(body.submission_id);
  if (!submissionId) errors.push('submission_id required');

  const recordType = sanitize(body.record_type);
  if (recordType !== 'org' && recordType !== 'editorial') {
    errors.push('record_type must be "org" or "editorial"');
  }

  const targetTab = sanitize(body.target_tab);
  if (!isLabTab(targetTab)) {
    errors.push('target_tab must be a documented LAB_* review/status/event tab');
  }

  const review = body.review_update && typeof body.review_update === 'object'
    ? body.review_update
    : {};
  const processStep = sanitize(review.process_step);
  if (processStep && ALLOWED_PROCESS_STEPS.indexOf(processStep) === -1) {
    errors.push('review_update.process_step is not in the allowed set');
  }
  const reviewStatus = sanitize(review.review_status);
  if (reviewStatus && ALLOWED_REVIEW_STATUSES.indexOf(reviewStatus) === -1) {
    errors.push('review_update.review_status is not in the allowed set');
  }

  const editedProposal = body.edited_publication_proposal && typeof body.edited_publication_proposal === 'object'
    ? body.edited_publication_proposal
    : null;

  const originalReference = body.original_reference && typeof body.original_reference === 'object'
    ? body.original_reference
    : null;

  // Strip contact and forbidden keys aggressively from BOTH proposal and
  // original_reference — this endpoint never accepts contact info, even
  // if the caller tries to send it. The frontend gates that separately.
  const proposalSafe = editedProposal ? stripForbiddenKeys(stripContact(editedProposal)) : null;
  const originalSafe = originalReference ? stripForbiddenKeys(stripContact(originalReference)) : null;

  const changedFields = Array.isArray(body.changed_fields)
    ? body.changed_fields.filter(function(s){ return typeof s === 'string'; }).slice(0, 64)
    : [];

  const reminder = STATUS_STEP_REMINDERS[processStep] || '';

  const payload = {
    submission_id: submissionId,
    record_type: recordType || '',
    target_tab: targetTab || '',
    target_prefix: LAB_SPREADSHEET.target_prefix,
    forbidden_targets: LAB_SPREADSHEET.forbidden_targets,
    environment: 'TEST/VALIDATIE',
    review_update: {
      process_step: processStep || '',
      review_status: reviewStatus || '',
      reminder: sanitizeLong(review.reminder) || reminder,
      next_required_action: sanitize(review.next_required_action),
      assigned_to: sanitize(review.assigned_to),
      due_date: sanitize(review.due_date),
      review_notes_internal: sanitizeLong(review.review_notes_internal),
    },
    process_step_reminder: reminder,
    edited_publication_proposal: proposalSafe || undefined,
    original_reference: originalSafe || undefined,
    changed_fields: changedFields,
    change_note: sanitizeLong((editedProposal && editedProposal.change_note) || body.change_note),
    edited_by: sanitize((editedProposal && editedProposal.edited_by) || body.edited_by),
    contact_disclosed: false,
    directory_master_touched: false,
    automatic_publication: false,
    warning: 'LAB only · dry-run · geen automatische publicatie · Directory_Master niet aanpassen. Plak handmatig in de juiste LAB_*-rij.',
  };

  return { errors: errors, payload: payload };
}

// ── Main handler ─────────────────────────────────────────────────────────

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('origin') || '';
  const requestId = generateId('req-redactie-update');

  if (!isPreviewEnv(env)) {
    return cors(jsonErr('Not found', 404), origin);
  }
  if (!isAllowedOrigin(origin)) {
    return cors(jsonErr('Forbidden origin', 403), origin);
  }

  const contentType = (request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return cors(jsonErr('Content-Type must be application/json', 415), origin);
  }
  const raw = await request.text();
  if (raw.length > UPDATE_MAX_BODY_BYTES) {
    return cors(jsonErr('Payload too large', 413), origin);
  }
  let body;
  try { body = JSON.parse(raw); }
  catch { return cors(jsonErr('Invalid JSON', 400), origin); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return cors(jsonErr('Invalid JSON body', 400), origin);
  }

  const expectedAccessCode = String(env.REDACTIE_REVIEW_ACCESS_CODE || '').trim();
  const accessCode = String(body.access_code || '').trim();
  const accessConfigured = !!expectedAccessCode;
  const accessValid = accessConfigured && accessCode.length > 0
    && constantTimeEquals(expectedAccessCode, accessCode);

  // Without a configured/valid access code we still build the dry-run
  // payload so the operator can inspect what would happen, but we
  // refuse to mark it as approved-for-write and we explicitly note
  // that no write would ever be attempted.
  const built = buildReviewUpdatePayload(body);
  if (built.errors.length > 0) {
    return cors(json({
      ok: false,
      mode: accessValid ? 'lab' : 'sample',
      errors: built.errors,
      directory_master_touched: false,
      automatic_publication: false,
      request_id: requestId,
    }, 400), origin);
  }

  // Live write is gated behind THREE conditions, all required:
  //   1. REDACTIE_REVIEW_WRITE_ENABLED = "true" (explicit toggle)
  //   2. REDACTIE_REVIEW_WEBHOOK_URL configured (read webhook reused)
  //   3. REDACTIE_REVIEW_WEBHOOK_SECRET configured
  //   4. Access code valid (already enforced above for "lab" mode)
  //
  // If ANY of those is missing we return a dry-run-only response. We
  // do NOT implement the live write path on this branch — the contract
  // is documented for the next reviewable step.
  const writeEnabled = String(env.REDACTIE_REVIEW_WRITE_ENABLED || '').trim().toLowerCase();
  const wantsLiveWrite = writeEnabled === 'true' || writeEnabled === '1' || writeEnabled === 'yes';
  const writeWebhook = String(env.REDACTIE_REVIEW_WEBHOOK_URL || '').trim();
  const writeSecret = String(env.REDACTIE_REVIEW_WEBHOOK_SECRET || '').trim();
  const liveWriteReady = wantsLiveWrite && !!writeWebhook && !!writeSecret && accessValid;

  return cors(json({
    ok: true,
    mode: accessValid ? 'lab' : 'sample',
    access: {
      configured: accessConfigured,
      valid: accessValid,
      message: accessValid
        ? 'access code valid · dry-run payload built'
        : (accessConfigured
          ? 'review code missing or incorrect — dry-run payload only, no write'
          : 'access code not configured — dry-run payload only, no write'),
    },
    dry_run: true,
    live_write_ready: false, // hard-coded false on this branch
    live_write_blocked_reason: liveWriteReady
      ? 'live write disabled on this branch — write path is documented but not implemented'
      : 'live write not configured (requires REDACTIE_REVIEW_WRITE_ENABLED=true + webhook + secret + valid access code)',
    would_write: {
      target_tab: built.payload.target_tab,
      submission_id: built.payload.submission_id,
      review_status: built.payload.review_update.review_status,
      process_step: built.payload.review_update.process_step,
    },
    payload: built.payload,
    activation_required: liveWriteReady ? undefined : [
      'REDACTIE_REVIEW_ACCESS_CODE env var (gates the request)',
      'REDACTIE_REVIEW_WEBHOOK_URL env var (Apps Script /exec)',
      'REDACTIE_REVIEW_WEBHOOK_SECRET env var (shared secret)',
      'REDACTIE_REVIEW_WRITE_ENABLED=true env var (explicit live-write toggle)',
      'Apps Script Web App limited to LAB_* status columns / LAB_Workflow_Events append; never Directory_Master',
    ],
    target_prefix: LAB_SPREADSHEET.target_prefix,
    forbidden_targets: LAB_SPREADSHEET.forbidden_targets,
    directory_master_touched: false,
    automatic_publication: false,
    warning: 'LAB only · dry-run · plak handmatig in de juiste LAB_*-rij. Geen Directory_Master, geen e-mail, geen automatische publicatie.',
    request_id: requestId,
  }, 200), origin);
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('origin') || '';
  if (!isAllowedOrigin(origin)) return new Response(null, { status: 403 });
  return cors(new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600',
    },
  }), origin);
}

export async function onRequest(context) {
  const method = context.request.method;
  if (method === 'POST') return onRequestPost(context);
  if (method === 'OPTIONS') return onRequestOptions(context);
  return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
    status: 405,
    headers: { 'content-type': 'application/json', 'allow': 'POST, OPTIONS' },
  });
}

// ── Test hooks ───────────────────────────────────────────────────────────
export {
  ALLOWED_REVIEW_TARGET_TABS,
  ALLOWED_PROCESS_STEPS,
  ALLOWED_REVIEW_STATUSES,
  isLabTab,
  buildReviewUpdatePayload,
};

if (typeof globalThis !== 'undefined') {
  globalThis.__esrfRedactieReviewUpdateApi = {
    ALLOWED_REVIEW_TARGET_TABS,
    ALLOWED_PROCESS_STEPS,
    ALLOWED_REVIEW_STATUSES,
    isLabTab,
    buildReviewUpdatePayload,
    onRequest,
    onRequestPost,
  };
}
