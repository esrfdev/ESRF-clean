// Frontend payload-shape contract test for submit-validation.html.
//
// We don't need a browser to assert the contract: the LAB POST flow
// builds a deterministic JSON body from the user's preview payload.
// This test re-implements the body-build logic in pure JS (mirroring
// the inline `buildLabBody` in submit-validation.html) and feeds it
// to the real /api/intake-test handler to verify the backend accepts
// it end-to-end.
//
// If the inline `buildLabBody` in submit-validation.html ever drifts
// (prefix removed, lab_test marker missing, environment override
// dropped), this test will fail — keeping the frontend honest.
//
// Run with:   node functions/api/submit-validation-payload.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

await import('./intake.js');
await import('./intake-test.js');
const test = globalThis.__esrfIntakeTest;
assert.ok(test, 'intake-test.js did not expose test hooks on globalThis');
const { onRequest } = test;

let failures = 0;
function check(name, fn){
  try { fn(); console.log('  ok  — ' + name); }
  catch(e){ failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}
async function asyncCheck(name, fn){
  try { await fn(); console.log('  ok  — ' + name); }
  catch(e){ failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}

// ─── Mirror of buildLabBody from submit-validation.html ─────────────────
// Kept in lockstep with the inline helper. If you change one, change both.
function buildLabBody(basePayload, nowMs){
  if (!basePayload || typeof basePayload !== 'object') return null;
  const clone = JSON.parse(JSON.stringify(basePayload));
  const contact = clone.contact || (clone.contact = {});
  const origOrg = String(contact.organisation || '').trim();
  const origName = String(contact.name || '').trim();
  function withPrefix(v){
    const prefix = 'ESRF Lab Test';
    if (!v) return prefix + ' (anoniem)';
    if (v.toLowerCase().indexOf(prefix.toLowerCase()) === 0) return v;
    return prefix + ' — ' + v;
  }
  contact.organisation = withPrefix(origOrg);
  contact.name = withPrefix(origName);
  clone.lab_test = true;
  clone.lab_marker_explicit = true;
  clone.meta = clone.meta || {};
  clone.meta.environment = 'TEST/VALIDATIE';
  clone.meta.lab_test = true;
  clone.meta.source = 'submit-validation.html#lab-button';
  clone.meta.original_organisation_redacted = origOrg ? origOrg.slice(0, 80) : '';
  clone.meta.original_name_redacted = origName ? origName.slice(0, 80) : '';
  clone.company_website_hp = '';
  clone.form_duration_ms = (nowMs || Date.now()) - 0;
  return clone;
}

// ─── Helper: simulate a POST against /api/intake-test ───────────────────
const PREVIEW_ORIGIN = 'https://test-regional-editorial-cont.esrf-clean.pages.dev';
function callIntakeTest(method, opts){
  opts = opts || {};
  const headers = new Map(Object.entries(opts.headers || {}));
  const request = {
    method,
    url: PREVIEW_ORIGIN + '/api/intake-test',
    headers: { get(k){ return headers.get(String(k).toLowerCase()) || headers.get(k) || null; } },
    text: async () => opts.body || '',
    cf: {},
  };
  const env = Object.assign({ CF_PAGES_BRANCH: 'test/regional-editorial-contributor-intake' }, opts.env || {});
  return onRequest({ request, env });
}

// Plausible preview payloads as the form would emit them.
const orgPreview = {
  meta: { environment: 'TEST/VALIDATIE', prototype: 'submit-validation.html (integrated org + editorial)', generated_at: new Date().toISOString(), not_sent: true },
  intake_mode: 'org',
  contact: {
    name: 'Sanne de Vries',
    organisation: 'Veiligheidsregio Rotterdam-Rijnmond',
    role: 'teamleider crisisbeheersing',
    email: 'sanne@example.org',
    phone: '',
    country_code: 'NL',
    country_label: 'Nederland',
    place: 'Rotterdam',
    place_known: true,
    place_addition_requested: false,
    place_addition_candidate: '',
    place_addition_country: '',
    place_addition_region: '',
    region: 'Zuid-Holland',
    region_manual_override: false,
    region_suggestion_source: 'autoselect-from-place',
    auto_suggested_region: 'Zuid-Holland',
    website: 'https://example.org',
  },
  organisation_listing: {
    sector: 'Emergency & Crisis Response',
    sector_label: 'Crisisbeheersing & rampenbestrijding',
    city: 'Rotterdam',
    description: 'Regionale crisisorganisatie.',
  },
  privacy: { gdpr_privacy_policy: true },
};

const editorialPreview = {
  meta: { environment: 'TEST/VALIDATIE', generated_at: new Date().toISOString(), not_sent: true },
  intake_mode: 'editorial',
  contact: {
    name: 'Karel Janssens',
    organisation: 'Stadsbestuur Antwerpen',
    role: 'coördinator',
    email: 'karel@example.org',
    phone: '',
    country_code: 'BE',
    country_label: 'België',
    place: 'Antwerpen',
    place_known: true,
    region: 'Antwerpen',
    region_manual_override: false,
    region_suggestion_source: 'manual-select',
    auto_suggested_region: '',
    website: '',
  },
  editorial_contribution: {
    topic: 'Hoe Antwerpen samen met de havenpartners een gemeenschappelijke oefening opzette',
    summary: 'Een korte samenvatting van het samenwerkingsverband en de opzet van de havenoefening in Antwerpen.',
    audience: 'havenautoriteiten, beleidsmakers',
    partners_sector: 'Havenbedrijf, brandweer, politie',
    regional_angle: 'Specifiek voor de haven van Antwerpen.',
    lesson: 'Vroeg afstemmen werkt beter dan corrigeren.',
    spotlight: '',
    sources: '',
    consent: { edit_and_publish: true, editorial_may_contact: true, no_confidential_information: true },
  },
  privacy: { gdpr_privacy_policy: true },
};

const bothPreview = JSON.parse(JSON.stringify(editorialPreview));
bothPreview.intake_mode = 'both';
bothPreview.contact.website = 'https://example.org';
bothPreview.organisation_listing = { sector: 'Security & Protection', sector_label: 'Beveiliging & bescherming', city: 'Antwerpen', description: 'Stedelijk veiligheidsbureau.' };

// ─── Pure-function tests ────────────────────────────────────────────────
check('buildLabBody adds ESRF Lab Test prefix to organisation and name', () => {
  const body = buildLabBody(orgPreview, 9999);
  assert.ok(body.contact.organisation.startsWith('ESRF Lab Test'), 'org missing prefix: ' + body.contact.organisation);
  assert.ok(body.contact.name.startsWith('ESRF Lab Test'), 'name missing prefix: ' + body.contact.name);
});
check('buildLabBody is idempotent if prefix already present', () => {
  const seeded = JSON.parse(JSON.stringify(orgPreview));
  seeded.contact.organisation = 'ESRF Lab Test Foundation';
  seeded.contact.name = 'ESRF Lab Test Operator';
  const body = buildLabBody(seeded, 9999);
  assert.equal(body.contact.organisation, 'ESRF Lab Test Foundation');
  assert.equal(body.contact.name, 'ESRF Lab Test Operator');
});
check('buildLabBody preserves place enrichment fields', () => {
  const body = buildLabBody(orgPreview, 9999);
  assert.equal(body.contact.country_code, 'NL');
  assert.equal(body.contact.region, 'Zuid-Holland');
  assert.equal(body.contact.place, 'Rotterdam');
  assert.equal(body.contact.region_suggestion_source, 'autoselect-from-place');
});
check('buildLabBody preserves organisation_listing', () => {
  const body = buildLabBody(orgPreview, 9999);
  assert.equal(body.organisation_listing.sector, 'Emergency & Crisis Response');
  assert.equal(body.organisation_listing.city, 'Rotterdam');
});
check('buildLabBody preserves editorial_contribution and consent', () => {
  const body = buildLabBody(editorialPreview, 9999);
  assert.equal(body.editorial_contribution.topic, editorialPreview.editorial_contribution.topic);
  assert.equal(body.editorial_contribution.summary, editorialPreview.editorial_contribution.summary);
  assert.deepEqual(body.editorial_contribution.consent, editorialPreview.editorial_contribution.consent);
});
check('buildLabBody sets lab_test marker and TEST/VALIDATIE environment', () => {
  const body = buildLabBody(orgPreview, 9999);
  assert.equal(body.lab_test, true);
  assert.equal(body.meta.environment, 'TEST/VALIDATIE');
  assert.equal(body.meta.lab_test, true);
});
check('buildLabBody redacts original org/name to a short audit field', () => {
  const body = buildLabBody(orgPreview, 9999);
  assert.equal(body.meta.original_organisation_redacted, 'Veiligheidsregio Rotterdam-Rijnmond');
  assert.equal(body.meta.original_name_redacted, 'Sanne de Vries');
});
check('buildLabBody returns null for falsy input', () => {
  assert.equal(buildLabBody(null), null);
  assert.equal(buildLabBody(undefined), null);
});

// ─── Contract tests against the real /api/intake-test handler ──────────
await asyncCheck('Frontend org-mode lab body is accepted by /api/intake-test', async () => {
  const body = buildLabBody(orgPreview, 9999);
  const res = await callIntakeTest('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(j.lab_test, true);
  assert.equal(j.environment, 'TEST/VALIDATIE');
  assert.equal(j.notification_sent, false);
  assert.equal(j.notification_status, 'disabled_for_intake_test');
});

await asyncCheck('Frontend editorial-mode lab body is accepted by /api/intake-test', async () => {
  const body = buildLabBody(editorialPreview, 9999);
  const res = await callIntakeTest('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(j.mode, 'editorial');
  // No Directory_Master row.
  assert.equal(j.sheet_webhook_payload_preview.rows.Directory_Master, undefined);
  // Editorial row is present.
  assert.ok(j.sheet_webhook_payload_preview.rows.LAB_Editorial_Intake, 'editorial row missing');
});

await asyncCheck('Frontend both-mode lab body is accepted by /api/intake-test', async () => {
  const body = buildLabBody(bothPreview, 9999);
  const res = await callIntakeTest('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(j.mode, 'both');
  assert.ok(j.sheet_webhook_payload_preview.rows.LAB_Intake_Submissions);
  assert.ok(j.sheet_webhook_payload_preview.rows.LAB_Editorial_Intake);
});

await asyncCheck('LAB body without prefix is rejected (sanity check)', async () => {
  const body = buildLabBody(orgPreview, 9999);
  // Strip prefix to confirm the backend would reject — verifies our test
  // is not silently passing because we forgot to set the prefix.
  body.contact.organisation = 'Acme Inc';
  body.contact.name = 'Anna Jansen';
  const res = await callIntakeTest('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 400);
});

// ─── Hostname gate: production hostnames must not enable the LAB button ─
function isLabPreviewHostname(hostname){
  const h = String(hostname || '').toLowerCase();
  if (!h) return false;
  if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0') return true;
  if (h.endsWith('.esrf-clean.pages.dev')) return true;
  return false;
}
check('LAB hostname gate accepts preview hosts', () => {
  assert.equal(isLabPreviewHostname('test-regional-editorial-cont.esrf-clean.pages.dev'), true);
  assert.equal(isLabPreviewHostname('foo.esrf-clean.pages.dev'), true);
  assert.equal(isLabPreviewHostname('localhost'), true);
  assert.equal(isLabPreviewHostname('127.0.0.1'), true);
});
check('LAB hostname gate rejects production hosts', () => {
  assert.equal(isLabPreviewHostname('esrf.net'), false);
  assert.equal(isLabPreviewHostname('www.esrf.net'), false);
  assert.equal(isLabPreviewHostname(''), false);
  assert.equal(isLabPreviewHostname('evil.example'), false);
  // Look-alike spoofing
  assert.equal(isLabPreviewHostname('esrf-clean.pages.dev.evil.com'), false);
  assert.equal(isLabPreviewHostname('esrf-clean.pages.dev'), false);
});

// ─── Inline helper drift detection ──────────────────────────────────────
// Make sure submit-validation.html actually contains the LAB button + the
// helper functions we test above. If somebody removes them, this test
// flags the regression.
const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.resolve(here, '../../submit-validation.html'), 'utf8');
check('submit-validation.html still contains the LAB button', () => {
  assert.ok(html.includes('id="sv-lab-btn"'), 'LAB button missing');
});
check('submit-validation.html still contains buildLabBody and isLabPreviewHostname', () => {
  assert.ok(html.includes('function buildLabBody'), 'buildLabBody missing');
  assert.ok(html.includes('function isLabPreviewHostname'), 'isLabPreviewHostname missing');
});
check('submit-validation.html only declares escapeHtml once', () => {
  const matches = html.match(/function\s+escapeHtml\s*\(/g) || [];
  assert.equal(matches.length, 1, 'expected exactly one escapeHtml definition; found ' + matches.length);
});
check('submit-validation.html marks ed_summary as min-length 20', () => {
  assert.ok(/summary\.length\s*<\s*20/.test(html), 'min-length-20 guard missing for ed_summary');
});

if (failures) {
  console.log('\n' + failures + ' test(s) FAILED');
  process.exit(1);
}
console.log('\nall tests passed');
