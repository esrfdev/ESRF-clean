// Cloudflare Pages Function — POST /api/lab-intake
//
// Internal/editorial intake handler for the redactie-validation flow.
// Currently exposes a single mode:
//
//   editorial_add_org  — an editor adds a new organisation candidate to
//                        the review queue based on public sources. The
//                        org is NOT added to Directory_Master
//                        automatically; the candidate row goes through
//                        preview + Wouter approval before any rollout.
//
// LAB sheet architecture
// ----------------------
// The lab/redactie workflow uses dedicated LAB_-prefixed tabs in the
// same "ESRF Directory CRM" Google Sheet so that public submissions
// and editorial additions remain auditable side by side without ever
// touching Directory_Master:
//
//   - LAB_Intake_Submissions   one row per editorial intake
//   - LAB_Place_Candidates     one row per unknown city/place
//   - LAB_Redactie_Reviews     one row per editor decision/state-change
//   - LAB_Workflow_Events      one row per workflow event
//   - LAB_Backend_Log          one row per request, success or error
//
// Status vocabulary supported by LAB_Redactie_Reviews:
//   nieuw, in beoordeling, verduidelijking nodig, klaar voor akkoord,
//   goedgekeurd voor websitevoorstel, afgewezen, gepubliceerd
//
// New rows are written with editorial_status = "nieuw" and
// automatic_publication = "no". Directory_Master is never touched.
//
// Failure modes
// -------------
// If LAB_INTAKE_SHEET_WEBHOOK_URL (or its alias SHEETS_WEBHOOK_URL) is
// not configured the backend returns 503 with an explicit
// `auto_submit_unavailable: true` flag so the editor UI can show a
// clear "queue niet bereikbaar" message. No partial state is written.
//
// Authentication
// --------------
// The endpoint requires ONE of:
//   1. A Cloudflare Access assertion (Cf-Access-Jwt-Assertion).
//   2. A valid editorial session cookie (HMAC-signed timestamp issued by
//      /redactie/login).
//   3. An `x-esrf-intake-secret` header matching one of the configured
//      webhook secrets (preserves the existing server-to-server flow used
//      by trusted scripted callers).
//
// Without one of these the endpoint returns 401 — even a perfectly valid
// payload from an allowed origin is rejected. The auth check runs BEFORE
// any sheet write and BEFORE the body is parsed past the size check, so an
// unauthenticated caller cannot trigger any side effects.

import {
  isEditorialAuthorized,
  hasServerToServerSecret,
  buildApiAuthChallenge,
} from '../_editorial_auth.js';

const ALLOWED_ORIGINS = [
  'https://www.esrf.net',
  'https://esrf.net',
];
const ALLOWED_ORIGIN_SUFFIX = '.esrf-clean.pages.dev';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_FIELD_LENGTH = 600;
const MAX_LONG_FIELD_LENGTH = 2000;
const MIN_FORM_DURATION_MS = 1500;

const VALID_LAB_MODES = new Set(['editorial_add_org']);

const VALID_REDACTIE_STATUSES = new Set([
  'nieuw',
  'in beoordeling',
  'verduidelijking nodig',
  'klaar voor akkoord',
  'goedgekeurd voor websitevoorstel',
  'afgewezen',
  'gepubliceerd',
]);

const LAB_SHEET_TARGETS = {
  target_prefix: 'LAB_',
  tabs: {
    intake_submissions: 'LAB_Intake_Submissions',
    place_candidates: 'LAB_Place_Candidates',
    redactie_reviews: 'LAB_Redactie_Reviews',
    workflow_events: 'LAB_Workflow_Events',
    backend_log: 'LAB_Backend_Log',
  },
  forbidden_targets: ['Directory_Master'],
};

function assertLabSheetPayloadSafe(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('lab-payload-invalid: not an object');
  }
  const rows = payload.rows && typeof payload.rows === 'object' ? payload.rows : {};
  for (const tab of Object.keys(rows)) {
    if (LAB_SHEET_TARGETS.forbidden_targets.includes(tab)) {
      throw new Error('lab-payload-invalid: forbidden tab ' + tab);
    }
    if (!String(tab).startsWith('LAB_')) {
      throw new Error('lab-payload-invalid: non-LAB tab ' + tab);
    }
  }
  if (!Array.isArray(payload.forbidden_targets) ||
      !payload.forbidden_targets.includes('Directory_Master')) {
    throw new Error('lab-payload-invalid: Directory_Master missing from forbidden_targets');
  }
  if (payload.no_auto_publication !== true) {
    throw new Error('lab-payload-invalid: no_auto_publication must be true');
  }
  if (payload.directory_master_touched !== false) {
    throw new Error('lab-payload-invalid: directory_master_touched must be false');
  }
  if (payload.automatic_publication !== false) {
    throw new Error('lab-payload-invalid: automatic_publication must be false');
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('origin') || '';
  const requestId = generateId('req');

  if (!isAllowedOrigin(origin)) {
    return cors(jsonErr('Forbidden origin', 403), origin);
  }

  // Auth gate: require an editorial session OR a server-to-server secret.
  // This runs BEFORE any body parse / sheet write so unauthenticated
  // callers cannot trigger side effects.
  const editorialAuth = await isEditorialAuthorized(request, env);
  const s2s = hasServerToServerSecret(request, env);
  if (!editorialAuth.authorized && !s2s) {
    return cors(buildApiAuthChallenge(), origin);
  }

  const contentType = (request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return cors(jsonErr('Content-Type must be application/json', 415), origin);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return cors(jsonErr('Payload too large', 413), origin);
  }

  let body;
  try { body = JSON.parse(raw); }
  catch { return cors(jsonErr('Invalid JSON', 400), origin); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return cors(jsonErr('Invalid JSON body', 400), origin);
  }

  if (body.company_website_hp) {
    return cors(jsonErr('Invalid submission', 400), origin);
  }

  const elapsed = Number(body.form_duration_ms || 0);
  if (!Number.isFinite(elapsed) || elapsed < MIN_FORM_DURATION_MS) {
    return cors(jsonErr('Form submitted too quickly', 400), origin);
  }

  const sanitized = validateAndSanitizeLab(body);
  if (sanitized.error) {
    return cors(jsonErr(sanitized.error, 400), origin);
  }
  const payload = sanitized.payload;
  const submissionId = generateId('lab');
  payload.meta.submission_id = submissionId;
  payload.meta.request_id = requestId;

  const sheetWebhookUrl = String(
    env.LAB_INTAKE_SHEET_WEBHOOK_URL ||
    env.INTAKE_SHEET_WEBHOOK_URL ||
    env.SHEETS_WEBHOOK_URL ||
    ''
  ).trim();
  const sharedSecret = String(
    env.LAB_INTAKE_SHEET_WEBHOOK_SECRET ||
    env.SHEETS_WEBHOOK_SECRET ||
    env.INTAKE_SHEET_WEBHOOK_SECRET ||
    ''
  ).trim();

  if (!sheetWebhookUrl) {
    return cors(json({
      ok: false,
      auto_submit_unavailable: true,
      error: 'Lab intake backend is not configured. Vraag een beheerder om LAB_INTAKE_SHEET_WEBHOOK_URL te zetten.',
      request_id: requestId,
    }, 503), origin);
  }

  const intakeRow = buildLabIntakeSubmissionRow(payload);
  const reviewRow = buildLabRedactieReviewRow(payload);
  const placeCandidateRow = needsLabPlaceCandidateRow(payload)
    ? buildLabPlaceCandidateRow(payload) : null;
  const workflowEventRow = buildLabWorkflowEventRow(payload, {
    event_type: 'editorial_add_org_received',
    workflow_step: 'stored',
    status_to: 'nieuw',
    next_required_action: 'Redactie reviews candidate; approval + preview required before Directory_Master rollout.',
    related_sheet: LAB_SHEET_TARGETS.tabs.intake_submissions,
  });
  const backendLogRow = buildLabBackendLogRow(payload, {
    request_id: requestId,
    status_code: 200,
    validation_result: 'ok',
    workflow_step: 'stored',
  });

  const dupHints = duplicateHints(payload, body);

  const sheetWebhookPayload = {
    schema_version: 1,
    flow: 'lab_editorial',
    environment: 'production',
    target_prefix: LAB_SHEET_TARGETS.target_prefix,
    forbidden_targets: LAB_SHEET_TARGETS.forbidden_targets,
    no_auto_publication: true,
    directory_master_touched: false,
    automatic_publication: false,
    submission_id: submissionId,
    request_id: requestId,
    intake_mode: payload.intake_mode,
    rows: {
      [LAB_SHEET_TARGETS.tabs.intake_submissions]: intakeRow,
      [LAB_SHEET_TARGETS.tabs.redactie_reviews]: reviewRow,
      ...(placeCandidateRow
        ? { [LAB_SHEET_TARGETS.tabs.place_candidates]: placeCandidateRow }
        : {}),
    },
    log: backendLogRow,
    workflow_event: workflowEventRow,
    duplicate_hints: dupHints,
    shared_secret_present: !!sharedSecret,
  };

  try {
    assertLabSheetPayloadSafe(sheetWebhookPayload);
  } catch (_e) {
    return cors(jsonErr('Lab sheet safety check failed', 500), origin);
  }

  const sheetResult = await postSheetWebhook(sheetWebhookUrl, sheetWebhookPayload, sharedSecret)
    .catch(e => ({ error: String(e && e.message || e) }));

  if (sheetResult && sheetResult.error) {
    return cors(json({
      ok: false,
      auto_submit_unavailable: true,
      error: 'Lab sheet upstream unavailable',
      request_id: requestId,
    }, 502), origin);
  }

  return cors(json({
    ok: true,
    submission_id: submissionId,
    request_id: requestId,
    mode: payload.intake_mode,
    received_at: payload.meta.received_at,
    no_auto_publication: true,
    directory_master_touched: false,
    automatic_publication: false,
    editorial_status: 'nieuw',
    duplicate_hints: dupHints,
    next_required_action: 'Redactie reviews candidate; approval + preview required before Directory_Master rollout.',
    note: 'Redactionele toevoeging opgeslagen in LAB_Intake_Submissions. Niets is automatisch gepubliceerd of toegevoegd aan Directory_Master.',
  }, 200), origin);
}

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
      'vary': 'origin',
    },
  });
}

export async function onRequest(context) {
  const method = context.request.method.toUpperCase();
  if (method === 'POST') return onRequestPost(context);
  if (method === 'OPTIONS') return onRequestOptions(context);
  return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
    status: 405,
    headers: { 'content-type': 'application/json', 'allow': 'POST, OPTIONS' },
  });
}

// Validation + sanitisation
// --------------------------

function validateAndSanitizeLab(body) {
  const mode = String(body.intake_mode || '').toLowerCase();
  if (!VALID_LAB_MODES.has(mode)) {
    return { error: 'Invalid intake_mode for lab flow (expected editorial_add_org)' };
  }

  const ed = body.editorial_add_org && typeof body.editorial_add_org === 'object'
    ? body.editorial_add_org : {};

  const orgName = String(ed.organisation_name || '').trim();
  if (!orgName) return { error: 'editorial_add_org.organisation_name required' };

  const website = sanitizeUrl(ed.website || '');
  if (!website) {
    return { error: 'editorial_add_org.website required (https://...)' };
  }

  const sourceUrl = sanitizeUrl(ed.source_url || '');
  if (!sourceUrl) {
    return { error: 'editorial_add_org.source_url required (publieke bron)' };
  }

  const country = String(ed.country || '').trim();
  if (!country) return { error: 'editorial_add_org.country required' };

  let countryCode = String(ed.country_code || '').trim().toUpperCase();
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
    return { error: 'editorial_add_org.country_code must be ISO-3166 alpha-2' };
  }

  const sector = String(ed.sector || '').trim();
  if (!sector) return { error: 'editorial_add_org.sector required' };

  const description = String(ed.description_en || '').trim();
  if (description.length < 20) {
    return { error: 'editorial_add_org.description_en must be at least 20 chars' };
  }

  if (!ed.editorial_acknowledgement) {
    return { error: 'editorial_add_org.editorial_acknowledgement required (publiek-bron-toevoeging)' };
  }
  if (ed.impersonation_disclaimer === false) {
    return { error: 'editorial_add_org.impersonation_disclaimer must be true' };
  }

  const contactEmail = String(ed.contact_email || '').trim();
  if (contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
    return { error: 'editorial_add_org.contact_email invalid' };
  }

  const naceCode = String(ed.nace_code || '').trim();
  if (naceCode && !/^[A-Z]?\.?\d{1,2}(\.\d{1,2})?$/.test(naceCode)) {
    return { error: 'editorial_add_org.nace_code invalid format' };
  }

  const editor = body.editor && typeof body.editor === 'object' ? body.editor : {};
  const editorName = String(editor.name || '').trim();
  if (!editorName) return { error: 'editor.name required' };
  const editorEmail = String(editor.email || '').trim();
  if (!editorEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(editorEmail)) {
    return { error: 'editor.email invalid' };
  }

  const out = {
    meta: {
      environment: 'production',
      received_at: new Date().toISOString(),
      source: 'redactie-validation.html',
    },
    intake_mode: mode,
    editor: {
      name: sanitize(editorName),
      email: sanitize(editorEmail),
    },
    editorial_add_org: {
      organisation_name: sanitize(orgName),
      alternate_name: sanitize(ed.alternate_name || ''),
      website,
      source_url: sourceUrl,
      country: sanitize(country),
      country_code: countryCode,
      city: sanitize(ed.city || ''),
      sector: sanitize(sector),
      nace_code: sanitize(naceCode),
      description_en: sanitizeLong(description),
      additional_tags: sanitizeLong(ed.additional_tags || ''),
      contact_email: sanitize(contactEmail),
      internal_note: sanitizeLong(ed.internal_note || ''),
      editorial_acknowledgement: true,
      impersonation_disclaimer: true,
    },
  };

  return { payload: out };
}

// Row builders
// ------------

function buildLabIntakeSubmissionRow(payload) {
  const ed = payload.editorial_add_org || {};
  const ed_ = payload.editor || {};
  const m = payload.meta || {};
  return {
    submission_id: m.submission_id || '',
    received_at: m.received_at || '',
    environment: m.environment || '',
    flow: 'lab_editorial',
    submission_type: 'editorial_add_org',
    mode: payload.intake_mode || '',
    organisation_name: ed.organisation_name || '',
    alternate_name: ed.alternate_name || '',
    website: ed.website || '',
    source_url: ed.source_url || '',
    country: ed.country || '',
    country_code: ed.country_code || '',
    city: ed.city || '',
    sector: ed.sector || '',
    nace_code: ed.nace_code || '',
    description_en: ed.description_en || '',
    additional_tags: ed.additional_tags || '',
    contact_email: ed.contact_email || '',
    internal_note: ed.internal_note || '',
    editor_name: ed_.name || '',
    editor_email: ed_.email || '',
    editorial_acknowledgement: ed.editorial_acknowledgement ? 'yes' : 'no',
    impersonation_disclaimer: ed.impersonation_disclaimer ? 'yes' : 'no',
    review_status: 'nieuw',
    next_required_action: 'Redactie reviews candidate; approval + preview required before Directory_Master rollout.',
    no_auto_publication: 'yes',
    directory_master_touched: 'no',
    automatic_publication: 'no',
    created_by_flow: 'redactie-validation.html',
  };
}

function buildLabRedactieReviewRow(payload) {
  const ed = payload.editorial_add_org || {};
  const ed_ = payload.editor || {};
  const m = payload.meta || {};
  return {
    review_id: generateId('rev'),
    received_at: m.received_at || '',
    environment: m.environment || '',
    submission_id: m.submission_id || '',
    organisation_name: ed.organisation_name || '',
    website: ed.website || '',
    source_url: ed.source_url || '',
    editor_name: ed_.name || '',
    editor_email: ed_.email || '',
    editorial_status: 'nieuw',
    status_from: '',
    status_to: 'nieuw',
    decision: '',
    decision_reason: '',
    next_required_action: 'Triage door redactie; status doorzetten naar "in beoordeling".',
    no_auto_publication: 'yes',
    directory_master_touched: 'no',
    automatic_publication: 'no',
  };
}

function needsLabPlaceCandidateRow(payload) {
  const ed = payload.editorial_add_org || {};
  return !!(ed.city && ed.country_code);
}

function buildLabPlaceCandidateRow(payload) {
  const ed = payload.editorial_add_org || {};
  const m = payload.meta || {};
  return {
    candidate_id: generateId('place'),
    first_seen_at: m.received_at || '',
    last_seen_at: m.received_at || '',
    environment: m.environment || '',
    flow: 'lab_editorial',
    city_raw: ed.city || '',
    country_code: ed.country_code || '',
    submission_count: 1,
    review_status: 'nieuw',
    next_required_action: 'Verify place candidate before merging into the lookup list.',
    submission_id: m.submission_id || '',
  };
}

function buildLabBackendLogRow(payload, opts) {
  const m = payload.meta || {};
  return {
    log_id: generateId('log'),
    timestamp: new Date().toISOString(),
    environment: m.environment || '',
    request_id: opts.request_id || '',
    endpoint: '/api/lab-intake',
    submission_id: m.submission_id || '',
    status_code: opts.status_code || 0,
    validation_result: opts.validation_result || '',
    workflow_step: opts.workflow_step || '',
    error_message: opts.error_message || '',
  };
}

function buildLabWorkflowEventRow(payload, opts) {
  const m = payload.meta || {};
  return {
    event_id: generateId('evt'),
    timestamp: new Date().toISOString(),
    environment: m.environment || '',
    submission_id: m.submission_id || '',
    flow: 'lab_editorial',
    event_type: opts.event_type || '',
    workflow_step: opts.workflow_step || '',
    status_from: opts.status_from || '',
    status_to: opts.status_to || '',
    next_required_action: opts.next_required_action || '',
    actor: 'backend',
    related_sheet: opts.related_sheet || '',
  };
}

// Best-effort duplicate detection. We don't have direct sheet access from
// the Pages function, so we expose hints based on the editor's own
// `existing_matches` payload. The actual authoritative check happens
// server-side in the Apps Script that owns the sheet, which appends the
// row regardless and tags it `possible_duplicate=yes` for the redactie
// to triage.
function duplicateHints(payload, body) {
  const ed = payload.editorial_add_org || {};
  const declaredMatches = Array.isArray(body && body.existing_matches)
    ? body.existing_matches.slice(0, 5).map(m => ({
        name: sanitize(m && m.name || ''),
        website: sanitizeUrl(m && m.website || ''),
        source: sanitize(m && m.source || ''),
      })).filter(m => m.name || m.website)
    : [];
  return {
    name_to_check: ed.organisation_name || '',
    website_to_check: ed.website || '',
    declared_matches: declaredMatches,
    note: 'Redactie blijft eindverantwoordelijk voor duplicate-controle voor goedkeuring.',
  };
}

// External call
// -------------

async function postSheetWebhook(webhookUrl, payload, sharedSecret) {
  try {
    const headers = { 'content-type': 'application/json', 'user-agent': 'esrf-lab-intake-bot' };
    if (sharedSecret) headers['x-esrf-intake-secret'] = sharedSecret;
    const wireBody = sharedSecret ? { ...payload, shared_secret: sharedSecret } : payload;
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(wireBody),
    });
    if (!res.ok) return { error: 'Sheet upstream ' + res.status };
    let j = null;
    try { j = await res.json(); } catch { j = null; }
    return {
      ok: true,
      row_id: (j && (j.row_id || j.id)) || '',
      sheet_url: (j && j.sheet_url) || '',
    };
  } catch (_e) {
    return { error: 'Sheet upstream unreachable' };
  }
}

// Helpers
// -------

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' && u.hostname.endsWith(ALLOWED_ORIGIN_SUFFIX);
  } catch { return false; }
}

function cors(response, origin) {
  const headers = new Headers(response.headers);
  if (isAllowedOrigin(origin)) headers.set('access-control-allow-origin', origin);
  headers.set('vary', 'origin');
  return new Response(response.body, { status: response.status, headers });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function jsonErr(msg, status) { return json({ ok: false, error: msg }, status); }

function generateId(prefix) {
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 0x100000).toString(36).padStart(4, '0');
  return prefix + '_' + t + '_' + r;
}

function sanitize(str) {
  if (str == null) return '';
  return String(str)
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[<>"'`]/g, '')
    .trim()
    .slice(0, MAX_FIELD_LENGTH);
}
function sanitizeLong(str) {
  if (str == null) return '';
  return String(str)
    .replace(/<[^>]*>/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ')
    .replace(/[<>"'`]/g, '')
    .trim()
    .slice(0, MAX_LONG_FIELD_LENGTH);
}
function sanitizeUrl(url) {
  if (url == null) return '';
  const s = String(url).trim().slice(0, MAX_FIELD_LENGTH);
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) return '';
  return s.replace(/[<>"'`\s]/g, '');
}

export {
  validateAndSanitizeLab,
  buildLabIntakeSubmissionRow,
  buildLabRedactieReviewRow,
  buildLabPlaceCandidateRow,
  buildLabBackendLogRow,
  buildLabWorkflowEventRow,
  needsLabPlaceCandidateRow,
  assertLabSheetPayloadSafe,
  isAllowedOrigin,
  duplicateHints,
  sanitize,
  sanitizeLong,
  sanitizeUrl,
  VALID_LAB_MODES,
  VALID_REDACTIE_STATUSES,
  LAB_SHEET_TARGETS,
  MAX_BODY_BYTES,
  MIN_FORM_DURATION_MS,
};

if (typeof globalThis !== 'undefined') {
  globalThis.__esrfLabIntake = {
    validateAndSanitizeLab,
    buildLabIntakeSubmissionRow,
    buildLabRedactieReviewRow,
    buildLabPlaceCandidateRow,
    buildLabBackendLogRow,
    buildLabWorkflowEventRow,
    needsLabPlaceCandidateRow,
    assertLabSheetPayloadSafe,
    isAllowedOrigin,
    duplicateHints,
    onRequest,
    sanitize,
    sanitizeLong,
    sanitizeUrl,
    VALID_LAB_MODES,
    VALID_REDACTIE_STATUSES,
    LAB_SHEET_TARGETS,
  };
}
