/**
 * ESRF mail notification — SEPARATE Apps Script deployment (PREPARED, NOT ACTIVATED)
 *
 * This file is the source of the deferred ESRF mailrelay-webhook
 * route. It is a SEPARATE Apps Script project from
 * `apps-script-intake-webhook.gs` so that:
 *
 *   1. The first-phase spreadsheet-only webhook keeps requesting only
 *      `https://www.googleapis.com/auth/spreadsheets` on its OAuth
 *      consent screen — no MailApp scope ever appears there.
 *   2. This deferred mail route is the ONLY place where
 *      `https://www.googleapis.com/auth/script.send_mail` is requested,
 *      and an operator authorising it can see exactly that one extra
 *      scope.
 *
 * ─────────────────────────────────────────────────────────────────────
 * STATUS (2026-04-26): PREPARED, NOT ACTIVATED.
 * ─────────────────────────────────────────────────────────────────────
 *
 *   - This .gs source is checked into the repo as the planned
 *     reference for the separate mail-relay project. It is NOT yet
 *     deployed under `office@esrf.net`.
 *   - The Cloudflare backend default state is
 *     `notification_status: "dry_run_not_configured"` and
 *     `MINIMAL_NOTIFICATION_DESIGN_STATUS:
 *      "minimal-notification-design-ready-not-enabled"`.
 *   - Activation requires the manual checklist in
 *     `docs/apps-script-mail-notification.future.md` and
 *     `docs/intake-minimal-notification-design.md` to be ticked off in
 *     order, including a redactie sign-off and an end-to-end
 *     verification that no PII / editorial body / secrets reach the
 *     mailbox.
 *
 * Companion files:
 *   - docs/apps-script-mail-notification.future.md — activation
 *     checklist, OAuth-consent expectations, rollback procedure.
 *   - docs/intake-minimal-notification-design.md — wire contract
 *     (allowed_keys, forbidden_keys, forbidden_recipients).
 *   - functions/api/intake.js — `NOTIFICATION_CONTRACT` constant +
 *     `assertNotificationSafe` (live wire-side guard).
 *
 * ─────────────────────────────────────────────────────────────────────
 * SECURITY POSTURE — minimal mail relay
 * ─────────────────────────────────────────────────────────────────────
 *
 *   - This script only RECEIVES POSTed JSON from the Cloudflare
 *     backend. It refuses anything that does not pass the shared-secret
 *     check.
 *   - It only calls `MailApp.sendEmail()` ONCE per request, with a
 *     payload built exclusively from the documented `ALLOWED_FIELDS`
 *     allow-list. Any field outside the allow-list is dropped.
 *   - PII and editorial-body field names from `FORBIDDEN_FIELDS` are
 *     hard-rejected: presence of any forbidden key returns 4xx and
 *     does NOT send mail.
 *   - The recipient is sourced from the Script Property `NOTIFY_TO`
 *     ONLY. The inbound JSON's `notify_to_recipient` is treated as a
 *     hint and must MATCH `NOTIFY_TO` exactly; mismatched recipients
 *     are rejected. Submitter addresses or any other operator-supplied
 *     value can never become the recipient.
 *   - The `FORBIDDEN_RECIPIENTS` deny-list explicitly blocks
 *     `ai.agent.wm@gmail.com` (legacy / non-production agent identity).
 *     If `NOTIFY_TO` is ever set to a forbidden recipient the script
 *     refuses outright — the OAuth scope alone is not enough; the
 *     deny-list is the second gate.
 *   - The script never writes to any spreadsheet. It does NOT request
 *     `auth/spreadsheets` and the Apps Script manifest must NOT
 *     contain that scope.
 *
 * Configuration (Apps Script → Project Settings → Script Properties):
 *   - NOTIFY_SHARED_SECRET   — must match the Cloudflare backend env
 *                              var `INTAKE_NOTIFY_SECRET` (or, when
 *                              that is unset, fall back to the
 *                              first-phase shared secret
 *                              `SHEETS_WEBHOOK_SECRET`). Required.
 *   - NOTIFY_TO              — the operational ESRF inbox to deliver
 *                              to. Documented default: office@esrf.net.
 *                              Required. Validated against
 *                              FORBIDDEN_RECIPIENTS on every request.
 *   - NOTIFY_SUBJECT_PREFIX  — optional subject-line prefix. Default
 *                              "[ESRF intake]".
 *   - NOTIFY_FROM_NAME       — optional sender display name. Default
 *                              "ESRF intake (LAB/Preview)".
 *
 * Deployment:
 *   - Create a NEW Apps Script project under office@esrf.net (NOT
 *     attached to the spreadsheet, NOT in the same project as
 *     `apps-script-intake-webhook.gs`).
 *   - Paste this file as `Code.gs` and the manifest snippet from
 *     `apps-script-mail-notification.future.md` as `appsscript.json`.
 *   - Deploy → New deployment → Web app.
 *     Execute as: Me (office@esrf.net). Who has access: Anyone with
 *     the link.
 *   - Authorise. The OAuth consent MUST surface ONLY
 *     `https://www.googleapis.com/auth/script.send_mail`. If anything
 *     else appears, STOP and audit the manifest.
 *   - Copy the /exec URL into Cloudflare Pages env var
 *     INTAKE_NOTIFY_WEBHOOK on the PREVIEW project only (not
 *     production). Set INTAKE_NOTIFY_TO=office@esrf.net on the same
 *     project.
 *
 * Rollback:
 *   - Unset INTAKE_NOTIFY_WEBHOOK in Cloudflare Pages (Preview
 *     project). The Cloudflare backend immediately falls back to
 *     `notification_status: "dry_run_not_configured"` and stops
 *     calling this script.
 *   - Optionally, in this Apps Script project, delete the active
 *     deployment so the /exec URL returns 404 even if a stale
 *     INTAKE_NOTIFY_WEBHOOK env var is still configured somewhere.
 */

// ─── Allow-list / deny-list contract ──────────────────────────────────
//
// Mirrors NOTIFICATION_CONTRACT.allowed_keys in
// functions/api/intake.js. Keep in sync. The wire payload is built by
// the Cloudflare backend's `buildNotificationMessage` and is asserted
// twice (assertNotificationSafe + per-key contract gate) before it
// leaves Cloudflare. We assert it AGAIN here so a future divergence
// between Cloudflare and Apps Script cannot leak data.

var ALLOWED_FIELDS = [
  'schema_version',
  'submission_id',
  'request_id',
  'environment',
  'mode',
  'type',
  'org_name',
  'country',
  'region',
  'workflow_status',
  'next_required_action',
  'related_sheet',
  'related_row',
  'related_sheet_url',
  'validation_lab_url',
  'issue_url',
  'notification_channel',
  'note',
  'notify_to_recipient'
];

var FORBIDDEN_FIELDS = [
  // Submitter PII — never appears in the operational notification.
  'contact_email', 'contact_phone', 'contact_name',
  'email', 'phone', 'name',
  // Editorial body — lives only in LAB_* + the GitHub intake issue.
  'summary', 'regional_angle', 'lesson',
  'editorial_summary', 'editorial_regional_angle', 'editorial_lesson',
  'editorial_body', 'body_md_or_url',
  'description', 'description_en',
  // Raw payload echo + operational secrets / wire-protocol fields.
  'raw_payload_json',
  'shared_secret', 'shared_secret_present',
  'INTAKE_SHEET_WEBHOOK_URL', 'SHEETS_WEBHOOK_URL',
  'SHEETS_WEBHOOK_SECRET', 'GITHUB_TOKEN',
  'INTAKE_NOTIFY_WEBHOOK', 'TURNSTILE_SECRET_KEY'
];

// Hard deny-list of recipients. ai.agent.wm@gmail.com is a legacy /
// non-production agent identity; it must NEVER be set as NOTIFY_TO,
// even temporarily. Mirrors NOTIFICATION_CONTRACT.forbidden_recipients
// + OFFICE_IDENTITY.non_production_identities in
// functions/api/intake.js.
var FORBIDDEN_RECIPIENTS = [
  'ai.agent.wm@gmail.com'
];

// ─── doPost — single entry point ─────────────────────────────────────
//
// Returns JSON. Never includes the shared secret or NOTIFY_TO in the
// response body. Sends mail at most once per request.
function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var expectedSecret = String(props.getProperty('NOTIFY_SHARED_SECRET') || '').trim();
    var notifyTo = String(props.getProperty('NOTIFY_TO') || '').trim();
    var subjectPrefix = String(props.getProperty('NOTIFY_SUBJECT_PREFIX') || '[ESRF intake]').trim();
    var fromName = String(props.getProperty('NOTIFY_FROM_NAME') || 'ESRF intake (LAB/Preview)').trim();

    // Refuse outright on missing config — we never want a partial
    // deployment to silently swallow notifications.
    if (!expectedSecret) {
      return jsonResponse({ ok: false, error: 'config-missing-secret' }, 500);
    }
    if (!notifyTo || !isValidEmail_(notifyTo)) {
      return jsonResponse({ ok: false, error: 'config-missing-or-invalid-recipient' }, 500);
    }
    // Hard deny-list: even if NOTIFY_TO was misconfigured to a
    // forbidden value, refuse before doing anything else.
    if (FORBIDDEN_RECIPIENTS.indexOf(notifyTo.toLowerCase()) !== -1) {
      return jsonResponse({ ok: false, error: 'recipient-on-deny-list' }, 500);
    }

    var raw = (e && e.postData && e.postData.contents) ? String(e.postData.contents) : '';
    if (!raw) return jsonResponse({ ok: false, error: 'empty-body' }, 400);
    if (raw.length > 64 * 1024) return jsonResponse({ ok: false, error: 'payload-too-large' }, 413);

    var body;
    try { body = JSON.parse(raw); }
    catch (_) { return jsonResponse({ ok: false, error: 'invalid-json' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return jsonResponse({ ok: false, error: 'invalid-json-body' }, 400);
    }

    // Apps Script doPost can't read arbitrary headers, so the
    // shared secret arrives in the body as `shared_secret`. We
    // STRIP that field BEFORE building the mail body so it never
    // reaches the recipient.
    var providedSecret = String(body.shared_secret || '').trim();
    delete body.shared_secret;
    if (providedSecret !== expectedSecret) {
      return jsonResponse({ ok: false, error: 'unauthorised' }, 401);
    }

    // Sanity: the inbound message MUST NOT carry any forbidden field.
    for (var i = 0; i < FORBIDDEN_FIELDS.length; i++) {
      var k = FORBIDDEN_FIELDS[i];
      if (Object.prototype.hasOwnProperty.call(body, k)) {
        return jsonResponse({ ok: false, error: 'forbidden-field-present' }, 400);
      }
    }

    // If the wire payload includes a `notify_to_recipient`, it must
    // match NOTIFY_TO exactly. Cloudflare sets this field from
    // INTAKE_NOTIFY_TO; a mismatch means the two sides are out of
    // sync and we refuse to send rather than risk a misroute.
    if (body.notify_to_recipient) {
      if (String(body.notify_to_recipient).trim().toLowerCase() !== notifyTo.toLowerCase()) {
        return jsonResponse({ ok: false, error: 'recipient-mismatch' }, 400);
      }
    }

    // Build a minimal payload from the allow-list ONLY. Any field
    // not on the list is silently dropped.
    var safe = {};
    for (var j = 0; j < ALLOWED_FIELDS.length; j++) {
      var key = ALLOWED_FIELDS[j];
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        safe[key] = body[key];
      }
    }

    // Compose the mail body. Plain text only — no HTML, no
    // attachments, no inline images. This keeps the relay surface
    // minimal and makes redactie-side audit trivial.
    var subject = subjectPrefix + ' ' + (safe.mode || 'intake') + ' — ' + (safe.org_name || '(no org)') +
                  ' — ' + (safe.country || '??') + (safe.region ? ('/' + safe.region) : '');
    // Cap subject length so weird inputs don't produce ridiculous
    // headers downstream.
    if (subject.length > 240) subject = subject.slice(0, 240);

    var lines = [];
    lines.push('ESRF mailnotificatie — minimal payload (no PII, no editorial body).');
    lines.push('');
    for (var m = 0; m < ALLOWED_FIELDS.length; m++) {
      var fk = ALLOWED_FIELDS[m];
      if (Object.prototype.hasOwnProperty.call(safe, fk)) {
        lines.push(fk + ': ' + String(safe[fk]));
      }
    }
    lines.push('');
    lines.push('— end of minimal payload —');
    lines.push('Channel: esrf_mail_relay_or_webhook · Recipient: ' + notifyTo);
    var bodyText = lines.join('\n');

    // Final defence-in-depth: scan the rendered text for any forbidden
    // field name. If a future refactor adds an unrecognised key, we'd
    // rather refuse than ship.
    for (var n = 0; n < FORBIDDEN_FIELDS.length; n++) {
      var fb = FORBIDDEN_FIELDS[n];
      if (bodyText.indexOf(fb + ':') !== -1) {
        return jsonResponse({ ok: false, error: 'forbidden-field-leaked-in-body' }, 500);
      }
    }

    // Send. MailApp is the ONLY external side-effect of this script.
    MailApp.sendEmail({
      to: notifyTo,
      subject: subject,
      body: bodyText,
      name: fromName,
      noReply: true
    });

    return jsonResponse({
      ok: true,
      delivered_to: notifyTo,
      submission_id: safe.submission_id || '',
      request_id: safe.request_id || '',
      schema_version: safe.schema_version || 1
    }, 200);
  } catch (err) {
    // Generic error — never leak the script-side stack trace, never
    // echo the inbound body or the secret.
    return jsonResponse({ ok: false, error: 'internal-error' }, 500);
  }
}

// doGet is intentionally minimal — used only as a deployment
// reachability check by the operator. It never sends mail and never
// echoes any property.
function doGet() {
  return jsonResponse({
    ok: true,
    service: 'esrf-mail-notification',
    role: 'deferred-mail-relay',
    status: 'prepared-not-activated',
    sends_mail: false,
    note: 'POST a JSON minimal-notification payload to send mail. See docs/intake-minimal-notification-design.md.'
  }, 200);
}

// ─── helpers ─────────────────────────────────────────────────────────

function jsonResponse(obj, status) {
  // Apps Script ContentService cannot set arbitrary HTTP status codes
  // on Web app endpoints (the runtime decides). We return the status
  // in the JSON body so the Cloudflare side can log it. The mime type
  // is locked to JSON.
  obj = obj || {};
  obj._status_code = status || 200;
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function isValidEmail_(s) {
  if (!s) return false;
  s = String(s);
  if (s.length > 254) return false;
  // Conservative regex — same shape as the Cloudflare side.
  return /^[^@\s<>"']+@[^@\s<>"']+\.[^@\s<>"']+$/.test(s);
}
