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
 *   - SHARED_SECRET   — must match the Cloudflare backend's
 *                       SHEETS_WEBHOOK_SECRET (or
 *                       INTAKE_SHEET_WEBHOOK_SECRET). Required.
 *   - SPREADSHEET_ID  — fallback spreadsheet id. Optional; this script
 *                       can also rely on the active spreadsheet (when
 *                       deployed as a container-bound script).
 *
 * Deployment:
 *   - Deploy → New deployment → "Web app".
 *   - Execute as: Me. Who has access: Anyone with the link.
 *   - Copy the /exec URL into Cloudflare Pages env var
 *     INTAKE_SHEET_WEBHOOK_URL (or SHEETS_WEBHOOK_URL).
 *
 * Reference only — DO NOT paste real secrets into this file. Set the
 * shared secret via Script Properties; this file checks it but never
 * stores it.
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
    var expectedSecret = props.getProperty('SHARED_SECRET') || '';
    if (!expectedSecret) {
      return jsonOut(500, { ok: false, error: 'SHARED_SECRET not configured' });
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

    var ss = openSpreadsheet(body.spreadsheet_id || EXPECTED_SPREADSHEET_ID);
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

    return jsonOut(200, {
      ok: true,
      row_id: primaryRowId,
      sheet_url: primarySheetUrl,
      rows_written: written
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
