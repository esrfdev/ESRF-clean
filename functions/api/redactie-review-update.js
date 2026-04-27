// Cloudflare Pages Function — POST /api/redactie-review-update
//
// Preview-only LAB review-write endpoint. Two modes:
//
//   • Sample / dry-run (default, when env vars are absent): builds the
//     canonical review-update payload and returns it in `payload` /
//     `would_write`. NOTHING is sent to Apps Script. The response carries
//     `dry_run: true`, `live_write_ready: false`, and an explicit
//     `activation_required` list so the operator knows what is missing.
//
//   • Live save (preview only, when ALL env vars are present):
//       - REDACTIE_REVIEW_ACCESS_CODE valid (gates the request)
//       - REDACTIE_REVIEW_WEBHOOK_URL set (Apps Script /exec)
//       - REDACTIE_REVIEW_WEBHOOK_SECRET set (shared with Apps Script)
//       - REDACTIE_REVIEW_WRITE_ENABLED=true (explicit toggle)
//     The endpoint then forwards a sanitised payload to the Apps Script
//     webhook with `action: "submit_review_update"`. The Apps Script
//     appends one row to LAB_Redactie_Reviews and one row to
//     LAB_Workflow_Events. Directory_Master is hard-refused both here
//     and inside Apps Script.
//
// Security contract (preserved on every code path):
//   - Preview-only: production short-circuits to 404.
//   - Origin allowlist: same as /api/intake.
//   - target_tab must start with LAB_ and be in ALLOWED_REVIEW_TARGET_TABS.
//     Directory_Master is in `forbidden_targets` and refused both before
//     and after the Apps Script round-trip.
//   - Contact details and forbidden keys are stripped from the payload
//     before it leaves Cloudflare. Even if the caller smuggles `contact`
//     or `raw_payload_json` into edited_publication_proposal /
//     original_reference, those keys never reach Apps Script.
//   - `include_contact` defaults to false; the live-write path forces
//     contact-stripping regardless of what the caller sends.
//   - Webhook URL/secret are server-side only — never echoed in the
//     response. The forbidden-key filter strips them defensively.

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
const UPDATE_FETCH_TIMEOUT_MS = 10000;

// Allowed LAB_* targets for review/status/event writes. Directory_Master
// is explicitly forbidden by LAB_SPREADSHEET.forbidden_targets, but we
// also enumerate the allowed set so a typo cannot become a write to a
// new tab we have not reviewed.
const ALLOWED_REVIEW_TARGET_TABS = [
  LAB_SPREADSHEET.tabs.intake_submissions, // status columns only
  LAB_SPREADSHEET.tabs.editorial_intake,   // status columns only
  LAB_SPREADSHEET.tabs.workflow_events,    // append-only event log
  'LAB_Redactie_Reviews',                  // append-only review audit
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

// Record types we accept for a redactie review save. `org` and `editorial`
// remain the canonical values for new-listing and editorial intake. The
// `change_request` and `hide_delete` values cover wijzigingsverzoeken on
// existing Directory listings — the redactie review is still saved into
// LAB_Redactie_Reviews + LAB_Workflow_Events. Directory_Master is never
// touched on any of these record types; that contract is enforced by the
// target_tab guard, the forbidden_targets list, and Apps Script itself.
const ALLOWED_RECORD_TYPES = ['org', 'editorial', 'change_request', 'hide_delete'];

// Documented redactie decision values for change-request reviews. Mirrors
// REDACTIE_CR_DECISIONS in redactie-validation.html. Empty string is also
// accepted so the redactie can save a draft review without a final decision.
const ALLOWED_REDACTIE_DECISIONS = ['', 'approve', 'reject', 'request_clarification'];

// Documented requested-action values from the visitor change-request form.
// `update` is the bijwerken path; `hide` and `delete` are the hide_delete
// paths. Empty string is tolerated for legacy rows that did not record an
// explicit action.
const ALLOWED_REQUESTED_ACTIONS = ['', 'update', 'hide', 'delete'];

// Sub-modes the visitor form distinguishes for change requests. `change_request`
// = bijwerken; `hide_delete` = verbergen of verwijderen.
const ALLOWED_SUB_MODES = ['', 'change_request', 'hide_delete'];

// Documented requester-authorization values. Mirrors REQUESTER_AUTH_LABELS
// in redactie-validation.html and the LAB_Change_Requests intake form.
const ALLOWED_REQUESTER_AUTH = ['', 'authorized_representative', 'employee', 'external_observer'];

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
  if (ALLOWED_RECORD_TYPES.indexOf(recordType) === -1) {
    errors.push('record_type must be one of: ' + ALLOWED_RECORD_TYPES.join(', '));
  }

  const isChangeRequest = recordType === 'change_request' || recordType === 'hide_delete';

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

  // ── Change-request review block ────────────────────────────────────────
  // Only built when the record_type signals a wijzigingsverzoek. The block
  // captures the redactie decision, the requested action, the target listing
  // identity, the requested change/reason/evidence summary, and the
  // submitter's authorisation role/confirmation. Contact PII is stripped
  // upstream (frontend never sends it; we strip again here as defence).
  const crReviewIn = body.change_request_review && typeof body.change_request_review === 'object'
    ? body.change_request_review
    : {};
  const redactieDecision = sanitize(crReviewIn.redactie_decision || body.redactie_decision);
  if (isChangeRequest && redactieDecision && ALLOWED_REDACTIE_DECISIONS.indexOf(redactieDecision) === -1) {
    errors.push('change_request_review.redactie_decision is not in the allowed set');
  }
  const requestedAction = sanitize(crReviewIn.requested_action || body.requested_action).toLowerCase();
  if (isChangeRequest && requestedAction && ALLOWED_REQUESTED_ACTIONS.indexOf(requestedAction) === -1) {
    errors.push('change_request_review.requested_action is not in the allowed set');
  }
  const subMode = sanitize(crReviewIn.sub_mode || body.sub_mode).toLowerCase();
  if (isChangeRequest && subMode && ALLOWED_SUB_MODES.indexOf(subMode) === -1) {
    errors.push('change_request_review.sub_mode is not in the allowed set');
  }
  const requesterAuth = sanitize(crReviewIn.requester_authorization || body.requester_authorization);
  if (isChangeRequest && requesterAuth && ALLOWED_REQUESTER_AUTH.indexOf(requesterAuth) === -1) {
    errors.push('change_request_review.requester_authorization is not in the allowed set');
  }
  const authConfirm = sanitize(crReviewIn.authorization_confirmation || body.authorization_confirmation).toLowerCase();
  // Tolerate yes/no/'' — stored verbatim in the review row.
  const authConfirmSafe = (authConfirm === 'yes' || authConfirm === 'no') ? authConfirm : '';

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

  const changeRequestReview = isChangeRequest ? stripForbiddenKeys(stripContact({
    redactie_decision: redactieDecision || '',
    redactie_decision_reason: sanitizeLong(crReviewIn.redactie_decision_reason || body.redactie_decision_reason),
    requested_action: requestedAction || '',
    sub_mode: subMode || (recordType === 'hide_delete' ? 'hide_delete' : 'change_request'),
    target_listing_name: sanitize(crReviewIn.target_listing_name || body.target_listing_name),
    target_listing_url: sanitize(crReviewIn.target_listing_url || body.target_listing_url),
    change_description: sanitizeLong(crReviewIn.change_description || body.change_description),
    change_description_existing: sanitizeLong(crReviewIn.change_description_existing || body.change_description_existing),
    change_description_requested: sanitizeLong(crReviewIn.change_description_requested || body.change_description_requested),
    reason: sanitizeLong(crReviewIn.reason || body.reason),
    evidence_url: sanitize(crReviewIn.evidence_url || body.evidence_url),
    requester_authorization: requesterAuth || '',
    authorization_confirmation: authConfirmSafe,
  })) : null;

  // Default source_tab depends on the record type. Editorial flows the
  // editorial intake tab; org keeps the org intake tab; change requests
  // live in LAB_Change_Requests (or LAB_Intake_Submissions in the legacy
  // deployment — the frontend forwards whatever it read from the row).
  let defaultSourceTab;
  if (recordType === 'editorial') defaultSourceTab = LAB_SPREADSHEET.tabs.editorial_intake;
  else if (isChangeRequest) defaultSourceTab = 'LAB_Change_Requests';
  else defaultSourceTab = LAB_SPREADSHEET.tabs.intake_submissions;

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
      reviewer: sanitize(review.reviewer || review.assigned_to || body.edited_by),
    },
    process_step_reminder: reminder,
    edited_publication_proposal: proposalSafe || undefined,
    original_reference: originalSafe || undefined,
    change_request_review: changeRequestReview || undefined,
    changed_fields: changedFields,
    change_note: sanitizeLong((editedProposal && editedProposal.change_note) || body.change_note),
    edited_by: sanitize((editedProposal && editedProposal.edited_by) || body.edited_by),
    source_tab: sanitize(body.source_tab) || defaultSourceTab,
    contact_disclosed: false,
    directory_master_touched: false,
    automatic_publication: false,
    warning: 'LAB only · append-only naar LAB_Redactie_Reviews + LAB_Workflow_Events. Originele inzending blijft staan; Directory_Master wordt nooit aangeraakt; geen automatische publicatie.',
  };

  return { errors: errors, payload: payload };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(function(){ ctrl.abort(); }, timeoutMs);
  try {
    return await fetch(url, Object.assign({}, options, { signal: ctrl.signal }));
  } finally {
    clearTimeout(timer);
  }
}

async function forwardSubmitReviewUpdate(env, payload, requestId) {
  const url = String(env.REDACTIE_REVIEW_WEBHOOK_URL || '').trim();
  const secret = String(env.REDACTIE_REVIEW_WEBHOOK_SECRET || '').trim();
  if (!url || !secret) {
    return { ok: false, error: 'webhook_not_configured' };
  }

  // Hard target-tab guard before anything leaves Cloudflare. Apps Script
  // also refuses Directory_Master, but defence-in-depth: do not even
  // make the network call if the target tab is unsafe.
  const targetTab = String(payload.target_tab || '');
  if (LAB_SPREADSHEET.forbidden_targets.indexOf(targetTab) !== -1) {
    return { ok: false, error: 'forbidden_target_tab' };
  }
  if (!targetTab.startsWith(LAB_SPREADSHEET.target_prefix)) {
    return { ok: false, error: 'non_lab_target_tab' };
  }

  // The body sent to Apps Script. NOTE:
  //   - include_contact is hard-coded false here. The Cloudflare layer
  //     never asks Apps Script to include contact PII on a save.
  //   - shared_secret is the only auth surface; never echoed back.
  //   - We only forward the sanitised review/edit/original blocks the
  //     buildReviewUpdatePayload pipeline produced. Contact and
  //     forbidden keys have already been stripped.
  //   - target_tab on the outbound payload is always LAB_Redactie_Reviews:
  //     reviews are append-only into the review audit tab. The status
  //     columns of the *source* tab (LAB_Intake_Submissions or
  //     LAB_Editorial_Intake) are reflected by source_tab, and the
  //     workflow_events tab is appended by Apps Script.
  const outbound = {
    schema_version: 1,
    action: 'submit_review_update',
    shared_secret: secret,
    request_id: requestId,
    submission_id: payload.submission_id,
    record_type: payload.record_type,
    source_tab: payload.source_tab || targetTab,
    target_tab: 'LAB_Redactie_Reviews',
    review_update: payload.review_update || {},
    edited_publication_proposal: payload.edited_publication_proposal || undefined,
    original_reference: payload.original_reference || undefined,
    change_request_review: payload.change_request_review || undefined,
    changed_fields: payload.changed_fields || [],
    change_note: payload.change_note || '',
    edited_by: payload.edited_by || '',
    include_contact: false,
  };

  let res;
  try {
    res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(outbound),
    }, UPDATE_FETCH_TIMEOUT_MS);
  } catch (e) {
    return { ok: false, error: 'upstream_unreachable' };
  }
  if (!res.ok) {
    return { ok: false, error: 'upstream_status_' + res.status };
  }
  let data;
  try { data = await res.json(); }
  catch { return { ok: false, error: 'upstream_invalid_json' }; }
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'upstream_invalid_shape' };
  }
  if (data.ok !== true) {
    return { ok: false, error: 'upstream_refused', upstream: stripForbiddenKeys(data) };
  }
  return { ok: true, upstream: stripForbiddenKeys(data) };
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

  // Live write is gated behind FOUR conditions, all required:
  //   1. REDACTIE_REVIEW_WRITE_ENABLED = "true" (explicit toggle)
  //   2. REDACTIE_REVIEW_WEBHOOK_URL configured
  //   3. REDACTIE_REVIEW_WEBHOOK_SECRET configured
  //   4. Access code valid
  const writeEnabledRaw = String(env.REDACTIE_REVIEW_WRITE_ENABLED || '').trim().toLowerCase();
  const wantsLiveWrite = writeEnabledRaw === 'true' || writeEnabledRaw === '1' || writeEnabledRaw === 'yes';
  const writeWebhook = String(env.REDACTIE_REVIEW_WEBHOOK_URL || '').trim();
  const writeSecret = String(env.REDACTIE_REVIEW_WEBHOOK_SECRET || '').trim();
  const liveWriteReady = wantsLiveWrite && !!writeWebhook && !!writeSecret && accessValid;

  // Build the canonical activation list — surfaced verbatim in the
  // response so the operator can audit which env var is missing.
  const activation_required = [
    'REDACTIE_REVIEW_ACCESS_CODE env var (gates the request)',
    'REDACTIE_REVIEW_WEBHOOK_URL env var (Apps Script /exec)',
    'REDACTIE_REVIEW_WEBHOOK_SECRET env var (shared secret)',
    'REDACTIE_REVIEW_WRITE_ENABLED=true env var (explicit live-write toggle)',
    'Apps Script Web App limited to LAB_Redactie_Reviews + LAB_Workflow_Events append; never Directory_Master',
  ];

  // ── Sample / dry-run path: live write NOT ready ────────────────────────
  if (!liveWriteReady) {
    let blockReason;
    if (!accessConfigured) {
      blockReason = 'access code not configured — opslaan is nog niet actief; er wordt niets opgeslagen';
    } else if (!accessValid) {
      blockReason = 'access code missing or incorrect — opslaan is nog niet actief; er wordt niets opgeslagen';
    } else if (!wantsLiveWrite) {
      blockReason = 'REDACTIE_REVIEW_WRITE_ENABLED is not set to true — opslaan is nog niet actief; er wordt niets opgeslagen';
    } else if (!writeWebhook || !writeSecret) {
      blockReason = 'webhook URL or secret not configured — opslaan is nog niet actief; er wordt niets opgeslagen';
    } else {
      blockReason = 'opslaan is nog niet actief; er wordt niets opgeslagen';
    }

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
      live_write_ready: false,
      live_write_blocked_reason: blockReason,
      save_status: 'not_saved',
      save_message: 'Opslaan is nog niet actief; er wordt niets opgeslagen.',
      would_write: {
        target_tab: built.payload.target_tab,
        submission_id: built.payload.submission_id,
        review_status: built.payload.review_update.review_status,
        process_step: built.payload.review_update.process_step,
      },
      payload: built.payload,
      activation_required: activation_required,
      target_prefix: LAB_SPREADSHEET.target_prefix,
      forbidden_targets: LAB_SPREADSHEET.forbidden_targets,
      directory_master_touched: false,
      automatic_publication: false,
      warning: 'LAB only · dry-run · geen automatische publicatie · Directory_Master niet aanpassen.',
      request_id: requestId,
    }, 200), origin);
  }

  // ── Live write path ────────────────────────────────────────────────────
  // All four gates passed. Forward the sanitised payload to Apps Script
  // with action: "submit_review_update". Apps Script appends one row to
  // LAB_Redactie_Reviews and one row to LAB_Workflow_Events. Never
  // Directory_Master — both Cloudflare and Apps Script enforce this.
  const fwd = await forwardSubmitReviewUpdate(env, built.payload, requestId);
  if (!fwd.ok) {
    return cors(json({
      ok: false,
      mode: 'lab',
      access: { configured: true, valid: true, message: 'access code valid · live write attempted' },
      dry_run: false,
      live_write_ready: true,
      save_status: 'failed',
      save_message: 'Opslaan in LAB-tabbladen is mislukt. Niets is geschreven. Probeer opnieuw of meld dit aan beheer.',
      upstream_error: fwd.error,
      upstream: fwd.upstream || undefined,
      would_write: {
        target_tab: built.payload.target_tab,
        submission_id: built.payload.submission_id,
        review_status: built.payload.review_update.review_status,
        process_step: built.payload.review_update.process_step,
      },
      directory_master_touched: false,
      automatic_publication: false,
      warning: 'LAB only · upstream save failed · Directory_Master niet aangeraakt · niets gepubliceerd.',
      request_id: requestId,
    }, 502), origin);
  }

  // Success — Apps Script appended rows to LAB_Redactie_Reviews and
  // LAB_Workflow_Events. The original inzending stays untouched in its
  // source tab; Directory_Master was never targeted.
  const upstream = fwd.upstream || {};
  const updateResult = (upstream.update_result && typeof upstream.update_result === 'object') ? upstream.update_result : {};

  return cors(json({
    ok: true,
    mode: 'lab',
    access: { configured: true, valid: true, message: 'access code valid · live save complete' },
    dry_run: false,
    live_write_ready: true,
    save_status: 'saved',
    save_message: 'Opgeslagen in LAB_Redactie_Reviews; gebeurtenis vastgelegd in LAB_Workflow_Events. Originele inzending ongewijzigd. Directory_Master ongewijzigd.',
    saved_to: {
      review_tab: 'LAB_Redactie_Reviews',
      events_tab: LAB_SPREADSHEET.tabs.workflow_events,
      review_id: updateResult.review_id || '',
      target_tab: updateResult.target_tab || built.payload.target_tab,
      rows_written: typeof updateResult.rows_written === 'number' ? updateResult.rows_written : undefined,
    },
    would_write: {
      target_tab: built.payload.target_tab,
      submission_id: built.payload.submission_id,
      review_status: built.payload.review_update.review_status,
      process_step: built.payload.review_update.process_step,
    },
    target_prefix: LAB_SPREADSHEET.target_prefix,
    forbidden_targets: LAB_SPREADSHEET.forbidden_targets,
    directory_master_touched: false,
    automatic_publication: false,
    warning: 'LAB only · live save · originele inzending ongewijzigd · Directory_Master niet aangeraakt · geen automatische publicatie.',
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
  ALLOWED_RECORD_TYPES,
  ALLOWED_REDACTIE_DECISIONS,
  ALLOWED_REQUESTED_ACTIONS,
  ALLOWED_SUB_MODES,
  ALLOWED_REQUESTER_AUTH,
  isLabTab,
  buildReviewUpdatePayload,
  forwardSubmitReviewUpdate,
};

if (typeof globalThis !== 'undefined') {
  globalThis.__esrfRedactieReviewUpdateApi = {
    ALLOWED_REVIEW_TARGET_TABS,
    ALLOWED_PROCESS_STEPS,
    ALLOWED_REVIEW_STATUSES,
    ALLOWED_RECORD_TYPES,
    ALLOWED_REDACTIE_DECISIONS,
    ALLOWED_REQUESTED_ACTIONS,
    ALLOWED_SUB_MODES,
    ALLOWED_REQUESTER_AUTH,
    isLabTab,
    buildReviewUpdatePayload,
    forwardSubmitReviewUpdate,
    onRequest,
    onRequestPost,
  };
}
