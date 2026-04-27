// Cloudflare Pages Function — POST /api/intake
//
// Production intake handler for the public submit-news.html form. Accepts
// the 6 supported intake modes:
//   org · editorial · both · change_request · hide_delete · event
//
// ─── Storage architecture ────────────────────────────────────────────────
// The Google Sheet "ESRF Directory CRM" remains the OPERATIONAL SINGLE
// SOURCE OF TRUTH for every intake. This backend forwards the validated
// submission to a sheet-only Apps Script webhook which appends rows to
// dedicated intake / workflow tabs:
//
//   - Intake_Submissions   (one row per submission — every mode)
//   - Editorial_Intake     (one row per editorial-bearing submission)
//   - Event_Intake         (one row per event submission)
//   - Change_Requests      (one row per change_request / hide_delete)
//   - Place_Candidates     (one row per unknown place candidate)
//   - Workflow_Events      (one row per state-change event)
//   - Backend_Log          (one row per request, success or error)
//
// The backend NEVER writes to Directory_Master. Both this code and the
// Apps Script reject any payload that targets Directory_Master.
//
// No automatic publication — the redactie reviews every submission via
// the spreadsheet / redactieformulier before anything is published.
//
// ─── Failure modes ───────────────────────────────────────────────────────
// If INTAKE_SHEET_WEBHOOK_URL (or its alias SHEETS_WEBHOOK_URL) is not
// configured the backend returns 503 with an explicit
// `auto_submit_unavailable: true` flag so the public form can fall back
// to the mailto path. No partial state is written.
//
// Optional Cloudflare Turnstile is honoured when TURNSTILE_SECRET_KEY is
// set, but is NOT required — honeypot + form-fill timer always apply.
//
// No secrets are ever returned to the client.

const ALLOWED_ORIGINS = [
  'https://www.esrf.net',
  'https://esrf.net',
];
// Cloudflare Pages spawns a unique preview hostname per deploy on the same
// project. Allow any *.esrf-clean.pages.dev preview origin.
const ALLOWED_ORIGIN_SUFFIX = '.esrf-clean.pages.dev';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_FIELD_LENGTH = 600;
const MAX_LONG_FIELD_LENGTH = 2000;
const MIN_FORM_DURATION_MS = 2500;

const VALID_MODES = new Set([
  'org', 'editorial', 'both', 'change_request', 'hide_delete', 'event',
]);
const VALID_CHANGE_ACTIONS = new Set(['update', 'hide', 'delete']);
const VALID_REQUESTER_AUTH = new Set([
  'authorized_representative', 'employee', 'external_observer',
]);
const VALID_EVENT_PUBLICATION = new Set([
  'events_page', 'dispatch', 'editorial', 'fyi',
]);

// Production sheet target. The backend never writes to Directory_Master.
const SHEET_TARGETS = {
  target_prefix: '',
  tabs: {
    intake_submissions: 'Intake_Submissions',
    editorial_intake: 'Editorial_Intake',
    event_intake: 'Event_Intake',
    change_requests: 'Change_Requests',
    place_candidates: 'Place_Candidates',
    workflow_events: 'Workflow_Events',
    backend_log: 'Backend_Log',
  },
  forbidden_targets: ['Directory_Master'],
};

// Defence-in-depth: refuse to even put on the wire a payload whose row
// map targets Directory_Master. The Apps Script also rejects on receipt.
function assertSheetPayloadSafe(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('sheet-payload-invalid: not an object');
  }
  const rows = payload.rows && typeof payload.rows === 'object' ? payload.rows : {};
  for (const tab of Object.keys(rows)) {
    if (SHEET_TARGETS.forbidden_targets.includes(tab)) {
      throw new Error('sheet-payload-invalid: forbidden tab ' + tab);
    }
  }
  if (!Array.isArray(payload.forbidden_targets) ||
      !payload.forbidden_targets.includes('Directory_Master')) {
    throw new Error('sheet-payload-invalid: Directory_Master missing from forbidden_targets');
  }
  if (payload.no_auto_publication !== true) {
    throw new Error('sheet-payload-invalid: no_auto_publication must be true');
  }
  if (payload.directory_master_touched !== false) {
    throw new Error('sheet-payload-invalid: directory_master_touched must be false');
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('origin') || '';
  const requestId = generateId('req');

  if (!isAllowedOrigin(origin)) {
    return cors(jsonErr('Forbidden origin', 403), origin);
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

  // Honeypot — silent reject.
  if (body.company_website_hp) {
    return cors(jsonErr('Invalid submission', 400), origin);
  }

  // Form-fill timer (client-reported).
  const elapsed = Number(body.form_duration_ms || 0);
  if (!Number.isFinite(elapsed) || elapsed < MIN_FORM_DURATION_MS) {
    return cors(jsonErr('Form submitted too quickly', 400), origin);
  }

  // Optional Turnstile — only enforced when configured.
  const turnstile = await verifyTurnstile(env, body, request);
  if (turnstile.checked && !turnstile.ok) {
    return cors(jsonErr('Turnstile verification failed', 400), origin);
  }

  // Validate + sanitise.
  const sanitized = validateAndSanitize(body);
  if (sanitized.error) {
    return cors(jsonErr(sanitized.error, 400), origin);
  }
  const payload = sanitized.payload;
  const submissionId = generateId('sub');
  payload.meta.submission_id = submissionId;
  payload.meta.request_id = requestId;

  // Resolve sheet webhook by documented priority order.
  const sheetWebhookUrl = String(
    env.INTAKE_SHEET_WEBHOOK_URL ||
    env.SHEETS_WEBHOOK_URL ||
    ''
  ).trim();
  const sharedSecret = String(
    env.SHEETS_WEBHOOK_SECRET ||
    env.INTAKE_SHEET_WEBHOOK_SECRET ||
    ''
  ).trim();

  // Safe failure: if the sheet webhook is not configured the public form
  // must fall back to mailto. We return 503 + an explicit flag so the
  // client can render the fallback UI without parsing free-form text.
  if (!sheetWebhookUrl) {
    return cors(json({
      ok: false,
      auto_submit_unavailable: true,
      error: 'Automatic submission backend is not configured. Use the email fallback.',
      request_id: requestId,
    }, 503), origin);
  }

  // Build sheet payload. Each present row is appended to its named tab.
  const intakeRow = buildIntakeSubmissionRow(payload);
  const editorialRow = payload.editorial_contribution
    ? buildEditorialIntakeRow(payload) : null;
  const eventRow = payload.event_intake
    ? buildEventIntakeRow(payload) : null;
  const changeRequestRow = payload.change_request
    ? buildChangeRequestRow(payload) : null;
  const placeCandidateRow = needsPlaceCandidateRow(payload)
    ? buildPlaceCandidateRow(payload) : null;
  const backendLogRow = buildBackendLogRow(payload, {
    request_id: requestId,
    status_code: 200,
    validation_result: 'ok',
    workflow_step: 'stored',
  });
  const workflowEventRow = buildWorkflowEventRow(payload, {
    event_type: 'intake_received',
    workflow_step: 'stored',
    status_to: 'new',
    next_required_action: nextRequiredAction(payload, 'stored'),
    related_sheet: SHEET_TARGETS.tabs.intake_submissions,
  });

  const sheetWebhookPayload = {
    schema_version: 3,
    environment: 'production',
    target_prefix: SHEET_TARGETS.target_prefix,
    forbidden_targets: SHEET_TARGETS.forbidden_targets,
    no_auto_publication: true,
    directory_master_touched: false,
    submission_id: submissionId,
    request_id: requestId,
    intake_mode: payload.intake_mode,
    rows: {
      [SHEET_TARGETS.tabs.intake_submissions]: intakeRow,
      ...(editorialRow ? { [SHEET_TARGETS.tabs.editorial_intake]: editorialRow } : {}),
      ...(eventRow ? { [SHEET_TARGETS.tabs.event_intake]: eventRow } : {}),
      ...(changeRequestRow ? { [SHEET_TARGETS.tabs.change_requests]: changeRequestRow } : {}),
      ...(placeCandidateRow ? { [SHEET_TARGETS.tabs.place_candidates]: placeCandidateRow } : {}),
    },
    log: backendLogRow,
    workflow_event: workflowEventRow,
    shared_secret_present: !!sharedSecret,
  };

  // Defence-in-depth check before any network call.
  try {
    assertSheetPayloadSafe(sheetWebhookPayload);
  } catch (_e) {
    return cors(jsonErr('Sheet safety check failed', 500), origin);
  }

  // Dispatch to the Apps Script sheet webhook.
  const sheetResult = await postSheetWebhook(sheetWebhookUrl, sheetWebhookPayload, sharedSecret)
    .catch(e => ({ error: String(e && e.message || e) }));

  if (sheetResult && sheetResult.error) {
    // Do not leak upstream error details. Tell the client the auto path
    // failed so it can offer the mailto fallback.
    return cors(json({
      ok: false,
      auto_submit_unavailable: true,
      error: 'Sheet upstream unavailable',
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
    next_required_action: nextRequiredAction(payload, 'stored'),
    note: 'Ontvangen door ESRF-redactie. Er wordt niets automatisch gepubliceerd.',
  }, 200), origin);
}

// CORS preflight
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

// ─── Validation + sanitisation ────────────────────────────────────────────

function validateAndSanitize(body) {
  const mode = String(body.intake_mode || '').toLowerCase();
  if (!VALID_MODES.has(mode)) {
    return { error: 'Invalid intake_mode' };
  }
  const isChangeMode = (mode === 'change_request' || mode === 'hide_delete');
  const isEventMode = (mode === 'event');

  const contact = body.contact && typeof body.contact === 'object' ? body.contact : {};
  const required = [
    ['name', contact.name],
    ['role', contact.role],
    ['email', contact.email],
    ['country_code', contact.country_code],
  ];
  if (!isChangeMode && !isEventMode) {
    required.unshift(['organisation', contact.organisation]);
  }
  for (const [k, v] of required) {
    if (!v || !String(v).trim()) return { error: `Missing contact.${k}` };
  }
  const email = String(contact.email).trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: 'Invalid contact.email' };
  }
  const country = String(contact.country_code).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    return { error: 'Invalid contact.country_code (ISO-3166 alpha-2)' };
  }

  const cleanContact = {
    name: sanitize(contact.name),
    organisation: sanitize(contact.organisation || ''),
    role: sanitize(contact.role),
    email: sanitize(email),
    phone: sanitize(contact.phone || ''),
    country_code: country,
    country_label: sanitize(contact.country_label || ''),
    place: sanitize(contact.place || ''),
    region: sanitize(contact.region || ''),
    website: sanitizeUrl(contact.website || ''),
  };

  const out = {
    meta: {
      environment: 'production',
      received_at: new Date().toISOString(),
      source: 'submit-news.html',
    },
    intake_mode: mode,
    contact: cleanContact,
  };

  // ESRF-sector + aanvullende tags carry across all modes.
  out.sector = sanitize(body.sector || '');
  out.sector_label = sanitize(body.sector_label || '');
  out.additional_tags = sanitizeLong(body.additional_tags || '');

  if (mode === 'org' || mode === 'both') {
    const org = body.organisation_listing && typeof body.organisation_listing === 'object'
      ? body.organisation_listing : {};
    if (!cleanContact.website || !/^https?:\/\//i.test(cleanContact.website)) {
      return { error: 'Organisation mode requires a valid contact.website (https://…)' };
    }
    if (!out.sector) {
      return { error: 'Missing sector (ESRF-sector)' };
    }
    out.organisation_listing = {
      sector: out.sector,
      sector_label: out.sector_label,
      city: sanitize(org.city || cleanContact.place || ''),
      description: sanitizeLong(org.description || ''),
    };
  }

  if (mode === 'editorial' || mode === 'both') {
    const ed = body.editorial_contribution && typeof body.editorial_contribution === 'object'
      ? body.editorial_contribution : {};
    if (!ed.topic || !String(ed.topic).trim()) {
      return { error: 'Missing editorial_contribution.topic' };
    }
    if (!ed.summary || String(ed.summary).trim().length < 20) {
      return { error: 'editorial_contribution.summary must be at least 20 chars' };
    }
    const consent = ed.consent && typeof ed.consent === 'object' ? ed.consent : {};
    if (!consent.edit_and_publish) {
      return { error: 'editorial_contribution.consent.edit_and_publish required' };
    }
    if (!consent.editorial_may_contact) {
      return { error: 'editorial_contribution.consent.editorial_may_contact required' };
    }
    if (!consent.no_confidential_information) {
      return { error: 'editorial_contribution.consent.no_confidential_information required' };
    }
    out.editorial_contribution = {
      topic: sanitize(ed.topic),
      summary: sanitizeLong(ed.summary),
      audience: sanitize(ed.audience || ''),
      partners_sector: sanitizeLong(ed.partners_sector || ''),
      regional_angle: sanitizeLong(ed.regional_angle || ''),
      lesson: sanitizeLong(ed.lesson || ''),
      spotlight: sanitizeLong(ed.spotlight || ''),
      sources: sanitizeLong(ed.sources || ''),
      sector: sanitize(ed.sector || out.sector || ''),
      additional_tags: sanitizeLong(ed.additional_tags || out.additional_tags || ''),
      consent: {
        edit_and_publish: true,
        editorial_may_contact: true,
        no_confidential_information: true,
      },
    };
  }

  if (isChangeMode) {
    const cr = body.change_request && typeof body.change_request === 'object'
      ? body.change_request : {};
    const targetName = String(cr.target_listing_name || '').trim();
    const targetUrl = String(cr.target_listing_url || '').trim();
    if (!targetName && !targetUrl) {
      return { error: 'change_request requires target_listing_name or target_listing_url' };
    }
    if (targetUrl && !/^https?:\/\//i.test(targetUrl)) {
      return { error: 'change_request.target_listing_url must start with http(s)://' };
    }
    let action = String(cr.requested_action || '').toLowerCase().trim();
    if (mode === 'hide_delete') {
      if (!action) action = 'hide';
      if (action !== 'hide' && action !== 'delete') {
        return { error: 'hide_delete mode requires action of "hide" or "delete"' };
      }
    } else {
      if (!action) action = 'update';
      if (!VALID_CHANGE_ACTIONS.has(action)) {
        return { error: 'change_request.requested_action must be update|hide|delete' };
      }
    }
    const description = String(cr.change_description || '').trim();
    if (!description) return { error: 'change_request.change_description required' };
    const reason = String(cr.reason || '').trim();
    if (!reason) return { error: 'change_request.reason required' };
    if (!cr.authorization_confirmation) {
      return { error: 'change_request.authorization_confirmation required' };
    }
    let requesterAuth = String(cr.requester_authorization || '').trim();
    if (requesterAuth && !VALID_REQUESTER_AUTH.has(requesterAuth)) {
      return { error: 'change_request.requester_authorization invalid' };
    }
    if (!requesterAuth) requesterAuth = 'authorized_representative';
    out.change_request = {
      target_listing_name: sanitize(targetName),
      target_listing_url: sanitizeUrl(targetUrl),
      requested_action: action,
      change_description: sanitizeLong(description),
      reason: sanitizeLong(reason),
      evidence_url: sanitizeUrl(cr.evidence_url || ''),
      requester_authorization: requesterAuth,
      authorization_confirmation: true,
      sub_mode: mode,
      sector: sanitize(cr.sector || out.sector || ''),
      additional_tags: sanitizeLong(cr.additional_tags || out.additional_tags || ''),
      directory_master_touched: false,
      automatic_publication: false,
    };
  }

  if (isEventMode) {
    const ev = body.event_intake && typeof body.event_intake === 'object'
      ? body.event_intake : {};
    if (!ev.event_name || !String(ev.event_name).trim()) {
      return { error: 'event_intake.event_name required' };
    }
    if (!ev.organiser || !String(ev.organiser).trim()) {
      return { error: 'event_intake.organiser required' };
    }
    if (!ev.date_start || !String(ev.date_start).trim()) {
      return { error: 'event_intake.date_start required' };
    }
    if (ev.date_end && String(ev.date_end).trim() &&
        String(ev.date_end).trim() < String(ev.date_start).trim()) {
      return { error: 'event_intake.date_end before date_start' };
    }
    if (!ev.location || !String(ev.location).trim()) {
      return { error: 'event_intake.location required' };
    }
    if (!ev.country || !String(ev.country).trim()) {
      return { error: 'event_intake.country required' };
    }
    if (!ev.description || String(ev.description).trim().length < 20) {
      return { error: 'event_intake.description must be at least 20 chars' };
    }
    const evWebsite = sanitizeUrl(ev.website || '');
    if (!evWebsite) {
      return { error: 'event_intake.website required (https://…)' };
    }
    if (!ev.contact_name || !String(ev.contact_name).trim()) {
      return { error: 'event_intake.contact_name required' };
    }
    const evContactEmail = String(ev.contact_email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(evContactEmail)) {
      return { error: 'event_intake.contact_email invalid' };
    }
    const pubReq = String(ev.publication_request || '').toLowerCase();
    if (!VALID_EVENT_PUBLICATION.has(pubReq)) {
      return { error: 'event_intake.publication_request invalid' };
    }
    out.event_intake = {
      event_name: sanitize(ev.event_name),
      organiser: sanitize(ev.organiser),
      date_start: sanitize(String(ev.date_start)),
      date_end: sanitize(String(ev.date_end || '')),
      time_zone: sanitize(ev.time_zone || ''),
      location: sanitize(ev.location),
      country: sanitize(ev.country),
      description: sanitizeLong(ev.description),
      audience: sanitize(ev.audience || ''),
      website: evWebsite,
      contact_name: sanitize(ev.contact_name),
      contact_email: sanitize(evContactEmail),
      publication_request: pubReq,
      sector: sanitize(ev.sector || out.sector || ''),
      additional_tags: sanitizeLong(ev.additional_tags || out.additional_tags || ''),
      automatic_publication: false,
    };
  }

  const privacy = body.privacy && typeof body.privacy === 'object' ? body.privacy : {};
  if (!privacy.gdpr_privacy_policy) {
    return { error: 'privacy.gdpr_privacy_policy required' };
  }
  out.privacy = { gdpr_privacy_policy: true };

  return { payload: out };
}

// ─── Row builders ────────────────────────────────────────────────────────

function buildIntakeSubmissionRow(payload) {
  const c = payload.contact || {};
  const o = payload.organisation_listing || null;
  const e = payload.editorial_contribution || null;
  const cr = payload.change_request || null;
  const ev = payload.event_intake || null;
  const m = payload.meta || {};
  let submissionType;
  if (cr) submissionType = 'change_request:' + (cr.requested_action || 'update');
  else if (ev) submissionType = 'event';
  else if (e && o) submissionType = 'org+editorial';
  else if (e) submissionType = 'editorial';
  else submissionType = 'org';
  return {
    submission_id: m.submission_id || '',
    received_at: m.received_at || '',
    environment: m.environment || '',
    submission_type: submissionType,
    mode: payload.intake_mode || '',
    name: cr ? (cr.target_listing_name || c.organisation || '')
        : (ev ? ev.event_name : (c.organisation || '')),
    website: cr ? (cr.target_listing_url || c.website || '')
        : (ev ? ev.website : (c.website || '')),
    country_code: c.country_code || '',
    country_label: c.country_label || '',
    region: c.region || '',
    city: c.place || (o ? (o.city || '') : ''),
    sector: payload.sector || '',
    sector_label: payload.sector_label || '',
    additional_tags: payload.additional_tags || '',
    description: o ? (o.description || '') : '',
    contact_name: c.name || '',
    contact_email: c.email || '',
    contact_role: c.role || '',
    contact_phone: c.phone || '',
    consent_publish: cr ? 'change_request_only'
        : (e ? 'yes' : (ev ? 'event_intake' : (o ? 'listing' : ''))),
    source_url: m.source || '',
    review_status: 'new',
    next_required_action: nextRequiredAction(payload, 'received'),
    no_auto_publication: 'yes',
    directory_master_touched: 'no',
    created_by_flow: 'submit-news.html',
  };
}

function buildEditorialIntakeRow(payload) {
  const c = payload.contact || {};
  const e = payload.editorial_contribution || {};
  const m = payload.meta || {};
  return {
    editorial_id: generateId('ed'),
    received_at: m.received_at || '',
    environment: m.environment || '',
    submission_id: m.submission_id || '',
    organisation_name: c.organisation || '',
    title: e.topic || '',
    type: 'regional_editorial',
    language: 'nl',
    summary: e.summary || '',
    regional_angle: e.regional_angle || '',
    lesson: e.lesson || '',
    audience: e.audience || '',
    partners_sector: e.partners_sector || '',
    spotlight: e.spotlight || '',
    sources: e.sources || '',
    sector: e.sector || '',
    additional_tags: e.additional_tags || '',
    region: c.region || '',
    country_code: c.country_code || '',
    contact_name: c.name || '',
    contact_email: c.email || '',
    consent_publish: 'yes',
    consent_editorial_may_contact: 'yes',
    consent_no_confidential: 'yes',
    editorial_status: 'received',
    next_required_action: 'Editorial review by redactie',
    no_auto_publication: 'yes',
  };
}

function buildEventIntakeRow(payload) {
  const c = payload.contact || {};
  const ev = payload.event_intake || {};
  const m = payload.meta || {};
  return {
    event_id: generateId('evt'),
    received_at: m.received_at || '',
    environment: m.environment || '',
    submission_id: m.submission_id || '',
    event_name: ev.event_name || '',
    organiser: ev.organiser || '',
    date_start: ev.date_start || '',
    date_end: ev.date_end || '',
    time_zone: ev.time_zone || '',
    location: ev.location || '',
    country: ev.country || '',
    description: ev.description || '',
    audience: ev.audience || '',
    website: ev.website || '',
    contact_name: ev.contact_name || '',
    contact_email: ev.contact_email || '',
    publication_request: ev.publication_request || '',
    sector: ev.sector || '',
    additional_tags: ev.additional_tags || '',
    submitter_name: c.name || '',
    submitter_email: c.email || '',
    review_status: 'new',
    next_required_action: 'Verify event details; redactie decides on publication.',
    no_auto_publication: 'yes',
    automatic_publication: 'no',
  };
}

function buildChangeRequestRow(payload) {
  const c = payload.contact || {};
  const cr = payload.change_request || {};
  const m = payload.meta || {};
  return {
    change_request_id: generateId('chg'),
    received_at: m.received_at || '',
    environment: m.environment || '',
    submission_id: m.submission_id || '',
    intake_mode: payload.intake_mode || '',
    sub_mode: cr.sub_mode || payload.intake_mode || '',
    requested_action: cr.requested_action || '',
    target_listing_name: cr.target_listing_name || '',
    target_listing_url: cr.target_listing_url || '',
    change_description: cr.change_description || '',
    reason: cr.reason || '',
    evidence_url: cr.evidence_url || '',
    requester_name: c.name || '',
    requester_role: c.role || '',
    requester_organisation: c.organisation || '',
    requester_email: c.email || '',
    requester_phone: c.phone || '',
    requester_country: c.country_code || '',
    requester_authorization: cr.requester_authorization || '',
    authorization_confirmation: cr.authorization_confirmation ? 'yes' : 'no',
    sector: cr.sector || '',
    additional_tags: cr.additional_tags || '',
    review_status: 'new',
    redactie_decision: '',
    next_required_action: nextRequiredAction(payload, 'received'),
    directory_master_touched: 'no',
    automatic_publication: 'no',
  };
}

function needsPlaceCandidateRow(payload) {
  const c = payload.contact || {};
  if (c.place && c.place_known === false) return true;
  return false;
}

function buildPlaceCandidateRow(payload) {
  const c = payload.contact || {};
  const m = payload.meta || {};
  return {
    candidate_id: generateId('place'),
    first_seen_at: m.received_at || '',
    last_seen_at: m.received_at || '',
    environment: m.environment || '',
    city_raw: c.place || '',
    country_code: c.country_code || '',
    region: c.region || '',
    submission_count: 1,
    review_status: 'new',
    next_required_action: 'Verify place candidate before merging into lookup list.',
    submission_id: m.submission_id || '',
  };
}

function buildBackendLogRow(payload, opts) {
  const m = payload.meta || {};
  return {
    log_id: generateId('log'),
    timestamp: new Date().toISOString(),
    environment: m.environment || '',
    request_id: opts.request_id || '',
    endpoint: '/api/intake',
    submission_id: m.submission_id || '',
    status_code: opts.status_code || 0,
    validation_result: opts.validation_result || '',
    workflow_step: opts.workflow_step || '',
    error_message: opts.error_message || '',
  };
}

function buildWorkflowEventRow(payload, opts) {
  const m = payload.meta || {};
  return {
    event_id: generateId('evt'),
    timestamp: new Date().toISOString(),
    environment: m.environment || '',
    submission_id: m.submission_id || '',
    event_type: opts.event_type || '',
    workflow_step: opts.workflow_step || '',
    status_from: opts.status_from || '',
    status_to: opts.status_to || '',
    next_required_action: opts.next_required_action || '',
    actor: 'backend',
    related_sheet: opts.related_sheet || '',
  };
}

function nextRequiredAction(payload, stage) {
  if (payload.change_request) {
    const cr = payload.change_request;
    if (cr.requested_action === 'delete') {
      return 'Verify deletion request; redactie confirms requester authority. Directory_Master is never modified automatically.';
    }
    if (cr.requested_action === 'hide') {
      return 'Verify hide request; redactie decides on visibility. Directory_Master is never modified automatically.';
    }
    return 'Triage change request; redactie cross-checks Directory_Master read-only before any update.';
  }
  if (payload.event_intake) {
    return 'Verify event details; redactie decides on publication on the events page / Dispatch.';
  }
  if (payload.editorial_contribution) {
    return 'Editorial review; redactie decides accept/reject and assigns an editor.';
  }
  return 'Triage organisation listing; redactie verifies the org against Directory_Master read-only.';
}

// ─── External calls ──────────────────────────────────────────────────────

async function postSheetWebhook(webhookUrl, payload, sharedSecret) {
  try {
    const headers = { 'content-type': 'application/json', 'user-agent': 'esrf-intake-bot' };
    if (sharedSecret) headers['x-esrf-intake-secret'] = sharedSecret;
    const wireBody = sharedSecret ? { ...payload, shared_secret: sharedSecret } : payload;
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(wireBody),
    });
    if (!res.ok) {
      return { error: 'Sheet upstream ' + res.status };
    }
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

// ─── Anti-bot ────────────────────────────────────────────────────────────

async function verifyTurnstile(env, body, request) {
  if (!env.TURNSTILE_SECRET_KEY) return { checked: false, ok: false };
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET_KEY,
        response: String(body.turnstile_token || ''),
        remoteip: request.headers.get('cf-connecting-ip') || '',
      }),
    }).then(x => x.json());
    return { checked: true, ok: !!(r && r.success) };
  } catch { return { checked: true, ok: false }; }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

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

// Named exports for tests / sibling routes.
export {
  validateAndSanitize,
  buildIntakeSubmissionRow,
  buildEditorialIntakeRow,
  buildEventIntakeRow,
  buildChangeRequestRow,
  buildPlaceCandidateRow,
  buildBackendLogRow,
  buildWorkflowEventRow,
  needsPlaceCandidateRow,
  nextRequiredAction,
  assertSheetPayloadSafe,
  isAllowedOrigin,
  sanitize,
  sanitizeLong,
  sanitizeUrl,
  VALID_MODES,
  VALID_CHANGE_ACTIONS,
  VALID_REQUESTER_AUTH,
  VALID_EVENT_PUBLICATION,
  SHEET_TARGETS,
  MAX_BODY_BYTES,
  MIN_FORM_DURATION_MS,
};

// Test hooks
if (typeof globalThis !== 'undefined') {
  globalThis.__esrfIntake = {
    validateAndSanitize,
    buildIntakeSubmissionRow,
    buildEditorialIntakeRow,
    buildEventIntakeRow,
    buildChangeRequestRow,
    buildPlaceCandidateRow,
    buildBackendLogRow,
    buildWorkflowEventRow,
    needsPlaceCandidateRow,
    nextRequiredAction,
    assertSheetPayloadSafe,
    isAllowedOrigin,
    onRequest,
    sanitize,
    sanitizeLong,
    sanitizeUrl,
    VALID_MODES,
    VALID_CHANGE_ACTIONS,
    VALID_REQUESTER_AUTH,
    VALID_EVENT_PUBLICATION,
    SHEET_TARGETS,
  };
}
