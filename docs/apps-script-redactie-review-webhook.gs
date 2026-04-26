/**
 * ESRF redactie review — LAB read + dry-run / append-only update webhook
 * (Google Apps Script reference, SPREADSHEET-ONLY)
 *
 * Reference implementation for the Apps Script Web App that backs the
 * `REDACTIE_REVIEW_WEBHOOK_URL` env var on the Cloudflare Pages preview
 * project. Pairs with `docs/appsscript.redactie-review.json` (Sheets-only
 * OAuth manifest) and is consumed by:
 *
 *   - functions/api/redactie-review.js          (read)
 *   - functions/api/redactie-review-update.js   (dry-run / future write)
 *
 * Spreadsheet (single source of truth):
 *   "ESRF Directory CRM - actuele brondata 2026-04-24"
 *   id 1jGDFjTq5atrFSe3avjj4AflUo1SLPKAmkT_MIpH6z1g
 *
 * ─────────────────────────────────────────────────────────────────────
 * SECURITY POSTURE — SPREADSHEET-ONLY, LAB-ONLY, READ-FIRST
 * ─────────────────────────────────────────────────────────────────────
 *
 *   • doPost only. No doGet handler — the web app cannot be browsed.
 *   • No MailApp / GmailApp / UrlFetchApp / external service calls.
 *     The OAuth consent screen MUST surface ONLY:
 *
 *         https://www.googleapis.com/auth/spreadsheets
 *
 *     If `script.send_mail`, `gmail.*`, `script.external_request`,
 *     `drive.*` or any other scope appears, STOP — a forbidden API
 *     reference has crept back into the source.
 *
 *   • Reads ONLY:
 *         LAB_Intake_Submissions
 *         LAB_Editorial_Intake
 *       (optionally LAB_Place_Candidates if the action explicitly asks)
 *
 *   • Writes ONLY (append-only):
 *         LAB_Workflow_Events     — append a workflow event row
 *         LAB_Redactie_Reviews    — append a redactie review entry
 *                                    (this script can lazily create the
 *                                     tab if missing, with safe headers)
 *
 *   • Hard deny-list: Directory_Master and any tab not prefixed `LAB_`.
 *     Even if the inbound payload tries to spoof a target, the script
 *     refuses; even if a tab name is `LAB_Directory_Master_Mirror`, it
 *     is rejected because it is not in the allow-list.
 *
 *   • PII contract: contact_name / contact_email / contact_phone /
 *     contact_role are returned ONLY when the inbound payload sets
 *     `include_contact: true` AND the shared secret matches. Even then
 *     the response carries an `access.contact_included: true` flag so
 *     the Cloudflare layer can audit the disclosure.
 *
 *   • Edits never overwrite the original row. The script appends a
 *     redactieversie row to LAB_Redactie_Reviews with explicit
 *     `redactie_*` columns alongside the source `submission_id` —
 *     audit-preserving, never destructive.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Configuration (Apps Script → Project Settings → Script Properties)
 * ─────────────────────────────────────────────────────────────────────
 *
 *   Canonical names (preferred — match Cloudflare env var names):
 *     - REDACTIE_REVIEW_WEBHOOK_SECRET
 *           shared secret. Must equal the Cloudflare env var of the
 *           same name. Required.
 *     - SHEET_ID
 *           spreadsheet id; defaults to the constant below if absent.
 *
 *   Legacy aliases (accepted as fallback, do not set on new projects):
 *     - REVIEW_WEBHOOK_SECRET
 *     - SHARED_SECRET
 *     - SPREADSHEET_ID
 *
 *   NO mail / notify properties are read by this script.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Inbound contract
 * ─────────────────────────────────────────────────────────────────────
 *
 *   POST application/json
 *   {
 *     "schema_version": 1,
 *     "action": "list_records" | "get_record" | "submit_review_update"
 *               | "dry_run_update",
 *     "shared_secret": "<must match REDACTIE_REVIEW_WEBHOOK_SECRET>",
 *
 *     // optional, both default to false / safe behaviour
 *     "include_contact": false,
 *     "include_place_candidates": false,
 *
 *     // for get_record
 *     "submission_id": "...",
 *
 *     // for submit_review_update / dry_run_update
 *     "review_update": { ... },
 *     "edited_publication_proposal": { ... },
 *     "original_reference": { ... },
 *     "changed_fields": [...],
 *     "target_tab": "LAB_Redactie_Reviews" | "LAB_Workflow_Events",
 *
 *     // legacy alias the Cloudflare read endpoint sends today
 *     "op": "read_redactie_review"
 *   }
 *
 *   Response envelope (always 200; status nuance via `ok` and
 *   `status_hint` because Apps Script web apps cannot set HTTP status):
 *
 *   {
 *     "ok": true | false,
 *     "mode": "lab" | "dry_run",
 *     "action": "...",
 *     "records": [...],
 *     "record": { ... },                          // get_record only
 *     "update_result": { ... },                   // submit/dry_run only
 *     "warnings": [...],
 *     "directory_master_touched": false,          // ALWAYS false
 *     "automatic_publication": false,             // ALWAYS false
 *     "target_prefix": "LAB_",
 *     "forbidden_targets": ["Directory_Master"],
 *     "status_hint": 200,
 *     "request_id": "<echoed if provided>"
 *   }
 *
 * ─────────────────────────────────────────────────────────────────────
 * Deployment
 * ─────────────────────────────────────────────────────────────────────
 *
 *   1. New, *separate* Apps Script project under office@esrf.net
 *      (do NOT reuse the intake project — the OAuth scope set differs).
 *   2. Paste this file as Code.gs.
 *   3. Paste docs/appsscript.redactie-review.json into the project's
 *      manifest (after enabling "Show appsscript.json manifest file").
 *   4. Project Settings → Script Properties:
 *        REDACTIE_REVIEW_WEBHOOK_SECRET = <strong random>
 *        SHEET_ID                       = <spreadsheet id>
 *   5. Run __authorizeSpreadsheetAccessOnly() once. Confirm consent
 *      surfaces ONLY the spreadsheets scope. If anything else appears,
 *      STOP and re-check the source.
 *   6. Run __setupLabReviewTabsMaybe() once. This creates
 *      LAB_Redactie_Reviews (with safe headers) if missing. It does
 *      not modify any existing tab and never touches Directory_Master.
 *   7. Deploy → New deployment → "Web app".
 *      Execute as: Me. Who has access: Anyone with the link.
 *   8. Copy the /exec URL into Cloudflare Pages preview env var
 *      REDACTIE_REVIEW_WEBHOOK_URL (matched by the same secret on the
 *      Cloudflare side).
 *
 *   This file MUST NOT contain any secrets. Set the secret via Script
 *   Properties only.
 *
 * ESRF official automation identity:
 *   - office@esrf.net owns the deployment.
 *   - ai.agent.wm@gmail.com MUST NEVER own the production Apps Script.
 */

/* eslint-disable no-undef */ // Apps Script globals: SpreadsheetApp, PropertiesService, ContentService, Utilities

// ── Constants ────────────────────────────────────────────────────────────

var EXPECTED_SPREADSHEET_ID = '1jGDFjTq5atrFSe3avjj4AflUo1SLPKAmkT_MIpH6z1g';
var EXPECTED_TARGET_PREFIX = 'LAB_';
var FORBIDDEN_TABS = ['Directory_Master'];

// Read-only source tabs — what we project records out of.
var READ_TABS = {
  intake_submissions: 'LAB_Intake_Submissions',
  editorial_intake: 'LAB_Editorial_Intake',
  place_candidates: 'LAB_Place_Candidates'
};

// Allowed write targets — append-only, LAB_ prefix, never the master.
var ALLOWED_WRITE_TABS = [
  'LAB_Redactie_Reviews',
  'LAB_Workflow_Events'
];

// Headers we know about; reads project rows by these (header row in
// each tab is authoritative — these constants are a safety net only).
var KNOWN_READ_HEADERS = {
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
  ]
};

// LAB_Redactie_Reviews — append-only, redactieversie rows. The original
// inzending stays in its source tab unchanged; this tab is the audit
// trail of redactie-edits and review state changes.
var LAB_REDACTIE_REVIEWS_HEADERS = [
  'review_id',
  'event_at',
  'environment',
  'source_tab',                  // LAB_Intake_Submissions or LAB_Editorial_Intake
  'submission_id',               // FK into the source tab
  'record_type',                 // 'org' | 'editorial'
  'process_step',                // binnengekomen | in_review | ...
  'review_status',               // in_review | approved_* | rejected | ...
  'reviewer',                    // initials / handle (no email)
  'reviewer_notes',              // internal notes (free text)
  'next_required_action',
  'assigned_to',
  'due_date',
  // Redactieversie / publicatievoorstel — separate columns, never
  // overwriting the source-tab fields:
  'redactie_title',
  'redactie_organization',
  'redactie_summary',
  'redactie_region_angle',
  'redactie_sector_or_tags',
  'redactie_body',
  'editorial_note',
  'change_note',
  'changed_fields',              // JSON array of field names
  'include_contact',             // 'true'|'false' — explicit flag, audit
  'mode',                        // 'lab' | 'dry_run'
  'directory_master_touched',    // ALWAYS 'false'
  'automatic_publication'        // ALWAYS 'false'
];

// LAB_Workflow_Events — append-only, mirrors functions/api/intake.js
// header order. We only ever append; never edit existing rows.
var LAB_WORKFLOW_EVENTS_HEADERS = [
  'event_id','timestamp','environment','submission_id','event_type','workflow_step','status_from','status_to',
  'next_required_action','actor','notification_channel','notification_status','message_summary',
  'related_sheet','related_row','related_url'
];

// PII / contact keys excluded by default from any record we return.
var CONTACT_KEYS = ['contact_name','contact_email','contact_phone','contact_role','contact','contact_internal'];

// Forbidden-key denylist — never echoed back, never written into a
// review row. Mirrors the Cloudflare-side defence-in-depth filter.
var FORBIDDEN_RESPONSE_KEYS = [
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
  'REVIEW_WEBHOOK_SECRET',
  'SHARED_SECRET'
];

var ALLOWED_PROCESS_STEPS = [
  'binnengekomen','in_review','wachten_op_indiener',
  'klaar_voor_akkoord','akkoord_voor_promote',
  'afgewezen','gearchiveerd'
];
var ALLOWED_REVIEW_STATUSES = [
  'in_review','pending_clarification',
  'approved_for_candidate','approved_for_directory_candidate',
  'approved_for_draft','approved_lab_promote',
  'rejected'
];

// ── Public entry point ───────────────────────────────────────────────────

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var expectedSecret = String(
      props.getProperty('REDACTIE_REVIEW_WEBHOOK_SECRET')
      || props.getProperty('REVIEW_WEBHOOK_SECRET')
      || props.getProperty('SHARED_SECRET')
      || ''
    );
    if (!expectedSecret) {
      return jsonOut(500, { ok: false, error: 'REDACTIE_REVIEW_WEBHOOK_SECRET not configured' });
    }

    var body = null;
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
    catch (err) { return jsonOut(400, { ok: false, error: 'Invalid JSON' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return jsonOut(400, { ok: false, error: 'Invalid body' });
    }

    var providedSecret = String(body.shared_secret || '');
    if (!constantTimeEquals(providedSecret, expectedSecret)) {
      return jsonOut(401, { ok: false, error: 'Forbidden' });
    }

    // Resolve the action. Default to list_records for backwards
    // compatibility with the Cloudflare read endpoint, which sends
    // `op: 'read_redactie_review'`.
    var action = String(body.action || '').trim();
    if (!action && body.op === 'read_redactie_review') action = 'list_records';
    if (!action) action = 'list_records';

    var requestId = sanitize(body.request_id);
    var includeContact = body.include_contact === true;
    var resolvedSheetId = resolveSheetId(props, body);
    var ss = openSpreadsheetSafe(resolvedSheetId);

    if (action === 'list_records') {
      return handleListRecords(ss, body, includeContact, requestId);
    }
    if (action === 'get_record') {
      return handleGetRecord(ss, body, includeContact, requestId);
    }
    if (action === 'dry_run_update') {
      return handleUpdate(ss, body, requestId, /*dryRun=*/true);
    }
    if (action === 'submit_review_update') {
      return handleUpdate(ss, body, requestId, /*dryRun=*/false);
    }
    return jsonOut(400, { ok: false, error: 'Unknown action: ' + action });

  } catch (err) {
    return jsonOut(500, { ok: false, error: 'Internal error: ' + (err && err.message || err) });
  }
}

// ── Action handlers ──────────────────────────────────────────────────────

function handleListRecords(ss, body, includeContact, requestId) {
  var warnings = [];
  var includePlaces = body.include_place_candidates === true;
  var tabs = [READ_TABS.intake_submissions, READ_TABS.editorial_intake];
  if (includePlaces) tabs.push(READ_TABS.place_candidates);

  var records = [];
  for (var i = 0; i < tabs.length; i++) {
    var tab = tabs[i];
    if (!isLabReadTabAllowed(tab)) {
      warnings.push('refused non-LAB read tab: ' + tab);
      continue;
    }
    var rows = readTabAsObjects(ss, tab);
    for (var j = 0; j < rows.length; j++) {
      records.push(projectRecord(rows[j], tab, includeContact));
    }
  }

  return jsonOut(200, {
    ok: true,
    mode: 'lab',
    action: 'list_records',
    records: records,
    warnings: warnings,
    target_prefix: EXPECTED_TARGET_PREFIX,
    forbidden_targets: FORBIDDEN_TABS,
    directory_master_touched: false,
    automatic_publication: false,
    contact_included: !!includeContact,
    request_id: requestId
  });
}

function handleGetRecord(ss, body, includeContact, requestId) {
  var submissionId = sanitize(body.submission_id);
  if (!submissionId) {
    return jsonOut(400, { ok: false, error: 'submission_id required' });
  }
  var tabs = [READ_TABS.intake_submissions, READ_TABS.editorial_intake];
  for (var i = 0; i < tabs.length; i++) {
    var tab = tabs[i];
    var rows = readTabAsObjects(ss, tab);
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      if (String(r.submission_id || '') === submissionId) {
        return jsonOut(200, {
          ok: true,
          mode: 'lab',
          action: 'get_record',
          record: projectRecord(r, tab, includeContact),
          target_prefix: EXPECTED_TARGET_PREFIX,
          forbidden_targets: FORBIDDEN_TABS,
          directory_master_touched: false,
          automatic_publication: false,
          contact_included: !!includeContact,
          request_id: requestId
        });
      }
    }
  }
  return jsonOut(404, { ok: false, error: 'submission_id not found', request_id: requestId });
}

function handleUpdate(ss, body, requestId, dryRun) {
  var errors = [];

  var submissionId = sanitize(body.submission_id);
  if (!submissionId) errors.push('submission_id required');

  var recordType = sanitize(body.record_type);
  if (recordType !== 'org' && recordType !== 'editorial') {
    errors.push('record_type must be "org" or "editorial"');
  }

  var targetTab = sanitize(body.target_tab) || 'LAB_Redactie_Reviews';
  if (!isLabWriteTabAllowed(targetTab)) {
    errors.push('target_tab must be LAB_Redactie_Reviews or LAB_Workflow_Events');
  }

  var review = (body.review_update && typeof body.review_update === 'object') ? body.review_update : {};
  var processStep = sanitize(review.process_step);
  if (processStep && ALLOWED_PROCESS_STEPS.indexOf(processStep) === -1) {
    errors.push('review_update.process_step is not in the allowed set');
  }
  var reviewStatus = sanitize(review.review_status);
  if (reviewStatus && ALLOWED_REVIEW_STATUSES.indexOf(reviewStatus) === -1) {
    errors.push('review_update.review_status is not in the allowed set');
  }

  if (errors.length > 0) {
    return jsonOut(400, {
      ok: false,
      mode: dryRun ? 'dry_run' : 'lab',
      action: dryRun ? 'dry_run_update' : 'submit_review_update',
      errors: errors,
      directory_master_touched: false,
      automatic_publication: false,
      request_id: requestId
    });
  }

  var proposal = (body.edited_publication_proposal && typeof body.edited_publication_proposal === 'object')
    ? stripForbiddenAndContact(body.edited_publication_proposal) : {};
  var originalRef = (body.original_reference && typeof body.original_reference === 'object')
    ? stripForbiddenAndContact(body.original_reference) : {};
  var changedFields = Array.isArray(body.changed_fields)
    ? body.changed_fields.filter(function(s){ return typeof s === 'string'; }).slice(0, 64) : [];

  var includeContact = body.include_contact === true;
  var nowIso = new Date().toISOString();
  var reviewId = 'rev_' + nowIso.replace(/[^0-9]/g, '') + '_' + Math.floor(Math.random() * 1e6);

  var reviewRow = {
    review_id: reviewId,
    event_at: nowIso,
    environment: 'TEST/VALIDATIE',
    source_tab: sanitize(body.source_tab) || (recordType === 'editorial' ? 'LAB_Editorial_Intake' : 'LAB_Intake_Submissions'),
    submission_id: submissionId,
    record_type: recordType,
    process_step: processStep || '',
    review_status: reviewStatus || '',
    reviewer: sanitize(review.reviewer || review.assigned_to || body.edited_by) || '',
    reviewer_notes: sanitizeLong(review.review_notes_internal),
    next_required_action: sanitize(review.next_required_action),
    assigned_to: sanitize(review.assigned_to),
    due_date: sanitize(review.due_date),
    redactie_title: sanitize(proposal.edited_title || proposal.redactie_title),
    redactie_organization: sanitize(proposal.edited_organization || proposal.redactie_organization),
    redactie_summary: sanitizeLong(proposal.edited_summary || proposal.redactie_summary),
    redactie_region_angle: sanitize(proposal.edited_region || proposal.redactie_region_angle),
    redactie_sector_or_tags: sanitize(proposal.edited_sector_or_tags || proposal.redactie_sector_or_tags),
    redactie_body: sanitizeLong(proposal.edited_public_body || proposal.redactie_body),
    editorial_note: sanitizeLong(proposal.editorial_note),
    change_note: sanitizeLong(body.change_note || proposal.change_note),
    changed_fields: JSON.stringify(changedFields),
    include_contact: includeContact ? 'true' : 'false',
    mode: dryRun ? 'dry_run' : 'lab',
    directory_master_touched: 'false',
    automatic_publication: 'false'
  };

  // Workflow event row — append-only audit trail, separate from
  // LAB_Redactie_Reviews. Always built; written to LAB_Workflow_Events
  // unconditionally on a non-dry-run path.
  var workflowRow = {
    event_id: reviewId.replace(/^rev_/, 'evt_'),
    timestamp: nowIso,
    environment: 'TEST/VALIDATIE',
    submission_id: submissionId,
    event_type: 'redactie_review_update',
    workflow_step: processStep || '',
    status_from: '',
    status_to: reviewStatus || '',
    next_required_action: sanitize(review.next_required_action),
    actor: sanitize(review.reviewer || review.assigned_to || body.edited_by) || 'redactie',
    notification_channel: '',
    notification_status: 'not_applicable',
    message_summary: 'Redactie review update for ' + submissionId,
    related_sheet: targetTab,
    related_row: '',
    related_url: ''
  };

  if (dryRun) {
    return jsonOut(200, {
      ok: true,
      mode: 'dry_run',
      action: 'dry_run_update',
      update_result: {
        would_write_to: targetTab,
        review_row_preview: reviewRow,
        workflow_event_preview: workflowRow,
        rows_written: 0
      },
      target_prefix: EXPECTED_TARGET_PREFIX,
      forbidden_targets: FORBIDDEN_TABS,
      directory_master_touched: false,
      automatic_publication: false,
      warnings: ['dry_run only — no rows written'],
      request_id: requestId
    });
  }

  // Live write path. Defence-in-depth: assert again before each write.
  if (!isLabWriteTabAllowed(targetTab)) {
    return jsonOut(400, { ok: false, error: 'target_tab not allowed for write', request_id: requestId });
  }
  if (FORBIDDEN_TABS.indexOf(targetTab) !== -1) {
    return jsonOut(400, { ok: false, error: 'Refusing to write to ' + targetTab, request_id: requestId });
  }

  var written = {};
  if (targetTab === 'LAB_Redactie_Reviews') {
    ensureRedactieReviewsTab(ss);
    written.LAB_Redactie_Reviews = appendKnownRow(ss, 'LAB_Redactie_Reviews', LAB_REDACTIE_REVIEWS_HEADERS, reviewRow);
  }
  // Always append a workflow event for any successful write — this is
  // the audit row the lab promotion pipeline keys off.
  written.LAB_Workflow_Events = appendKnownRow(ss, 'LAB_Workflow_Events', LAB_WORKFLOW_EVENTS_HEADERS, workflowRow);

  return jsonOut(200, {
    ok: true,
    mode: 'lab',
    action: 'submit_review_update',
    update_result: {
      target_tab: targetTab,
      rows_written: Object.keys(written).length,
      written: written,
      review_id: reviewId
    },
    target_prefix: EXPECTED_TARGET_PREFIX,
    forbidden_targets: FORBIDDEN_TABS,
    directory_master_touched: false,
    automatic_publication: false,
    warnings: [],
    request_id: requestId
  });
}

// ── Spreadsheet helpers ──────────────────────────────────────────────────

function resolveSheetId(props, body) {
  var id = String(
    (body && body.spreadsheet_id)
    || props.getProperty('SHEET_ID')
    || props.getProperty('SPREADSHEET_ID')
    || EXPECTED_SPREADSHEET_ID
  );
  return id;
}

function openSpreadsheetSafe(id) {
  if (id && id !== EXPECTED_SPREADSHEET_ID) {
    throw new Error('Refusing unknown spreadsheet id: ' + id);
  }
  if (id) return SpreadsheetApp.openById(id);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function isLabReadTabAllowed(name) {
  if (!name || typeof name !== 'string') return false;
  if (FORBIDDEN_TABS.indexOf(name) !== -1) return false;
  if (name.indexOf(EXPECTED_TARGET_PREFIX) !== 0) return false;
  return name === READ_TABS.intake_submissions
      || name === READ_TABS.editorial_intake
      || name === READ_TABS.place_candidates;
}

function isLabWriteTabAllowed(name) {
  if (!name || typeof name !== 'string') return false;
  if (FORBIDDEN_TABS.indexOf(name) !== -1) return false;
  if (name.indexOf(EXPECTED_TARGET_PREFIX) !== 0) return false;
  return ALLOWED_WRITE_TABS.indexOf(name) !== -1;
}

function readTabAsObjects(ss, tabName) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function(h){ return String(h || ''); });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var key = headers[c];
      if (!key) continue;
      if (FORBIDDEN_RESPONSE_KEYS.indexOf(key) !== -1) continue;
      obj[key] = row[c];
    }
    obj.__source_tab = tabName;
    obj.__source_row_hint = 'rij ' + (r + 1);
    out.push(obj);
  }
  return out;
}

function projectRecord(row, sourceTab, includeContact) {
  var out = {};
  for (var k in row) {
    if (FORBIDDEN_RESPONSE_KEYS.indexOf(k) !== -1) continue;
    if (!includeContact && CONTACT_KEYS.indexOf(k) !== -1) continue;
    out[k] = row[k];
  }
  out.source_tab = sourceTab;
  if (row.__source_row_hint) out.source_row_hint = row.__source_row_hint;
  // Derive a record_type that matches the Cloudflare-side contract.
  if (sourceTab === 'LAB_Editorial_Intake') {
    out.record_type = 'editorial';
  } else if (sourceTab === 'LAB_Intake_Submissions') {
    out.record_type = 'org';
  } else if (sourceTab === 'LAB_Place_Candidates') {
    out.record_type = 'place_candidate';
  }
  delete out.__source_tab;
  delete out.__source_row_hint;
  return out;
}

function ensureRedactieReviewsTab(ss) {
  var sheet = ss.getSheetByName('LAB_Redactie_Reviews');
  if (sheet) return sheet;
  sheet = ss.insertSheet('LAB_Redactie_Reviews');
  sheet.getRange(1, 1, 1, LAB_REDACTIE_REVIEWS_HEADERS.length)
       .setValues([LAB_REDACTIE_REVIEWS_HEADERS]);
  sheet.setFrozenRows(1);
  // Soft instructions row, optional but harmless. We use a Note rather
  // than a sheet-level cell so it never collides with header parsing.
  try {
    sheet.getRange(1, 1).setNote(
      'LAB_Redactie_Reviews — append-only redactieversie / review audit.\n' +
      'Never overwritten by automation. Never the source of Directory_Master.\n' +
      'Original inzendingen blijven in LAB_Intake_Submissions / LAB_Editorial_Intake.'
    );
  } catch (_) { /* notes are best-effort */ }
  return sheet;
}

function appendKnownRow(ss, tabName, headers, rowObj) {
  if (FORBIDDEN_TABS.indexOf(tabName) !== -1) {
    throw new Error('Refusing to append to forbidden tab: ' + tabName);
  }
  if (tabName.indexOf(EXPECTED_TARGET_PREFIX) !== 0) {
    throw new Error('Tab not LAB_-prefixed: ' + tabName);
  }
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error('Tab missing: ' + tabName);
  // Verify header row matches our expectation; never overwrite it.
  var firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(firstRow[i] || '') !== headers[i]) {
      throw new Error('Header mismatch in ' + tabName + ' col ' + (i + 1) +
        ': expected "' + headers[i] + '", got "' + firstRow[i] + '"');
    }
  }
  var values = headers.map(function (h) {
    var v = rowObj && rowObj[h];
    if (v == null) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  });
  sheet.appendRow(values);
  return String(sheet.getLastRow());
}

// ── Pure helpers ─────────────────────────────────────────────────────────

function stripForbiddenAndContact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripForbiddenAndContact);
  var out = {};
  for (var k in obj) {
    if (FORBIDDEN_RESPONSE_KEYS.indexOf(k) !== -1) continue;
    if (CONTACT_KEYS.indexOf(k) !== -1) continue;
    var v = obj[k];
    out[k] = (v && typeof v === 'object') ? stripForbiddenAndContact(v) : v;
  }
  return out;
}

function sanitize(v) {
  if (v == null) return '';
  var s = String(v).trim();
  if (s.length > 512) s = s.substring(0, 512);
  return s.replace(/[\u0000-\u001F\u007F]/g, '');
}

function sanitizeLong(v) {
  if (v == null) return '';
  var s = String(v).trim();
  if (s.length > 8000) s = s.substring(0, 8000);
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function constantTimeEquals(a, b) {
  var sa = String(a || '');
  var sb = String(b || '');
  if (sa.length !== sb.length) return false;
  var diff = 0;
  for (var i = 0; i < sa.length; i++) diff |= (sa.charCodeAt(i) ^ sb.charCodeAt(i));
  return diff === 0;
}

function jsonOut(status, obj) {
  // Apps Script web apps cannot set arbitrary HTTP status codes; the
  // body always carries `ok` and `status_hint` so the Cloudflare side
  // can interpret consistently. The HTTP status returned is 200.
  obj.status_hint = status;
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Operator helpers (run once from the Apps Script editor) ──────────────

/**
 * Triggers the OAuth consent flow once, with ONLY the spreadsheet
 * scope. If the consent screen surfaces any other scope (script.send_mail,
 * gmail.*, drive.*, script.external_request), STOP and re-check the
 * source — a forbidden API reference has crept in.
 *
 * Run from the Apps Script editor → select function
 * `__authorizeSpreadsheetAccessOnly` → Run.
 */
function __authorizeSpreadsheetAccessOnly() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID') || EXPECTED_SPREADSHEET_ID;
  var ss = SpreadsheetApp.openById(id);
  // Touch each required tab so Apps Script binds the spreadsheet scope.
  var tabs = [
    READ_TABS.intake_submissions,
    READ_TABS.editorial_intake
  ];
  for (var i = 0; i < tabs.length; i++) {
    var s = ss.getSheetByName(tabs[i]);
    if (s) s.getRange(1, 1, 1, 1).getValue();
  }
  return 'authorize-ok: spreadsheets-only scope confirmed for ' + id;
}

/**
 * Idempotently creates LAB_Redactie_Reviews with safe headers if it
 * does not already exist. Does not modify any other tab. Does not
 * touch Directory_Master. Safe to call repeatedly.
 *
 * Run from the Apps Script editor → select function
 * `__setupLabReviewTabsMaybe` → Run.
 */
function __setupLabReviewTabsMaybe() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID') || EXPECTED_SPREADSHEET_ID;
  var ss = SpreadsheetApp.openById(id);
  ensureRedactieReviewsTab(ss);
  // Verify (but never create) the workflow events tab — it is set up
  // by the existing intake webhook. If missing, raise an error rather
  // than silently creating it.
  var ev = ss.getSheetByName('LAB_Workflow_Events');
  if (!ev) {
    throw new Error('LAB_Workflow_Events missing — set up via intake webhook before activating review writes.');
  }
  return 'setup-ok: LAB_Redactie_Reviews ensured; LAB_Workflow_Events present.';
}
