// Cloudflare Pages Function — POST /api/intake
//
// Validation/lab backend for the integrated organisation + editorial intake
// form (submit-validation.html). Lives on the
// `test/regional-editorial-contributor-intake` branch — NEVER production.
//
// ─── Storage architecture ────────────────────────────────────────────────
// The Google Drive spreadsheet "ESRF Directory CRM - actuele brondata
// 2026-04-24" (id 1jGDFjTq5atrFSe3avjj4AflUo1SLPKAmkT_MIpH6z1g) is and
// remains the OPERATIONAL SINGLE SOURCE OF TRUTH. The backend NEVER writes
// to `Directory_Master`. In lab/preview mode it only addresses the LAB_*
// tabs:
//   - LAB_Intake_Submissions  (one row per submission)
//   - LAB_Editorial_Intake    (one row per editorial-bearing submission)
//   - LAB_Place_Candidates    (one row per unknown place candidate)
//   - LAB_Backend_Log         (one row per request, success or error)
//   - LAB_Workflow_Events     (one row per state-change event)
//
// Each POST /api/intake returns an explicit `workflow` object with steps:
//   received → validated → stored_or_dry_run → notification_prepared_or_sent
//   → next_required_action
//
// Behaviour:
//   - Defaults to dry-run when secrets are missing. The exact sheet
//     payload + notification message that *would* be sent is returned
//     in the response so the redactie can audit.
//   - Webhook env vars (priority order):
//       1. INTAKE_SHEET_WEBHOOK_URL  (existing canonical name)
//       2. SHEETS_WEBHOOK_URL        (alias — accepted as documented name)
//       3. GOOGLE_SHEET_WEBHOOK_URL  (legacy alias, kept for back-compat)
//   - In lab/preview, payloads carry `target_prefix: "LAB_"` and the
//     explicit lab tab names so the Apps Script never accidentally
//     touches Directory_Master.
//   - Notification is minimal — no PII, no editorial body. The
//     channel is referred to as the **ESRF mailnotificatie /
//     operationele notificatie / mailrelay-webhook** (NOT a Gmail
//     webhook — ESRF.net does not run on Gmail).
//     Two env vars are honoured:
//       * INTAKE_NOTIFY_WEBHOOK — optional generic mailrelay/webhook
//         URL. When set, the backend POSTs the minimal notification
//         message to that URL. The receiver (Apps Script, Pipedream,
//         a custom mailrelay, …) is responsible for delivering the
//         email to the configured recipient.
//       * INTAKE_NOTIFY_TO — optional recipient address included in
//         the notification message metadata so the relay knows where
//         to deliver. Documented default: office@esrf.net. Setting
//         this on its own does NOT cause the Cloudflare backend to
//         send mail directly; the Apps Script (or another relay)
//         performs the actual MailApp.sendEmail() call when its own
//         NOTIFY_TO Script Property is set.
//     If both are unset, the response includes
//     `notification_status: "dry_run_not_configured"` plus the exact
//     would-be message — no real email is sent.
//
// No secrets are returned to the client. The endpoint refuses anything
// that is not a JSON POST.

const ALLOWED_ORIGINS = [
  'https://www.esrf.net',
  'https://esrf.net',
  // Cloudflare Pages branch preview (validation-only)
  'https://test-regional-editorial-cont.esrf-clean.pages.dev',
];
// Pages spawns a unique preview hostname per deploy on the same project.
// Allow any *.esrf-clean.pages.dev origin during validation.
const ALLOWED_ORIGIN_SUFFIX = '.esrf-clean.pages.dev';

const MAX_BODY_BYTES = 64 * 1024;       // 64 KiB hard cap on the JSON body
const MAX_FIELD_LENGTH = 600;
const MAX_LONG_FIELD_LENGTH = 2000;
const MIN_FORM_DURATION_MS = 2500;

const VALID_MODES = new Set(['org', 'editorial', 'both']);

// Lab spreadsheet — single source of truth in lab/preview environments.
// The backend never writes to Directory_Master; only LAB_* tabs.
const LAB_SPREADSHEET = {
  spreadsheet_id: '1jGDFjTq5atrFSe3avjj4AflUo1SLPKAmkT_MIpH6z1g',
  spreadsheet_label: 'ESRF Directory CRM - actuele brondata 2026-04-24',
  target_prefix: 'LAB_',
  tabs: {
    intake_submissions: 'LAB_Intake_Submissions',
    editorial_intake: 'LAB_Editorial_Intake',
    place_candidates: 'LAB_Place_Candidates',
    backend_log: 'LAB_Backend_Log',
    workflow_events: 'LAB_Workflow_Events',
  },
  forbidden_targets: ['Directory_Master'],
};

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

  // Honeypot
  if (body.company_website_hp) {
    return cors(jsonErr('Invalid submission', 400), origin);
  }

  // Form-fill timer (client-reported)
  const elapsed = Number(body.form_duration_ms || 0);
  if (!Number.isFinite(elapsed) || elapsed < MIN_FORM_DURATION_MS) {
    return cors(jsonErr('Form submitted too quickly', 400), origin);
  }

  // Optional Turnstile
  const turnstile = await verifyTurnstile(env, body, request);
  if (turnstile.checked && !turnstile.ok) {
    return cors(jsonErr('Turnstile verification failed', 400), origin);
  }

  // Validate + sanitize
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
    env.GOOGLE_SHEET_WEBHOOK_URL ||
    ''
  ).trim();
  const hasSheetConfig = !!sheetWebhookUrl;
  const hasIssueConfig = !!(env.GITHUB_TOKEN && env.INTAKE_REPO);
  const hasNotifyConfig = !!env.INTAKE_NOTIFY_WEBHOOK;

  const sheetDryRun = !hasSheetConfig;
  const issueDryRun = !hasIssueConfig;

  // Optional notification recipient metadata. This is NEVER an
  // editorial recipient — it is the operational ESRF inbox the
  // mailrelay/Apps Script should deliver the minimal notification
  // to. Documented default: office@esrf.net (kept as docs example,
  // never hardcoded here). The backend only forwards this metadata;
  // it does not send mail itself.
  const notifyRecipient = sanitizeNotifyRecipient(env.INTAKE_NOTIFY_TO);

  const issuePreview = buildIssuePreview(payload);
  const sharedSecret = String(env.SHEETS_WEBHOOK_SECRET || env.INTAKE_SHEET_WEBHOOK_SECRET || '').trim();

  // Workflow steps (running record). We append to this as we progress.
  const workflowSteps = [];
  const stepNow = () => new Date().toISOString();
  const recordStep = (name, status, detail) => {
    workflowSteps.push({ step: name, status, at: stepNow(), detail: detail || '' });
  };
  recordStep('received', 'ok', 'request_id=' + requestId);
  recordStep('validated', 'ok', 'mode=' + payload.intake_mode);

  const warnings = [];
  if (!turnstile.checked) warnings.push('TURNSTILE_SECRET_KEY not set — Turnstile skipped (validation mode).');
  if (sheetDryRun) warnings.push('Sheet webhook env not set (INTAKE_SHEET_WEBHOOK_URL / SHEETS_WEBHOOK_URL) — sheet flow in dry-run; no rows written.');
  if (issueDryRun) warnings.push('GITHUB_TOKEN/INTAKE_REPO not set — issue dry-run, no GitHub issue created.');
  if (!hasNotifyConfig) warnings.push('INTAKE_NOTIFY_WEBHOOK not set — notification in dry-run; nothing dispatched.');

  // 1) Optional GitHub issue (so the row payload can carry its url).
  let issueResult = null;
  if (!issueDryRun) {
    issueResult = await createGithubIssue(env, issuePreview);
    if (issueResult && issueResult.error) warnings.push('GitHub issue creation failed: ' + issueResult.error);
  }

  // 2) Build lab webhook payload. Includes intake row + optional editorial
  //    row + optional place candidate row + workflow events. The Apps
  //    Script writes each present row to its named LAB_* tab.
  const refs = {
    issue_url: (issueResult && issueResult.url) || '',
    issue_number: (issueResult && issueResult.number) || '',
  };
  const intakeRow = buildIntakeSubmissionRow(payload, refs);
  const editorialRow = (payload.editorial_contribution) ? buildEditorialIntakeRow(payload, refs) : null;
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
    rows: {
      [LAB_SPREADSHEET.tabs.intake_submissions]: intakeRow,
      ...(editorialRow ? { [LAB_SPREADSHEET.tabs.editorial_intake]: editorialRow } : {}),
      ...(placeCandidateRow ? { [LAB_SPREADSHEET.tabs.place_candidates]: placeCandidateRow } : {}),
    },
    // Backend log + workflow event are appended after dispatch (see below);
    // the Apps Script receives them in a single payload so it can write
    // all five tabs atomically per request.
    log: null,
    workflow_event: null,
    shared_secret_present: !!sharedSecret,
  };

  // 3) Send to sheet webhook (or stay in dry-run).
  let sheetResult = null;
  if (!sheetDryRun) {
    // Add log + workflow event for the live path.
    sheetWebhookPayload.log = buildBackendLogRow(payload, {
      request_id: requestId,
      status_code: 200,
      dry_run: false,
      validation_result: 'ok',
      workflow_step: 'stored',
    });
    sheetWebhookPayload.workflow_event = buildWorkflowEventRow(payload, {
      event_type: 'intake_received',
      workflow_step: 'stored',
      status_from: '',
      status_to: 'new',
      next_required_action: nextRequiredAction(payload, 'stored'),
      related_sheet: LAB_SPREADSHEET.tabs.intake_submissions,
    });
    sheetResult = await postSheetWebhook(sheetWebhookUrl, sheetWebhookPayload, sharedSecret)
      .catch(e => ({ error: String(e && e.message || e) }));
    if (sheetResult && sheetResult.error) {
      warnings.push('Sheet webhook failed: ' + sheetResult.error);
      recordStep('stored_or_dry_run', 'error', sheetResult.error);
    } else {
      recordStep('stored_or_dry_run', 'stored', 'rows_written=' + Object.keys(sheetWebhookPayload.rows).length);
    }
  } else {
    // Dry-run: still attach a preview log + workflow event so the
    // response shows exactly what the Apps Script would receive.
    sheetWebhookPayload.log = buildBackendLogRow(payload, {
      request_id: requestId,
      status_code: 200,
      dry_run: true,
      validation_result: 'ok',
      workflow_step: 'dry_run',
    });
    sheetWebhookPayload.workflow_event = buildWorkflowEventRow(payload, {
      event_type: 'intake_received_dry_run',
      workflow_step: 'dry_run',
      status_from: '',
      status_to: 'preview',
      next_required_action: nextRequiredAction(payload, 'dry_run'),
      related_sheet: LAB_SPREADSHEET.tabs.intake_submissions,
    });
    recordStep('stored_or_dry_run', 'dry_run', 'sheet webhook not configured');
  }

  // 4) Notification — minimal, no PII / no editorial body.
  const notificationMessage = buildNotificationMessage(payload, {
    request_id: requestId,
    submission_id: submissionId,
    workflow_status: sheetDryRun ? 'dry_run' : (sheetResult && sheetResult.error ? 'error' : 'stored'),
    next_required_action: nextRequiredAction(payload, sheetDryRun ? 'dry_run' : 'stored'),
    related_sheet: LAB_SPREADSHEET.tabs.intake_submissions,
    related_row: (sheetResult && sheetResult.row_id) || '',
    issue_url: refs.issue_url,
    notify_to: notifyRecipient,
  });

  // Forward the same minimal message to the Apps Script alongside the
  // sheet write so it can (optionally) trigger a MailApp notificatie
  // to the configured ESRF inbox without re-deriving fields. The
  // Apps Script only sends mail if its own NOTIFY_TO Script Property
  // is set; the Cloudflare backend never sends mail directly.
  sheetWebhookPayload.notification_message = notificationMessage;

  let notificationStatus;
  let notifyResult = null;
  if (!hasNotifyConfig) {
    notificationStatus = 'dry_run_not_configured';
    recordStep('notification_prepared_or_sent', 'dry_run_not_configured', 'INTAKE_NOTIFY_WEBHOOK absent');
  } else {
    notifyResult = await postNotification(env.INTAKE_NOTIFY_WEBHOOK, notificationMessage)
      .catch(e => ({ error: String(e && e.message || e) }));
    if (notifyResult && notifyResult.error) {
      notificationStatus = 'error';
      warnings.push('Notification dispatch failed: ' + notifyResult.error);
      recordStep('notification_prepared_or_sent', 'error', notifyResult.error);
    } else {
      notificationStatus = 'sent';
      recordStep('notification_prepared_or_sent', 'sent', '');
    }
  }

  const overallStatus = sheetDryRun ? 'dry_run' : (sheetResult && sheetResult.error ? 'error' : 'stored');
  const nextAction = nextRequiredAction(payload, overallStatus);
  recordStep('next_required_action', overallStatus, nextAction);

  const response = {
    ok: true,
    submission_id: submissionId,
    request_id: requestId,
    mode: payload.intake_mode,
    received_at: payload.meta.received_at,
    environment: payload.meta.environment,
    dry_run: sheetDryRun,
    sheet_dry_run: sheetDryRun,
    issue_dry_run: issueDryRun,
    workflow: {
      status: overallStatus,
      next_required_action: nextAction,
      steps: workflowSteps,
    },
    sheet: sheetDryRun
      ? null
      : (sheetResult && sheetResult.ok
          ? { row_id: sheetResult.row_id || null, sheet_url: sheetResult.sheet_url || null, rows_written: sheetResult.rows_written || null }
          : null),
    sheet_webhook_payload_preview: sheetWebhookPayload,
    issue: issueDryRun ? null : (issueResult && issueResult.url ? { url: issueResult.url, number: issueResult.number } : null),
    issue_preview: issueDryRun ? issuePreview : null,
    notification_status: notificationStatus,
    notification_message: notificationMessage,
    notification_sent: notificationStatus === 'sent',
    storage_architecture: {
      single_source_of_truth: 'google_sheet',
      spreadsheet_id: LAB_SPREADSHEET.spreadsheet_id,
      spreadsheet_label: LAB_SPREADSHEET.spreadsheet_label,
      target_prefix: LAB_SPREADSHEET.target_prefix,
      lab_tabs: LAB_SPREADSHEET.tabs,
      forbidden_targets: LAB_SPREADSHEET.forbidden_targets,
      evidence_record: 'github_issue',
      notification: 'esrf_mail_relay_or_webhook_minimal_no_pii',
      notification_recipient_default: notifyRecipient || '(not set; documented default: office@esrf.net)',
      note: 'Lab/preview writes only to LAB_* tabs. Directory_Master is never modified by this backend. The notification channel is an ESRF mailnotificatie / mailrelay-webhook (never Gmail-specific).',
    },
    warnings,
  };

  return cors(json(response, 200), origin);
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
    },
  });
}

// Anything else → 405
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
  if (!VALID_MODES.has(mode)) return { error: 'Invalid intake_mode (must be org, editorial, or both)' };

  const contact = body.contact && typeof body.contact === 'object' ? body.contact : {};
  const required = [
    ['name', contact.name],
    ['organisation', contact.organisation],
    ['role', contact.role],
    ['email', contact.email],
    ['country_code', contact.country_code],
  ];
  for (const [k, v] of required) {
    if (!v || !String(v).trim()) return { error: `Missing contact.${k}` };
  }
  const email = String(contact.email).trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Invalid contact.email' };
  const country = String(contact.country_code).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return { error: 'Invalid contact.country_code (must be ISO-3166 alpha-2)' };

  const cleanContact = {
    name: sanitize(contact.name),
    organisation: sanitize(contact.organisation),
    role: sanitize(contact.role),
    email: sanitize(email),
    phone: sanitize(contact.phone || ''),
    country_code: country,
    country_label: sanitize(contact.country_label || ''),
    place: sanitize(contact.place || ''),
    place_known: contact.place_known === false ? false : (contact.place_known === true ? true : null),
    place_addition_requested: !!contact.place_addition_requested,
    place_addition_candidate: sanitize(contact.place_addition_candidate || ''),
    place_addition_country: sanitize(contact.place_addition_country || '').toUpperCase().slice(0, 2),
    place_addition_region: sanitize(contact.place_addition_region || ''),
    region: sanitize(contact.region || ''),
    region_manual_override: !!contact.region_manual_override,
    region_suggestion_source: sanitize(contact.region_suggestion_source || ''),
    auto_suggested_region: sanitize(contact.auto_suggested_region || ''),
    website: sanitizeUrl(contact.website || ''),
  };

  const out = {
    meta: {
      environment: 'TEST/VALIDATIE',
      received_at: new Date().toISOString(),
      source: 'submit-validation.html',
    },
    intake_mode: mode,
    contact: cleanContact,
  };

  if (mode === 'org' || mode === 'both') {
    const org = body.organisation_listing && typeof body.organisation_listing === 'object' ? body.organisation_listing : {};
    if (!org.sector || !String(org.sector).trim()) return { error: 'Missing organisation_listing.sector' };
    if (!cleanContact.website || !/^https?:\/\//i.test(cleanContact.website)) {
      return { error: 'Organisation mode requires a valid contact.website (https://…)' };
    }
    out.organisation_listing = {
      sector: sanitize(org.sector),
      sector_label: sanitize(org.sector_label || ''),
      city: sanitize(org.city || cleanContact.place || ''),
      description: sanitizeLong(org.description || ''),
    };
  }

  if (mode === 'editorial' || mode === 'both') {
    const ed = body.editorial_contribution && typeof body.editorial_contribution === 'object' ? body.editorial_contribution : {};
    const edRequired = [['topic', ed.topic], ['summary', ed.summary], ['regional_angle', ed.regional_angle], ['lesson', ed.lesson]];
    for (const [k, v] of edRequired) if (!v || !String(v).trim()) return { error: `Missing editorial_contribution.${k}` };
    const consent = ed.consent && typeof ed.consent === 'object' ? ed.consent : {};
    if (!consent.edit_and_publish) return { error: 'editorial_contribution.consent.edit_and_publish is required' };
    if (!consent.editorial_may_contact) return { error: 'editorial_contribution.consent.editorial_may_contact is required' };
    if (!consent.no_confidential_information) return { error: 'editorial_contribution.consent.no_confidential_information is required' };
    out.editorial_contribution = {
      topic: sanitize(ed.topic),
      summary: sanitizeLong(ed.summary),
      audience: sanitize(ed.audience || ''),
      partners_sector: sanitizeLong(ed.partners_sector || ''),
      regional_angle: sanitizeLong(ed.regional_angle),
      lesson: sanitizeLong(ed.lesson),
      spotlight: sanitizeLong(ed.spotlight || ''),
      sources: sanitizeLong(ed.sources || ''),
      consent: {
        edit_and_publish: true,
        editorial_may_contact: true,
        no_confidential_information: true,
      },
    };
  }

  const privacy = body.privacy && typeof body.privacy === 'object' ? body.privacy : {};
  if (!privacy.gdpr_privacy_policy) return { error: 'privacy.gdpr_privacy_policy is required' };
  out.privacy = { gdpr_privacy_policy: true };

  return { payload: out };
}

// ─── Issue body construction (Markdown-safe) ─────────────────────────────

function buildIssuePreview(p) {
  const c = p.contact;
  const titleParts = [
    '[ESRF intake]',
    p.intake_mode,
    '—',
    c.organisation,
    '—',
    (c.country_label || c.country_code) + (c.region ? ('/' + c.region) : ''),
  ];
  const title = mdEscapeInline(titleParts.join(' ')).slice(0, 240);

  const labels = ['intake', 'needs-review', 'regional', 'mode:' + p.intake_mode];
  if (p.editorial_contribution) labels.push('editorial');
  if (p.organisation_listing) labels.push('organisation');

  const lines = [];
  lines.push('## ESRF.net intake — ' + p.intake_mode.toUpperCase());
  lines.push('');
  lines.push('_Received: ' + p.meta.received_at + ' · source: ' + p.meta.source + '_');
  lines.push('');
  lines.push('### Contact & organisation');
  lines.push(kv('Name', c.name));
  lines.push(kv('Organisation', c.organisation));
  lines.push(kv('Role', c.role));
  lines.push(kv('Email', c.email));
  if (c.phone) lines.push(kv('Phone', c.phone));
  lines.push(kv('Country', (c.country_label || '') + ' (' + c.country_code + ')'));
  if (c.place) {
    let placeLine = c.place + (c.place_known === false ? '  _(unknown — candidate for list)_' : '');
    lines.push(kv('Place', placeLine));
  }
  if (c.place_addition_requested) {
    lines.push(kv('Place addition', 'requested · ' + (c.place_addition_country || '–') + ' / ' + (c.place_addition_region || '–')));
  }
  if (c.region) lines.push(kv('Region', c.region + (c.region_suggestion_source ? '  _(' + c.region_suggestion_source + ')_' : '')));
  if (c.website) lines.push(kv('Website', c.website));
  lines.push('');

  if (p.organisation_listing) {
    const o = p.organisation_listing;
    lines.push('### Organisation listing');
    lines.push(kv('Sector', (o.sector_label || o.sector)));
    if (o.city) lines.push(kv('City', o.city));
    if (o.description) {
      lines.push('');
      lines.push('**Description:**');
      lines.push('');
      lines.push(quote(o.description));
    }
    lines.push('');
  }

  if (p.editorial_contribution) {
    const e = p.editorial_contribution;
    lines.push('### Editorial contribution');
    lines.push(kv('Topic', e.topic));
    if (e.audience) lines.push(kv('Audience', e.audience));
    lines.push('');
    lines.push('**Summary:**'); lines.push(''); lines.push(quote(e.summary)); lines.push('');
    lines.push('**Regional angle:**'); lines.push(''); lines.push(quote(e.regional_angle)); lines.push('');
    lines.push('**Lesson learned:**'); lines.push(''); lines.push(quote(e.lesson)); lines.push('');
    if (e.partners_sector) { lines.push('**Partners / sector:**'); lines.push(''); lines.push(quote(e.partners_sector)); lines.push(''); }
    if (e.spotlight) { lines.push('**Spotlight:**'); lines.push(''); lines.push(quote(e.spotlight)); lines.push(''); }
    if (e.sources) { lines.push('**Sources / facts:**'); lines.push(''); lines.push(quote(e.sources)); lines.push(''); }
    lines.push('**Consents:** edit+publish ✓ · editorial-may-contact ✓ · no-confidential ✓');
    lines.push('');
  }

  lines.push('### Privacy');
  lines.push('- GDPR privacy policy accepted: yes');
  lines.push('');
  lines.push('---');
  lines.push('_Auto-generated by `/api/intake` (validation environment). Personal data is masked in notifications; full details appear only in this private intake repo._');

  return { title, body: lines.join('\n'), labels };
}

function kv(k, v) { return '- **' + k + ':** ' + (mdEscapeInline(String(v == null ? '' : v))); }
function quote(s) { return String(s || '').split('\n').map(l => '> ' + l).join('\n'); }

// ─── External calls (issue + sheet webhook + notification) ───────────────

async function createGithubIssue(env, preview) {
  const repo = String(env.INTAKE_REPO || '').trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { error: 'INTAKE_REPO must be "owner/repo"' };
  const url = 'https://api.github.com/repos/' + repo + '/issues';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'authorization': 'Bearer ' + env.GITHUB_TOKEN,
        'accept': 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'esrf-intake-bot',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({ title: preview.title, body: preview.body, labels: preview.labels }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { error: 'GitHub ' + res.status + ': ' + t.slice(0, 200) };
    }
    const j = await res.json();
    return { url: j.html_url, number: j.number };
  } catch (e) {
    return { error: String(e && e.message || e) };
  }
}

async function postSheetWebhook(webhookUrl, payload, sharedSecret) {
  try {
    const headers = { 'content-type': 'application/json', 'user-agent': 'esrf-intake-bot' };
    if (sharedSecret) headers['x-esrf-intake-secret'] = sharedSecret;
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { error: 'Sheet ' + res.status + ': ' + t.slice(0, 200) };
    }
    let j = null;
    try { j = await res.json(); } catch { j = null; }
    return {
      ok: true,
      row_id: (j && (j.row_id || j.id)) || '',
      sheet_url: (j && j.sheet_url) || '',
      rows_written: (j && j.rows_written) || null,
    };
  } catch (e) {
    return { error: String(e && e.message || e) };
  }
}

async function postNotification(webhookUrl, message) {
  const res = await fetch(String(webhookUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'esrf-intake-bot' },
    body: JSON.stringify(message),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { error: 'Notify ' + res.status + ': ' + t.slice(0, 120) };
  }
  return { ok: true };
}

// ─── LAB_* row builders ──────────────────────────────────────────────────
//
// These match the documented LAB_* tab headers exactly. The backend never
// emits Directory_Master rows.

function buildIntakeSubmissionRow(payload, refs) {
  const c = payload.contact || {};
  const o = payload.organisation_listing || null;
  const e = payload.editorial_contribution || null;
  const m = payload.meta || {};
  const submissionType = e && o ? 'org+editorial' : (e ? 'editorial' : 'org');
  return {
    submission_id: m.submission_id || '',
    received_at: m.received_at || '',
    environment: m.environment || '',
    submission_type: submissionType,
    mode: payload.intake_mode || '',
    org_id_match: '',
    name: c.organisation || '',
    website: c.website || '',
    country_code: c.country_code || '',
    country_name_local: c.country_label || '',
    region: c.region || '',
    city_raw: c.place || (o ? (o.city || '') : ''),
    city_match_status: c.place_known === false ? 'unknown' : (c.place_known === true ? 'known' : ''),
    sector_raw: o ? (o.sector_label || o.sector || '') : '',
    description_en: o ? (o.description || '') : '',
    contact_name: c.name || '',
    contact_email: c.email || '',
    contact_role: c.role || '',
    consent_publish: e ? 'yes' : (o ? 'listing' : ''),
    source_url: m.source || '',
    notes_submitter: '',
    review_status: 'new',
    next_required_action: nextRequiredAction(payload, 'received'),
    assigned_to: '',
    due_date: '',
    linked_editorial_id: '',
    notification_status: 'pending',
    notification_last_sent_at: '',
    created_by_flow: 'submit-validation.html',
    raw_payload_json: '', // intentionally empty — the editorial body lives on LAB_Editorial_Intake
    review_notes_internal: '',
    issue_url: (refs && refs.issue_url) || '',
    issue_number: (refs && refs.issue_number) || '',
  };
}

function buildEditorialIntakeRow(payload, refs) {
  const c = payload.contact || {};
  const e = payload.editorial_contribution || {};
  const m = payload.meta || {};
  const editorialId = generateId('ed');
  return {
    editorial_id: editorialId,
    received_at: m.received_at || '',
    environment: m.environment || '',
    submission_id: m.submission_id || '',
    org_id_match: '',
    organization_name: c.organisation || '',
    title: e.topic || '',
    type: 'regional_editorial',
    language: 'nl',
    summary: e.summary || '',
    body_md_or_url: e.regional_angle || '',
    topic_tags: '',
    region: c.region || '',
    country_code: c.country_code || '',
    contact_name: c.name || '',
    contact_email: c.email || '',
    consent_publish: 'yes',
    editorial_status: 'received',
    next_required_action: 'Editorial review by redactie',
    assigned_to: '',
    due_date: '',
    publication_url: '',
    notification_status: 'pending',
    review_notes_internal: '',
    issue_url: (refs && refs.issue_url) || '',
  };
}

function needsPlaceCandidateRow(payload) {
  const c = payload.contact || {};
  if (c.place_addition_requested) return true;
  if (c.place_known === false && c.place) return true;
  return false;
}

function buildPlaceCandidateRow(payload) {
  const c = payload.contact || {};
  const m = payload.meta || {};
  const candidateId = generateId('place');
  return {
    candidate_id: candidateId,
    first_seen_at: m.received_at || '',
    last_seen_at: m.received_at || '',
    environment: m.environment || '',
    city_raw: c.place_addition_candidate || c.place || '',
    country_code: c.place_addition_country || c.country_code || '',
    region: c.place_addition_region || c.region || '',
    submission_count: 1,
    suggested_match: '',
    review_status: 'new',
    next_required_action: 'Verify candidate place; if accepted, add to lookup list via PR',
    merged_to_option: '',
    notification_status: 'pending',
    review_notes_internal: '',
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
    dry_run: !!opts.dry_run,
    validation_result: opts.validation_result || '',
    workflow_step: opts.workflow_step || '',
    notification_event: opts.notification_event || '',
    notification_status: opts.notification_status || '',
    error_message: opts.error_message || '',
    ip_country: '',
    user_agent_hash: '',
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
    notification_channel: 'esrf_mail_relay_or_webhook',
    notification_status: opts.notification_status || 'pending',
    message_summary: opts.message_summary || '',
    related_sheet: opts.related_sheet || '',
    related_row: opts.related_row || '',
    related_url: opts.related_url || '',
  };
}

// ─── Minimal notification (no PII / no editorial body) ───────────────────

function buildNotificationMessage(payload, ctx) {
  const c = payload.contact || {};
  // Recipient metadata: included only when explicitly configured.
  // The recipient is operational (the ESRF inbox the mailrelay should
  // deliver to, e.g. office@esrf.net) — NOT an editorial address.
  // We only ever surface a sanitised recipient or omit the field.
  const notifyTo = sanitizeNotifyRecipient(ctx.notify_to);
  const message = {
    schema_version: 1,
    submission_id: ctx.submission_id || '',
    request_id: ctx.request_id || '',
    environment: payload.meta.environment,
    mode: payload.intake_mode,
    type: payload.editorial_contribution
      ? (payload.organisation_listing ? 'org+editorial' : 'editorial')
      : 'org',
    org_name: c.organisation || '',
    country: c.country_code || '',
    region: c.region || '',
    workflow_status: ctx.workflow_status || '',
    next_required_action: ctx.next_required_action || '',
    related_sheet: ctx.related_sheet || '',
    related_row: ctx.related_row || '',
    issue_url: ctx.issue_url || '',
    notification_channel: 'esrf_mail_relay_or_webhook',
    note: 'Minimal ESRF mailnotificatie / mailrelay payload. Contains no PII (no email/phone/name) and no editorial body. Recipient (when set) is the operational ESRF inbox, not an editorial submitter address.',
  };
  if (notifyTo) message.notify_to_recipient = notifyTo;
  return message;
}

// Recipient sanitiser. We never reflect arbitrary email addresses
// from user input — only the operator-controlled INTAKE_NOTIFY_TO
// env var (or an explicit ctx override). The check is intentionally
// strict so a misconfigured value cannot leak as a notification
// recipient.
function sanitizeNotifyRecipient(value) {
  if (value == null) return '';
  const v = String(value).trim();
  if (!v) return '';
  if (v.length > 254) return '';
  if (!/^[^@\s<>"']+@[^@\s<>"']+\.[^@\s<>"']+$/.test(v)) return '';
  return v;
}

function nextRequiredAction(payload, stage) {
  if (stage === 'dry_run') {
    return 'Configure SHEETS_WEBHOOK_URL (or INTAKE_SHEET_WEBHOOK_URL) to enable lab sheet writes; review preview in submit-validation.html.';
  }
  if (payload.editorial_contribution) {
    return 'Editorial review in LAB_Editorial_Intake; redactie decides accept/reject and assigns an editor.';
  }
  if (payload.contact && payload.contact.place_addition_requested) {
    return 'Verify place candidate in LAB_Place_Candidates before merging into the lookup list.';
  }
  return 'Triage organisation listing in LAB_Intake_Submissions; verify org match against Directory_Master (read-only).';
}

// ─── Anti-bot helpers ────────────────────────────────────────────────────

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
  // Short timestamp + random suffix. No randomness assumptions beyond
  // uniqueness within a single deploy/preview environment.
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 0x100000).toString(36).padStart(4, '0');
  return prefix + '_' + t + '_' + r;
}

/** Strip HTML, control chars, dangerous quotes; trim and cap. */
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
function mdEscapeInline(s) {
  return String(s == null ? '' : s).replace(/[\\`*_{}\[\]<>]/g, c => '\\' + c);
}

// Backward-compat alias kept for the existing test harness.
function buildSheetRow(payload, refs) {
  payload.meta = payload.meta || {};
  if (!payload.meta.submission_id) payload.meta.submission_id = generateId('sub');
  return buildIntakeSubmissionRow(payload, refs);
}

// Test hooks (Node/CI only — Workers ignores `globalThis` writes per request)
if (typeof globalThis !== 'undefined') {
  globalThis.__esrfIntake = {
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
  };
}
