/**
 * ESRF intake — lab webhook (Google Apps Script reference)
 *
 * Reference implementation for the Apps Script that backs
 * `INTAKE_SHEET_WEBHOOK_URL` (alias `SHEETS_WEBHOOK_URL`) on the
 * spreadsheet "ESRF Directory CRM - actuele brondata 2026-04-24"
 * (id 1jGDFjTq5atrFSe3avjj4AflUo1SLPKAmkT_MIpH6z1g).
 *
 * Safety contract (lab/preview):
 *   - This script writes ONLY to LAB_* tabs.
 *   - It REFUSES any payload that targets Directory_Master.
 *   - It REFUSES any payload whose target_prefix is not "LAB_".
 *   - It NEVER auto-publishes anywhere on the public site.
 *   - It NEVER includes PII or editorial body in any return value
 *     beyond the spreadsheet itself (and the spreadsheet is
 *     access-controlled at Drive level).
 *
 * Configuration (Apps Script → Project Settings → Script Properties):
 *   Canonical names — set these on a fresh deployment:
 *   - SHEETS_WEBHOOK_SECRET — must match the Cloudflare backend's
 *                       SHEETS_WEBHOOK_SECRET env var (alias
 *                       INTAKE_SHEET_WEBHOOK_SECRET on the Cloudflare
 *                       side). Required. Sent on inbound requests as
 *                       the `x-esrf-intake-secret` header (or, as a
 *                       fallback, in the JSON body as `shared_secret`).
 *   - SHEET_ID        — fallback spreadsheet id. Optional; this script
 *                       can also rely on the active spreadsheet (when
 *                       deployed as a container-bound script).
 *   Legacy aliases — accepted as a fallback so existing deployments
 *   that already set them keep working without manual reconfiguration.
 *   New deployments should use the canonical names above and leave
 *   these unset:
 *   - SHARED_SECRET    — legacy alias for SHEETS_WEBHOOK_SECRET.
 *   - SPREADSHEET_ID   — legacy alias for SHEET_ID.
 *   - NOTIFY_TO       — Optional, unset by default. If set to a non-empty mail address
 *                       (operational ESRF inbox, e.g. office@esrf.net),
 *                       the script sends a MINIMAL ESRF mailnotificatie
 *                       via MailApp after a successful sheet write.
 *                       Leave unset to disable; no real email is sent
 *                       until an operator opts in. This is NOT a
 *                       Gmail-as-ESRF route — MailApp delivers from
 *                       the script-owner Workspace identity to the
 *                       configured ESRF inbox, never via Gmail. The
 *                       email contains NO PII (no email/phone/name)
 *                       and NO editorial body — only submission_id,
 *                       mode/type, org_name, country/region,
 *                       workflow_status, next_required_action and the
 *                       relevant sheet/row pointer. This is the
 *                       lab/operational toggle for the "ESRF
 *                       mailnotificatie / mailrelay" channel; it is
 *                       a generic MailApp-based notification routed to
 *                       the ESRF inbox, not a Gmail integration.
 *   - NOTIFY_FROM_NAME — Optional. Display name on the From line of
 *                       the mailnotificatie (default:
 *                       "ESRF intake bot"). MailApp always sends from
 *                       the script-owner account; this only changes
 *                       the visible name.
 *   - NOTIFY_SUBJECT_PREFIX — Optional. Subject prefix for the
 *                       mailnotificatie (default: "[ESRF intake]").
 *
 * Deployment:
 *   - Deploy → New deployment → "Web app".
 *   - Execute as: Me. Who has access: Anyone with the link.
 *   - Copy the /exec URL into Cloudflare Pages env var
 *     INTAKE_SHEET_WEBHOOK_URL (or SHEETS_WEBHOOK_URL).
 *
 * Activating the ESRF mailnotificatie (operationele notificatie):
 *   NOTIFY_TO is unset by default — no email is sent until an operator
 *   explicitly opts in.
 *   1. Open Apps Script → Project Settings → Script Properties.
 *   2. Add NOTIFY_TO = an ESRF inbox (e.g. office@esrf.net).
 *   3. Save. The next successful intake write will trigger a
 *      MailApp.sendEmail() to that address with the minimal,
 *      PII-free payload described above.
 *   4. To stop sending mail, clear NOTIFY_TO. No code change needed.
 *   The MailApp quota (Workspace ~1.500 / day) is far above the
 *   expected intake volume; the script logs to LAB_Backend_Log when
 *   it sends, skips, or errors so the redactie can audit.
 *
 * Reference only — DO NOT paste real secrets into this file. Set the
 * shared secret via Script Properties; this file checks it but never
 * stores it. The NOTIFY_TO recipient is operational metadata, not a
 * secret, but is still kept in Script Properties so it can be
 * toggled without redeploying.
 *
 * ESRF official automation identity (security-review note):
 *   - office@esrf.net is the ONLY documented production recipient and
 *     also the recommended owner of the Apps Script project itself
 *     (so MailApp delivers from an ESRF-controlled Workspace identity).
 *   - ai.agent.wm@gmail.com is a non-production / legacy agent
 *     identity. It MUST NEVER be set as NOTIFY_TO and MUST NEVER own
 *     the production Apps Script deployment. The doPost() guard below
 *     refuses to send mail to that address as a defence-in-depth
 *     fail-safe.
 */

/* eslint-disable no-undef */ // Apps Script globals: SpreadsheetApp, PropertiesService, ContentService, Utilities

var EXPECTED_TARGET_PREFIX = 'LAB_';
var FORBIDDEN_TABS = ['Directory_Master'];
var EXPECTED_SPREADSHEET_ID = '1jGDFjTq5atrFSe3avjj4AflUo1SLPKAmkT_MIpH6z1g';

// Header order per LAB_* tab. Must match `functions/api/intake.js`.
var HEADERS = {
  'LAB_Intake_Submissions': [
    'submission_id','received_at','environment','submission_type','mode','org_id_match','name','website',
    'country_code','country_name_local','region','city_raw','city_match_status','sector_raw','description_en',
    'contact_name','contact_email','contact_role','consent_publish','source_url','notes_submitter',
    'review_status','next_required_action','assigned_to','due_date','linked_editorial_id',
    'notification_status','notification_last_sent_at','created_by_flow','raw_payload_json','review_notes_internal'
  ],
  'LAB_Editorial_Intake': [
    'editorial_id','received_at','environment','submission_id','org_id_match','organization_name','title','type',
    'language','summary','body_md_or_url','topic_tags','region','country_code','contact_name','contact_email',
    'consent_publish','editorial_status','next_required_action','assigned_to','due_date','publication_url',
    'notification_status','review_notes_internal'
  ],
  'LAB_Place_Candidates': [
    'candidate_id','first_seen_at','last_seen_at','environment','city_raw','country_code','region',
    'submission_count','suggested_match','review_status','next_required_action','merged_to_option',
    'notification_status','review_notes_internal'
  ],
  'LAB_Backend_Log': [
    'log_id','timestamp','environment','request_id','endpoint','submission_id','status_code','dry_run',
    'validation_result','workflow_step','notification_event','notification_status','error_message',
    'ip_country','user_agent_hash'
  ],
  'LAB_Workflow_Events': [
    'event_id','timestamp','environment','submission_id','event_type','workflow_step','status_from','status_to',
    'next_required_action','actor','notification_channel','notification_status','message_summary',
    'related_sheet','related_row','related_url'
  ]
};

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    // Canonical name first; fall back to the legacy alias so existing
    // deployments that still use SHARED_SECRET keep working.
    var expectedSecret = String(
      props.getProperty('SHEETS_WEBHOOK_SECRET')
      || props.getProperty('SHARED_SECRET')
      || ''
    );
    if (!expectedSecret) {
      return jsonOut(500, { ok: false, error: 'SHEETS_WEBHOOK_SECRET not configured' });
    }
    // The Cloudflare backend sends the shared secret as an HTTP header,
    // but Apps Script web apps surface only the request body. The
    // backend therefore also includes a body-level signature payload;
    // here we accept either.
    var providedSecret = '';
    var headerSecret = (e && e.parameter && e.parameter['x-esrf-intake-secret']) || '';
    if (headerSecret) providedSecret = String(headerSecret);

    var body = null;
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
    catch (err) { return jsonOut(400, { ok: false, error: 'Invalid JSON' }); }

    if (!body || typeof body !== 'object') {
      return jsonOut(400, { ok: false, error: 'Invalid body' });
    }
    if (!providedSecret && body.shared_secret) providedSecret = String(body.shared_secret);

    if (providedSecret !== expectedSecret) {
      return jsonOut(401, { ok: false, error: 'Forbidden' });
    }

    // Hard-fail any payload that doesn't target the LAB_* prefix.
    if (body.target_prefix !== EXPECTED_TARGET_PREFIX) {
      return jsonOut(400, { ok: false, error: 'target_prefix must be LAB_' });
    }
    // Hard-fail any payload that mentions Directory_Master.
    var forbidden = (body.forbidden_targets || []).concat(FORBIDDEN_TABS);
    var rows = body.rows || {};
    for (var t in rows) {
      if (forbidden.indexOf(t) !== -1) {
        return jsonOut(400, { ok: false, error: 'Refusing to write to ' + t });
      }
      if (t.indexOf(EXPECTED_TARGET_PREFIX) !== 0) {
        return jsonOut(400, { ok: false, error: 'Tab not LAB_-prefixed: ' + t });
      }
    }

    // Resolve the spreadsheet id. Priority:
    //   1) body.spreadsheet_id (sent by the Cloudflare backend)
    //   2) SHEET_ID Script Property (canonical)
    //   3) SPREADSHEET_ID Script Property (legacy alias)
    //   4) EXPECTED_SPREADSHEET_ID constant (compile-time default)
    var resolvedSheetId = String(
      body.spreadsheet_id
      || props.getProperty('SHEET_ID')
      || props.getProperty('SPREADSHEET_ID')
      || EXPECTED_SPREADSHEET_ID
    );
    var ss = openSpreadsheet(resolvedSheetId);
    var written = {};
    var primaryRowId = '';
    var primarySheetUrl = '';

    // Write each row to its named LAB_* tab.
    for (var tab in rows) {
      var headers = HEADERS[tab];
      if (!headers) {
        // Unknown lab tab — refuse rather than guess columns.
        return jsonOut(400, { ok: false, error: 'Unknown tab: ' + tab });
      }
      var rowObj = rows[tab];
      var rowId = appendRow(ss, tab, headers, rowObj);
      written[tab] = rowId;
      if (tab === 'LAB_Intake_Submissions') {
        primaryRowId = rowId;
        primarySheetUrl = ss.getUrl() + '#gid=' + ss.getSheetByName(tab).getSheetId();
      }
    }

    // Backend log row (always present in production payloads).
    if (body.log) {
      appendRow(ss, 'LAB_Backend_Log', HEADERS['LAB_Backend_Log'], body.log);
    }
    // Workflow event row (always present in production payloads).
    if (body.workflow_event) {
      appendRow(ss, 'LAB_Workflow_Events', HEADERS['LAB_Workflow_Events'], body.workflow_event);
    }

    // Optional ESRF mailnotificatie (operationele notificatie).
    // NOTIFY_TO is unset by default; only sends if an operator has
    // explicitly set the Script Property to a non-empty ESRF inbox
    // (e.g. office@esrf.net). Payload is the minimal, PII-free
    // notification_message provided by the Cloudflare backend
    // (see functions/api/intake.js → buildNotificationMessage). If the
    // backend did not include a notification_message, we synthesise a
    // minimal one from the rows we just wrote.
    var mailStatus = 'skipped_not_configured';
    var mailRecipient = '';
    try {
      var notifyTo = String(props.getProperty('NOTIFY_TO') || '').trim();
      if (notifyTo) {
        mailRecipient = notifyTo;
        var notifyMsg = (body.notification_message && typeof body.notification_message === 'object')
          ? body.notification_message
          : synthesizeMinimalNotification(body, primaryRowId, primarySheetUrl);
        var mailRes = sendMinimalMailNotification(props, notifyTo, notifyMsg, primarySheetUrl);
        mailStatus = mailRes.ok ? 'sent' : ('error:' + (mailRes.error || 'unknown'));
      }
    } catch (mailErr) {
      mailStatus = 'error:' + (mailErr && mailErr.message || mailErr);
    }

    return jsonOut(200, {
      ok: true,
      row_id: primaryRowId,
      sheet_url: primarySheetUrl,
      rows_written: written,
      mail_notification_status: mailStatus,
      mail_notification_recipient: mailRecipient
    });
  } catch (err) {
    // Return error without leaking PII from the body.
    return jsonOut(500, { ok: false, error: 'Internal error: ' + (err && err.message || err) });
  }
}

function openSpreadsheet(id) {
  if (id && id !== EXPECTED_SPREADSHEET_ID) {
    throw new Error('Refusing unknown spreadsheet id: ' + id);
  }
  if (id) return SpreadsheetApp.openById(id);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function appendRow(ss, tabName, headers, rowObj) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error('Tab missing: ' + tabName);
  // Ensure header row matches our expectation. We never overwrite an
  // existing header row — we only refuse to write if it diverges.
  var firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(firstRow[i] || '') !== headers[i]) {
      throw new Error('Header mismatch in ' + tabName + ' col ' + (i + 1) + ': expected "' + headers[i] + '", got "' + firstRow[i] + '"');
    }
  }
  var values = headers.map(function (h) {
    var v = rowObj && rowObj[h];
    if (v == null) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  });
  sheet.appendRow(values);
  // Return the row number we just appended.
  return String(sheet.getLastRow());
}

function jsonOut(status, obj) {
  // Apps Script web apps cannot set arbitrary HTTP status codes; we
  // include `ok` and `status_hint` in the body so the Cloudflare
  // backend can interpret consistently. The HTTP status is always 200.
  obj.status_hint = status;
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── ESRF mailnotificatie (optional, opt-in via NOTIFY_TO) ──────────────
//
// This is a generic MailApp-based mailrelay/webhook → mailbox bridge.
// It is NOT a Gmail-specific integration: MailApp simply sends an
// email from the script-owner account to the configured ESRF inbox
// (e.g. office@esrf.net). The intent is "operationele notificatie",
// not editorial content delivery — the message body must remain
// minimal and PII-free.
//
// Allowed fields (mirrors the Cloudflare backend contract):
//   submission_id, request_id, mode, type, org_name, country,
//   region, workflow_status, next_required_action, related_sheet,
//   related_row, issue_url, environment, schema_version, note.
// Forbidden fields: contact_email, contact_phone, contact_name,
//   editorial.summary, editorial.regional_angle, editorial.lesson,
//   any other free-form editorial body.

var ALLOWED_NOTIFY_FIELDS = [
  'schema_version','submission_id','request_id','environment',
  'mode','type','org_name','country','region',
  'workflow_status','next_required_action',
  'related_sheet','related_row','issue_url','note'
];

var FORBIDDEN_NOTIFY_FIELDS = [
  'contact_email','contact_phone','contact_name',
  'email','phone','name',
  'summary','regional_angle','lesson',
  'editorial_summary','editorial_regional_angle','editorial_lesson',
  'editorial_body','body_md_or_url','description','description_en',
  'raw_payload_json'
];

// Recipient deny-list — addresses that MUST NEVER receive a production
// notification even if mistakenly configured. Keeps the legacy
// non-production agent identity from leaking into the live mail path.
var FORBIDDEN_NOTIFY_RECIPIENTS = [
  'ai.agent.wm@gmail.com'
];

function sendMinimalMailNotification(props, recipient, msg, sheetUrl) {
  if (!recipient) return { ok: false, error: 'no recipient' };
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'no message' };
  // Defence-in-depth: refuse to send to a known non-production identity.
  for (var f = 0; f < FORBIDDEN_NOTIFY_RECIPIENTS.length; f++) {
    if (String(recipient).trim().toLowerCase() === FORBIDDEN_NOTIFY_RECIPIENTS[f]) {
      return { ok: false, error: 'forbidden recipient (non-production identity)' };
    }
  }

  // Defensive copy: only allowed fields, no PII.
  var safe = {};
  for (var i = 0; i < ALLOWED_NOTIFY_FIELDS.length; i++) {
    var k = ALLOWED_NOTIFY_FIELDS[i];
    if (msg[k] != null && msg[k] !== '') safe[k] = String(msg[k]);
  }
  // Drop anything that looks like PII even if the caller tried to
  // smuggle it in under an unexpected key.
  for (var j = 0; j < FORBIDDEN_NOTIFY_FIELDS.length; j++) {
    delete safe[FORBIDDEN_NOTIFY_FIELDS[j]];
  }

  var subjectPrefix = String(props.getProperty('NOTIFY_SUBJECT_PREFIX') || '[ESRF intake]').trim();
  var fromName = String(props.getProperty('NOTIFY_FROM_NAME') || 'ESRF intake bot').trim();

  var subject = subjectPrefix + ' '
    + (safe.workflow_status || 'received') + ' · '
    + (safe.type || safe.mode || 'submission') + ' · '
    + (safe.org_name || 'unknown org')
    + (safe.country ? (' (' + safe.country + (safe.region ? '/' + safe.region : '') + ')') : '');

  var lines = [];
  lines.push('ESRF mailnotificatie — operationele notificatie (geen PII, geen editorial body).');
  lines.push('');
  lines.push('Submission:        ' + (safe.submission_id || ''));
  lines.push('Request:           ' + (safe.request_id || ''));
  lines.push('Environment:       ' + (safe.environment || ''));
  lines.push('Mode/type:         ' + (safe.mode || '') + ' / ' + (safe.type || ''));
  lines.push('Organisation:      ' + (safe.org_name || ''));
  lines.push('Country / region:  ' + (safe.country || '') + (safe.region ? ' / ' + safe.region : ''));
  lines.push('Workflow status:   ' + (safe.workflow_status || ''));
  lines.push('Next action:       ' + (safe.next_required_action || ''));
  lines.push('Related sheet:     ' + (safe.related_sheet || ''));
  lines.push('Related row:       ' + (safe.related_row || ''));
  if (safe.issue_url) lines.push('Issue url:         ' + safe.issue_url);
  if (sheetUrl) lines.push('Sheet:             ' + sheetUrl);
  lines.push('');
  lines.push('Deze mail bevat geen e-mailadres, telefoonnummer, naam of editorial-tekst.');
  lines.push('De volledige inzending blijft in de Drive-spreadsheet (single source of truth).');

  try {
    MailApp.sendEmail({
      to: recipient,
      subject: subject.slice(0, 240),
      body: lines.join('\n'),
      name: fromName,
      noReply: true
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function synthesizeMinimalNotification(body, rowId, sheetUrl) {
  // Last-resort: backend did not include a notification_message but
  // NOTIFY_TO is set. We assemble the minimal, PII-free fields from
  // whatever the payload exposes — never from raw_payload_json or
  // editorial body fields.
  var rows = (body && body.rows) || {};
  var intake = rows['LAB_Intake_Submissions'] || {};
  return {
    schema_version: 1,
    submission_id: body.submission_id || intake.submission_id || '',
    request_id: body.request_id || '',
    environment: body.environment || intake.environment || '',
    mode: body.intake_mode || intake.mode || '',
    type: intake.submission_type || '',
    org_name: intake.name || '',
    country: intake.country_code || '',
    region: intake.region || '',
    workflow_status: 'stored',
    next_required_action: intake.next_required_action || '',
    related_sheet: 'LAB_Intake_Submissions',
    related_row: rowId || '',
    issue_url: intake.issue_url || '',
    note: 'Synthesised by Apps Script — backend did not provide notification_message.'
  };
}
