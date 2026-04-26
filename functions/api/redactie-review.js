// Cloudflare Pages Function — POST /api/redactie-review
//
// Preview-only LAB read endpoint that the redactie review page calls to
// list LAB_Intake_Submissions / LAB_Editorial_Intake rows. Designed to
// be safe by default:
//
//   1. Preview-only:  production short-circuits to 404 before any work.
//   2. Origin allowlist: same set as /api/intake.
//   3. Access-code gate: a server-validated review access code
//      (env var REDACTIE_REVIEW_ACCESS_CODE) gates real-data reads.
//      Without the env var, the endpoint returns SAMPLE/dry-run data
//      and a clear `mode: 'sample'` flag so the UI can show a banner
//      instead of silently appearing empty.
//   4. Read-only contract: the endpoint never accepts edits; it never
//      writes; it never touches Directory_Master.
//   5. PII safety: contact details are stripped by default. Operators
//      may opt in by sending `include_contact: true` AND a valid
//      access code. Sample mode never returns contact details.
//   6. Defence-in-depth: response is filtered through a forbidden-key
//      check (`raw_payload_json`, `shared_secret*`, `*_TOKEN`, etc.)
//      before being returned.
//
// The Apps Script read webhook contract is documented in
// docs/redactie-validation-form.md. Activation requires:
//
//   - REDACTIE_REVIEW_WEBHOOK_URL    : the /exec URL of the read-only
//                                       Apps Script Web App
//   - REDACTIE_REVIEW_WEBHOOK_SECRET : shared secret sent in the body
//                                       (matched in Apps Script)
//   - REDACTIE_REVIEW_ACCESS_CODE    : access code the redactie types
//                                       in the UI (server-validated
//                                       here, NEVER stored client-side)
//
// If any of those three is missing, the endpoint returns sample data
// and an `activation` payload that lists the missing config. This is
// the documented "lab fallback" behaviour.

import {
  isAllowedOrigin,
  cors,
  json,
  jsonErr,
  generateId,
  LAB_SPREADSHEET,
  MAX_BODY_BYTES,
} from './intake.js';

// ── Config ───────────────────────────────────────────────────────────────

const REVIEW_MAX_BODY_BYTES = 4096; // tiny: only filters + access code
const REVIEW_FETCH_TIMEOUT_MS = 8000;

// Forbidden keys that must never appear in a response, even by accident
// (e.g. if the Apps Script returns more than we asked for). Mirrors the
// notification contract in intake.js but tightened for this read path.
const FORBIDDEN_RESPONSE_KEYS = [
  'raw_payload_json',
  'shared_secret',
  'shared_secret_present',
  'INTAKE_SHEET_WEBHOOK_URL',
  'SHEETS_WEBHOOK_URL',
  'SHEETS_WEBHOOK_SECRET',
  'GITHUB_TOKEN',
  'INTAKE_NOTIFY_WEBHOOK',
  'TURNSTILE_SECRET_KEY',
  'REDACTIE_REVIEW_ACCESS_CODE',
  'REDACTIE_REVIEW_WEBHOOK_URL',
  'REDACTIE_REVIEW_WEBHOOK_SECRET',
];

const CONTACT_KEYS = ['contact', 'contact_internal'];

// ── Sample data — identical fixtures to redactie-validation.html so the
//    UI behaves the same when the real LAB read isn't yet wired. Kept
//    here on the server too so the endpoint is self-contained and
//    cannot accidentally leak real rows in fallback mode. ────────────
const SAMPLE_RECORDS = [
  {
    record_type: 'org',
    submission_id: 'sub_lab_demo_001',
    received_at: '2026-04-26T10:05:00Z',
    environment: 'TEST/VALIDATIE',
    source_tab: 'LAB_Intake_Submissions',
    source_row_hint: 'rij 4',
    title: 'ESRF Lab Test Voorbeeld Organisatie',
    organization_name: 'ESRF Lab Test Voorbeeld Organisatie',
    type_label: 'Organisatie-aanmelding',
    type: 'org',
    region: 'Utrecht',
    country_code: 'NL',
    country_name_local: 'Nederland',
    sector_raw: 'Civil society / NGO',
    summary: 'Fictieve lab-test organisatie ter validatie van het redactieformulier en de directory-candidate flow. Geen echte gegevens.',
    website: 'https://example.org/lab-fixture',
    consent_publish: 'listing',
    process_step: 'binnengekomen',
    review_status: 'in_review',
    reminder: 'Controleer of organisatie al voorkomt in Directory (org_id_match leeg).',
    next_required_action: 'Controleer dubbel + ken sector toe',
    assigned_to: 'redactie',
    due_date: '2026-05-03',
    review_notes_internal: ''
  },
  {
    record_type: 'editorial',
    submission_id: 'sub_lab_demo_002',
    editorial_id: 'ed_lab_demo_002',
    received_at: '2026-04-26T10:00:00Z',
    environment: 'TEST/VALIDATIE',
    source_tab: 'LAB_Editorial_Intake',
    source_row_hint: 'rij 3',
    title: 'Voorbeeld regionale leadership lesson — Rotterdam 2026',
    organization_name: 'Stichting Voorbeeld Regionaal',
    type_label: 'Editorial bijdrage',
    type: 'regional_editorial',
    region: 'Rotterdam-Rijnmond',
    country_code: 'NL',
    language: 'nl',
    topic_tags: 'Leiderschap, Regio, Voorbeeld',
    summary: 'Korte samenvatting van een regionale leadership lesson voor lab-redactietest. Inhoud is fictief.',
    body_md_or_url: '## Inleiding\n\nFictieve regionale tekst.\n\n## Lesson\n\nGedeelde paraatheid versterkt regionale weerbaarheid.',
    consent_publish: 'yes',
    process_step: 'in_review',
    review_status: 'in_review',
    reminder: 'Checkvraag: zit er een citeerbare bron of cijfer in dat redactie moet verifiëren?',
    next_required_action: 'Verifieer feiten + kies publicatievenster',
    assigned_to: 'redactie',
    due_date: '2026-05-03',
    review_notes_internal: ''
  }
];

// Status → process step → reminder mapping. Surfaced through the read
// response so the redactie-validation UI can show a short reminder per
// step without baking copy into the frontend twice.
const STATUS_STEP_REMINDERS = {
  binnengekomen: 'Net binnengekomen — controleer of de organisatie/inzending al bestaat en wijs sector/tags toe voordat je in review zet.',
  in_review: 'In review — controleer feiten, regio en bronnen; zet vervolgstap en deadline.',
  wachten_op_indiener: 'Wacht op indiener — noteer welke verheldering nodig is en wie wanneer contact opneemt.',
  klaar_voor_akkoord: 'Klaar voor akkoord — controleer review_notes_internal voordat je in de Sheet op approved zet.',
  akkoord_voor_promote: 'Goedgekeurd — gereed voor handmatige lab-promotion via scripts/lab_promote/cli. Directory_Master niet aanpassen.',
  afgewezen: 'Afgewezen — leg in review_notes_internal vast waarom; geen vervolgactie.',
  gearchiveerd: 'Gearchiveerd — alleen leesbaar, geen verdere stappen.'
};

// ── Helpers ──────────────────────────────────────────────────────────────

function isPreviewEnv(env) {
  const explicit = String(env.ESRF_PREVIEW || '').trim().toLowerCase();
  if (explicit === 'true' || explicit === '1' || explicit === 'yes') return true;
  const branch = String(env.CF_PAGES_BRANCH || '').trim();
  if (!branch) return false;
  if (branch === 'main') return false;
  return true;
}

function stripContact(record) {
  if (!record || typeof record !== 'object') return record;
  const out = {};
  for (const k of Object.keys(record)) {
    if (CONTACT_KEYS.indexOf(k) !== -1) continue;
    out[k] = record[k];
  }
  return out;
}

function stripForbiddenKeys(record) {
  if (!record || typeof record !== 'object') return record;
  if (Array.isArray(record)) return record.map(stripForbiddenKeys);
  const out = {};
  for (const k of Object.keys(record)) {
    if (FORBIDDEN_RESPONSE_KEYS.indexOf(k) !== -1) continue;
    const v = record[k];
    out[k] = (v && typeof v === 'object') ? stripForbiddenKeys(v) : v;
  }
  return out;
}

function constantTimeEquals(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= (sa.charCodeAt(i) ^ sb.charCodeAt(i));
  return diff === 0;
}

function safeRecords(records, includeContact) {
  if (!Array.isArray(records)) return [];
  return records.map(function(r){
    const cleaned = stripForbiddenKeys(r);
    if (includeContact) return cleaned;
    return stripContact(cleaned);
  });
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

async function fetchLabRecords(env, requestId) {
  const url = String(env.REDACTIE_REVIEW_WEBHOOK_URL || '').trim();
  const secret = String(env.REDACTIE_REVIEW_WEBHOOK_SECRET || '').trim();
  if (!url || !secret) {
    return { ok: false, missing: true, records: [] };
  }
  const body = {
    schema_version: 1,
    op: 'read_redactie_review',
    target_prefix: LAB_SPREADSHEET.target_prefix,
    spreadsheet_id: LAB_SPREADSHEET.spreadsheet_id,
    forbidden_targets: LAB_SPREADSHEET.forbidden_targets,
    tabs: [
      LAB_SPREADSHEET.tabs.intake_submissions,
      LAB_SPREADSHEET.tabs.editorial_intake,
    ],
    request_id: requestId,
    shared_secret: secret,
  };
  let res;
  try {
    res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, REVIEW_FETCH_TIMEOUT_MS);
  } catch (e) {
    return { ok: false, error: 'upstream_unreachable', records: [] };
  }
  if (!res.ok) {
    return { ok: false, error: 'upstream_status_' + res.status, records: [] };
  }
  let data;
  try { data = await res.json(); }
  catch { return { ok: false, error: 'upstream_invalid_json', records: [] }; }
  if (!data || typeof data !== 'object' || !Array.isArray(data.records)) {
    return { ok: false, error: 'upstream_invalid_shape', records: [] };
  }
  return { ok: true, records: data.records };
}

// ── Main handler ─────────────────────────────────────────────────────────

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('origin') || '';
  const requestId = generateId('req-redactie');

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
  if (raw.length > REVIEW_MAX_BODY_BYTES) {
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
  const includeContact = body.include_contact === true;
  const accessConfigured = !!expectedAccessCode;
  const accessValid = accessConfigured && accessCode.length > 0
    && constantTimeEquals(expectedAccessCode, accessCode);

  // Sample/dry-run is the safe default. We only flip to real LAB mode
  // when ALL of: access code configured, access code provided, access
  // code matches AND the upstream webhook is configured.
  if (!accessConfigured) {
    return cors(json({
      ok: true,
      mode: 'sample',
      access: {
        configured: false,
        valid: false,
        message: 'access code not configured — sample mode active',
      },
      activation_required: [
        'REDACTIE_REVIEW_ACCESS_CODE env var (gates real LAB read)',
        'REDACTIE_REVIEW_WEBHOOK_URL env var (Apps Script /exec)',
        'REDACTIE_REVIEW_WEBHOOK_SECRET env var (shared secret)',
      ],
      records: safeRecords(SAMPLE_RECORDS, false),
      status_step_reminders: STATUS_STEP_REMINDERS,
      target_prefix: LAB_SPREADSHEET.target_prefix,
      forbidden_targets: LAB_SPREADSHEET.forbidden_targets,
      directory_master_touched: false,
      automatic_publication: false,
      warning: 'LAB only · sample/dry-run · geen automatische publicatie · Directory_Master niet aanpassen.',
      request_id: requestId,
    }, 200), origin);
  }
  if (!accessValid) {
    // Constant-time-ish: do not signal whether the value was empty vs
    // wrong. We still return 200 with sample data so the UI can render
    // the access panel without exception handling.
    return cors(json({
      ok: true,
      mode: 'sample',
      access: {
        configured: true,
        valid: false,
        message: 'review code missing or incorrect — sample mode active',
      },
      records: safeRecords(SAMPLE_RECORDS, false),
      status_step_reminders: STATUS_STEP_REMINDERS,
      target_prefix: LAB_SPREADSHEET.target_prefix,
      forbidden_targets: LAB_SPREADSHEET.forbidden_targets,
      directory_master_touched: false,
      automatic_publication: false,
      warning: 'LAB only · sample/dry-run · geen automatische publicatie · Directory_Master niet aanpassen.',
      request_id: requestId,
    }, 200), origin);
  }

  // Access code is valid. Try the real LAB read. If the webhook isn't
  // configured, fall back to sample data with a clear activation note.
  const fetched = await fetchLabRecords(env, requestId);
  if (!fetched.ok) {
    return cors(json({
      ok: true,
      mode: 'sample',
      access: {
        configured: true,
        valid: true,
        message: fetched.missing
          ? 'access code valid but read webhook not configured — sample mode active'
          : 'access code valid but upstream read failed — sample mode active',
      },
      activation_required: fetched.missing ? [
        'REDACTIE_REVIEW_WEBHOOK_URL env var (Apps Script /exec)',
        'REDACTIE_REVIEW_WEBHOOK_SECRET env var (shared secret)',
      ] : undefined,
      upstream_error: fetched.error || undefined,
      records: safeRecords(SAMPLE_RECORDS, false),
      status_step_reminders: STATUS_STEP_REMINDERS,
      target_prefix: LAB_SPREADSHEET.target_prefix,
      forbidden_targets: LAB_SPREADSHEET.forbidden_targets,
      directory_master_touched: false,
      automatic_publication: false,
      warning: 'LAB only · sample/dry-run · geen automatische publicatie · Directory_Master niet aanpassen.',
      request_id: requestId,
    }, 200), origin);
  }

  const cleaned = safeRecords(fetched.records, includeContact);
  return cors(json({
    ok: true,
    mode: 'lab',
    access: {
      configured: true,
      valid: true,
      contact_included: !!includeContact,
      message: 'access code valid · live LAB read',
    },
    records: cleaned,
    status_step_reminders: STATUS_STEP_REMINDERS,
    target_prefix: LAB_SPREADSHEET.target_prefix,
    forbidden_targets: LAB_SPREADSHEET.forbidden_targets,
    directory_master_touched: false,
    automatic_publication: false,
    warning: 'LAB only · live read · contactgegevens alleen bij expliciete include_contact toggle. Directory_Master niet aanpassen.',
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
  SAMPLE_RECORDS,
  STATUS_STEP_REMINDERS,
  FORBIDDEN_RESPONSE_KEYS,
  stripContact,
  stripForbiddenKeys,
  constantTimeEquals,
  isPreviewEnv,
  safeRecords,
};

if (typeof globalThis !== 'undefined') {
  globalThis.__esrfRedactieReviewApi = {
    SAMPLE_RECORDS,
    STATUS_STEP_REMINDERS,
    FORBIDDEN_RESPONSE_KEYS,
    stripContact,
    stripForbiddenKeys,
    constantTimeEquals,
    isPreviewEnv,
    safeRecords,
    onRequest,
    onRequestPost,
  };
}
