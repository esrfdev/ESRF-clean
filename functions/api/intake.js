// Cloudflare Pages Function — POST /api/intake
//
// Validation-environment backend for the integrated organisation + editorial
// intake form (submit-validation.html). Lives on the
// `test/regional-editorial-contributor-intake` branch — NOT production.
//
// Behaviour:
//   - Defaults to "dry-run" mode: validates, sanitizes, returns a structured
//     preview of what *would* be sent to the private intake repo. No data
//     leaves Cloudflare unless env vars are explicitly configured.
//   - If `GITHUB_TOKEN` + `INTAKE_REPO` are set, opens a GitHub issue against
//     that private repo (used for the eventual production workflow).
//   - If `INTAKE_NOTIFY_WEBHOOK` is set, posts a minimal notification (no
//     PII beyond org/country/region/mode).
//   - If `TURNSTILE_SECRET_KEY` is set, verifies the Turnstile token.
//
// No secrets are ever returned to the client. Personal data is minimised in
// notifications. This endpoint refuses anything that is not a JSON POST.

const ALLOWED_ORIGINS = [
  'https://www.esrf.net',
  'https://esrf.net',
  // Cloudflare Pages branch preview (validation-only)
  'https://test-regional-editorial-cont.esrf-clean.pages.dev',
];
// Pages spawns a unique preview hostname per deploy on the same project.
// We additionally allow any *.esrf-clean.pages.dev origin during validation.
const ALLOWED_ORIGIN_SUFFIX = '.esrf-clean.pages.dev';

const MAX_BODY_BYTES = 64 * 1024;       // 64 KiB hard cap on the JSON body
const MAX_FIELD_LENGTH = 600;           // enough for the longest editorial textarea
const MAX_LONG_FIELD_LENGTH = 2000;     // small headroom for combined preview text
const MIN_FORM_DURATION_MS = 2500;      // matches the client-side guard

const VALID_MODES = new Set(['org', 'editorial', 'both']);

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('origin') || '';

  if (!isAllowedOrigin(origin)) {
    return cors(jsonErr('Forbidden origin', 403), origin);
  }

  // Reject obvious non-JSON content
  const contentType = (request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return cors(jsonErr('Content-Type must be application/json', 415), origin);
  }

  // Hard size cap (the body is read once)
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

  // Decide storage path (real vs dry-run)
  const hasIssueConfig = !!(env.GITHUB_TOKEN && env.INTAKE_REPO);
  const hasNotifyConfig = !!env.INTAKE_NOTIFY_WEBHOOK;
  const dryRun = !hasIssueConfig;

  const issuePreview = buildIssuePreview(payload);
  let issueResult = null;
  let notifyResult = null;
  const warnings = [];

  if (!turnstile.checked) warnings.push('TURNSTILE_SECRET_KEY not set — Turnstile skipped (validation mode).');
  if (dryRun) warnings.push('GITHUB_TOKEN/INTAKE_REPO not set — dry-run only, no issue created.');
  if (!hasNotifyConfig) warnings.push('INTAKE_NOTIFY_WEBHOOK not set — no notification dispatched.');

  if (!dryRun) {
    issueResult = await createGithubIssue(env, issuePreview);
    if (issueResult && issueResult.error) warnings.push('GitHub issue creation failed: ' + issueResult.error);
  }
  if (hasNotifyConfig) {
    notifyResult = await postNotification(env, payload).catch(e => ({ error: String(e && e.message || e) }));
    if (notifyResult && notifyResult.error) warnings.push('Notification dispatch failed: ' + notifyResult.error);
  }

  const response = {
    ok: true,
    mode: payload.intake_mode,
    dry_run: dryRun,
    received_at: new Date().toISOString(),
    issue: dryRun ? null : (issueResult && issueResult.url ? { url: issueResult.url, number: issueResult.number } : null),
    issue_preview: dryRun ? issuePreview : null,
    notification_sent: !!(notifyResult && notifyResult.ok),
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

// ─── External calls (issue + notification) ───────────────────────────────

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

async function postNotification(env, payload) {
  // Minimal payload: NEVER includes editorial body, contact email, or phone.
  const c = payload.contact;
  const minimal = {
    environment: payload.meta.environment,
    received_at: payload.meta.received_at,
    intake_mode: payload.intake_mode,
    organisation: c.organisation,
    country: c.country_code,
    region: c.region || '',
    has_editorial: !!payload.editorial_contribution,
    has_listing: !!payload.organisation_listing,
  };
  const res = await fetch(String(env.INTAKE_NOTIFY_WEBHOOK), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'esrf-intake-bot' },
    body: JSON.stringify(minimal),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { error: 'Notify ' + res.status + ': ' + t.slice(0, 120) };
  }
  return { ok: true };
}

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
/** Same as sanitize, but allows newlines and a longer cap (for textareas). */
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
/** Escape characters that would break out of an inline Markdown context. */
function mdEscapeInline(s) {
  return String(s == null ? '' : s).replace(/[\\`*_{}\[\]<>]/g, c => '\\' + c);
}

// Test hooks (Node/CI only — Workers ignores `globalThis` writes per request)
if (typeof globalThis !== 'undefined') {
  globalThis.__esrfIntake = {
    validateAndSanitize,
    buildIssuePreview,
    sanitize,
    sanitizeLong,
    sanitizeUrl,
    isAllowedOrigin,
    mdEscapeInline,
  };
}
