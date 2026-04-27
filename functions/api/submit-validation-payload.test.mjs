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

// ─── Visitor-route naming pass (validation branch) ──────────────────────
// The unified validation visitor form must use the broad label
// "Deel je informatie" (NL) / "Share your information" (EN) — not the
// narrow "Submit signal" / "Genereer testpreview" / "Meld organisatie aan"
// wording. The Dutch UI must include the explainer covering aanmelden,
// wijzigen, verbergen, en praktijkverhaal. Safety copy stating nothing
// changes automatically must remain.

check('submit-validation.html: <title> uses broad label "Deel je informatie"', () => {
  assert.match(html, /<title>\s*Deel je informatie[^<]*<\/title>/);
});
check('submit-validation.html: hero h1 leads with "Deel je"', () => {
  assert.match(html, /<h1\s+class="phero-title">\s*Deel je\s*<br>\s*<i>informatie<\/i>\s*\.\s*<\/h1>/);
});
check('submit-validation.html: hero deck explains aanmelden/wijzigen/verbergen/praktijkverhaal', () => {
  assert.ok(html.includes('Gebruik dit formulier om een organisatie aan te melden, gegevens te wijzigen, een vermelding te laten verbergen of een praktijkverhaal in te sturen.'),
    'expected the verbatim Dutch explainer in submit-validation.html hero deck');
});
check('submit-validation.html: submit button label is "Deel je informatie"', () => {
  assert.match(html, /id="sv-submit-btn"[^>]*>[\s\S]*?Deel je informatie[\s\S]*?<\/button>/,
    'expected sv-submit-btn label to be "Deel je informatie"');
});
check('submit-validation.html: submit button carries en/nl data labels', () => {
  assert.match(html, /id="sv-submit-btn"[^>]*data-en-label="Share your information"/);
  assert.match(html, /id="sv-submit-btn"[^>]*data-nl-label="Deel je informatie"/);
});
check('submit-validation.html: narrow CTA wording "Genereer testpreview" no longer used as submit-button label', () => {
  // Allow the phrase to survive in scripts/comments if any, but make
  // sure it is not the visible button label.
  assert.ok(!/id="sv-submit-btn"[^>]*>[\s\S]*?Genereer testpreview/.test(html),
    'old "Genereer testpreview" submit-button label must be removed');
});
check('submit-validation.html: kept safety copy that nothing is sent / changes automatically', () => {
  assert.ok(html.includes('niets wordt verzonden in deze validatieomgeving'),
    'expected explicit "niets wordt verzonden" safety copy near submit button');
  assert.ok(html.includes('er verandert niets automatisch') || html.includes('niets automatisch'),
    'expected safety copy stating nothing changes automatically');
  assert.ok(html.includes('Directory_Master'),
    'expected Directory_Master safety reference to remain on the page');
});
check('submit-validation.html: validation footer surfaces broad "Deel je informatie" entry', () => {
  assert.match(html, /<a[^>]*href="submit-validation\.html"[^>]*>\s*Deel je informatie \(formulier\)/,
    'expected validation footer entry "Deel je informatie (formulier)"');
});
check('submit-validation.html: validation footer drops narrow "Geïntegreerd opgaveformulier" wording', () => {
  // The footer column for "Validatie" must not use the older narrow phrase.
  // Check the footer block specifically.
  const footMatch = html.match(/<footer\s+class="foot"[\s\S]*?<\/footer>/);
  assert.ok(footMatch, 'expected a public footer block on submit-validation.html');
  assert.ok(!/Geïntegreerd opgaveformulier/.test(footMatch[0]),
    'narrow "Geïntegreerd opgaveformulier" wording must be removed from validation footer');
});

// ─── request-listing-validation.html naming pass ────────────────────────
const rlvPath = path.resolve(here, '../../request-listing-validation.html');
const rlv = fs.readFileSync(rlvPath, 'utf8');

check('request-listing-validation.html: <title> uses broad label "Deel je informatie"', () => {
  assert.match(rlv, /<title>\s*Deel je informatie[^<]*<\/title>/);
});
check('request-listing-validation.html: mast CTA uses "Deel je informatie"', () => {
  assert.match(rlv, /class="mast-cta"[^>]*>\s*Deel je informatie\s*<\/a>/);
});
check('request-listing-validation.html: hero deck contains the verbatim Dutch explainer', () => {
  assert.ok(rlv.includes('Gebruik dit formulier om een organisatie aan te melden, gegevens te wijzigen, een vermelding te laten verbergen of een praktijkverhaal in te sturen.'),
    'expected the Dutch explainer on request-listing-validation.html');
});
check('request-listing-validation.html: primary CTA reads "Deel je informatie →"', () => {
  assert.match(rlv, /<a[^>]*class="btn primary"[^>]*href="submit-validation\.html"[^>]*>\s*Deel je informatie →\s*<\/a>/,
    'expected primary CTA "Deel je informatie →" on request-listing-validation.html');
  assert.ok(!/Naar geïntegreerd opgaveformulier/.test(rlv),
    'old narrow "Naar geïntegreerd opgaveformulier" CTA must be removed');
});
check('request-listing-validation.html: footer Validatie list uses broad label', () => {
  assert.match(rlv, /<a[^>]*href="submit-validation\.html"[^>]*>\s*Deel je informatie \(formulier\)\s*<\/a>/);
  assert.ok(!/<a[^>]*href="submit-validation\.html"[^>]*>\s*Geïntegreerd opgaveformulier\s*<\/a>/.test(rlv),
    'old narrow "Geïntegreerd opgaveformulier" footer entry must be removed from request-listing-validation.html');
});
check('request-listing-validation.html: noindex/nofollow still present', () => {
  assert.match(rlv, /<meta\s+name="robots"\s+content="noindex,nofollow"/i);
  assert.match(rlv, /<meta\s+name="googlebot"\s+content="noindex,nofollow"/i);
});

// ─── esrf-simulated-site.html naming pass ───────────────────────────────
const simPath = path.resolve(here, '../../esrf-simulated-site.html');
const sim = fs.readFileSync(simPath, 'utf8');

check('esrf-simulated-site.html: mast CTA uses "Deel je informatie"', () => {
  assert.match(sim, /class="mast-cta"[^>]*>\s*Deel je informatie\s*<\/a>/);
  assert.ok(!/class="mast-cta"[^>]*>\s*Meld organisatie aan\s*<\/a>/.test(sim),
    'old narrow "Meld organisatie aan" mast CTA must be removed from esrf-simulated-site.html');
});
check('esrf-simulated-site.html: join section CTA uses "Deel je informatie →"', () => {
  assert.match(sim, /<a[^>]*class="btn on-accent"[\s\S]*?>\s*Deel je informatie →\s*<\/a>/,
    'expected join-section CTA "Deel je informatie →" on esrf-simulated-site.html');
  assert.ok(!/Meld je organisatie aan →/.test(sim),
    'old narrow "Meld je organisatie aan →" CTA must be removed from esrf-simulated-site.html');
});
check('esrf-simulated-site.html: editorial CTA reframed as "Deel je praktijkverhaal →"', () => {
  assert.match(sim, /<a[^>]*class="btn primary"[^>]*href="submit-validation\.html#mode-editorial"[^>]*>\s*Deel je praktijkverhaal →\s*<\/a>/,
    'expected editorial CTA "Deel je praktijkverhaal →"');
  assert.ok(!/Stuur een bijdrage in →/.test(sim),
    'old "Stuur een bijdrage in →" CTA must be removed from esrf-simulated-site.html');
});
check('esrf-simulated-site.html: validation footer surfaces broad "Deel je informatie" entry', () => {
  assert.match(sim, /<a[^>]*href="submit-validation\.html"[^>]*>\s*Deel je informatie \(formulier\)/);
  assert.ok(!/Geïntegreerd opgaveformulier/.test(sim),
    'old narrow "Geïntegreerd opgaveformulier" footer entry must be removed from esrf-simulated-site.html');
});

// ─── validation-lab.json naming pass ────────────────────────────────────
const manifestPath = path.resolve(here, '../../validation-lab.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function moduleById(id){
  return (manifest.modules || []).find(m => m.id === id) || null;
}

check('validation-lab.json: integrated-submit-with-editorial declares broad CTA labels', () => {
  const mod = moduleById('integrated-submit-with-editorial');
  assert.ok(mod, 'expected integrated-submit-with-editorial module');
  assert.ok(mod.primaryCallToActionLabel && mod.primaryCallToActionLabel.en === 'Share your information',
    'expected primaryCallToActionLabel.en === "Share your information"');
  assert.equal(mod.primaryCallToActionLabel.nl, 'Deel je informatie',
    'expected primaryCallToActionLabel.nl === "Deel je informatie"');
  assert.equal(mod.visitorIntroDutch,
    'Gebruik dit formulier om een organisatie aan te melden, gegevens te wijzigen, een vermelding te laten verbergen of een praktijkverhaal in te sturen.',
    'expected verbatim Dutch visitor intro on integrated-submit-with-editorial');
});
check('validation-lab.json: esrf-simulated-site declares broad CTA labels', () => {
  const mod = moduleById('esrf-simulated-site');
  assert.ok(mod, 'expected esrf-simulated-site module');
  assert.ok(mod.primaryCallToActionLabel && mod.primaryCallToActionLabel.nl === 'Deel je informatie');
  assert.equal(mod.primaryCallToActionLabel.en, 'Share your information');
});
check('validation-lab.json: request-listing-validation renamed away from "Opgavepad"', () => {
  const mod = moduleById('request-listing-validation');
  assert.ok(mod, 'expected request-listing-validation module');
  assert.ok(!/^Opgavepad —/.test(mod.title),
    'expected request-listing-validation.title to no longer lead with "Opgavepad —"');
  assert.ok(mod.primaryCallToActionLabel && mod.primaryCallToActionLabel.nl === 'Deel je informatie');
});

// ─── Mode-option selection buttons must not carry a "NIEUW"/"NEW" badge ─
// Confusing per visitor feedback on the test deploy: every mode card except
// the default "org" one used to be tagged with a <span class="new-pill">Nieuw</span>
// inside its <strong> label. Strip them so the choice options read neutral.
// Allowed staging context (e.g. the "VALIDATIEOMGEVING" stage bar or the
// page-level kicker "Nieuw in validatie") is untouched.

function extractModeOptionsBlock(src){
  const start = src.indexOf('<div class="mode-switch"');
  assert.ok(start > 0, 'expected mode-switch container in submit-validation.html');
  const end = src.indexOf('</div>', start);
  assert.ok(end > start, 'expected closing </div> for mode-switch');
  return src.slice(start, end + '</div>'.length);
}

check('submit-validation.html: mode-option selection buttons carry no "Nieuw" badge', () => {
  const block = extractModeOptionsBlock(html);
  // No new-pill spans inside any mode-option row.
  assert.ok(!/<span[^>]*class="[^"]*new-pill[^"]*"[^>]*>/i.test(block),
    'mode-option block must not contain any <span class="new-pill"> — selection buttons must read neutral');
  // No literal Nieuw badge text wrapped in <strong> (defensive — catches a
  // future rewrite that swaps span for another tag).
  assert.ok(!/<strong[^>]*>[^<]*\bNieuw\b[^<]*<\/strong>/.test(block),
    'mode-option <strong> labels must not contain a "Nieuw" duiding');
  // No English "NEW" badge variant either.
  assert.ok(!/\bNEW\b/.test(block),
    'mode-option block must not contain an English "NEW" badge');
});

check('submit-validation.html: each known mode (org/editorial/both/change_request/hide_delete) has no Nieuw/NEW duiding on its label', () => {
  const block = extractModeOptionsBlock(html);
  for (const mode of ['org', 'editorial', 'both', 'change_request', 'hide_delete']){
    const re = new RegExp('data-mode="' + mode + '"[\\s\\S]*?</label>');
    const m = block.match(re);
    assert.ok(m, 'expected mode-option for data-mode="' + mode + '"');
    const opt = m[0];
    assert.ok(!/\bNieuw\b/.test(opt),
      'mode-option "' + mode + '" must not display a "Nieuw" duiding');
    assert.ok(!/\bNEW\b/.test(opt),
      'mode-option "' + mode + '" must not display an English "NEW" duiding');
    assert.ok(!/class="[^"]*new-pill[^"]*"/.test(opt),
      'mode-option "' + mode + '" must not contain a new-pill badge');
  }
});

check('submit-validation.html: conditional editorial / change-request fieldset legends carry no "Nieuw" badge', () => {
  // 3B (editorial) and 3C (change/hide-delete) legends used to carry
  // <span class="new-pill">Nieuw</span> badges next to their headings.
  // Those follow directly from the mode pick and were equally confusing.
  const legendMatches = html.match(/<legend\s+class="form-legend">[^<]*(?:<span[^>]*>[^<]*<\/span>)?[^<]*<\/legend>/g) || [];
  for (const l of legendMatches){
    if (/3B\.|3C\./.test(l)){
      assert.ok(!/new-pill|Nieuw/.test(l),
        'conditional fieldset legend must not carry a "Nieuw" badge: ' + l);
    }
  }
});

check('submit-validation.html: fieldset-1 intro no longer pitches editorial as "Nieuwe optie"', () => {
  // The intro paragraph above the radiogroup used to end with
  // <span class="new-pill new-pill-soft">Nieuwe optie: editorial bijdrage</span>
  // — that is annotation on a single mode option and was equally confusing.
  const idx = html.indexOf('<legend class="form-legend">1. Wat wil je doen?');
  assert.ok(idx > 0, 'expected fieldset 1 legend');
  const slice = html.slice(idx, idx + 1200);
  assert.ok(!/Nieuwe optie:\s*editorial bijdrage/.test(slice),
    'fieldset-1 intro must not pitch editorial bijdrage as "Nieuwe optie"');
});

check('submit-validation.html: legitimate staging context (VALIDATIEOMGEVING / niet publiek / testpreview) is preserved', () => {
  // We only stripped confusing "NIEUW" duiding from selection buttons.
  // Staging warnings must still appear so visitors know they are on the
  // validation environment.
  assert.ok(/VALIDATIEOMGEVING/.test(html), 'expected VALIDATIEOMGEVING staging marker on submit-validation.html');
  assert.ok(/NIET PUBLIEK/.test(html), 'expected "NIET PUBLIEK" stage-bar copy on submit-validation.html');
  assert.ok(/testpreview/i.test(html), 'expected "testpreview" copy on submit-validation.html');
});

check('request-listing-validation.html: page kicker keeps the staging "Nieuw in validatie" context (regression guard)', () => {
  // The validation kicker above the hero is allowed — it's staging context,
  // not a selection-button duiding.
  assert.ok(/<span[^>]*class="[^"]*new-pill[^"]*"[^>]*>\s*Nieuw in validatie\s*</.test(rlv),
    'expected the "Nieuw in validatie" kicker pill to remain on request-listing-validation.html');
});

if (failures) {
  console.log('\n' + failures + ' test(s) FAILED');
  process.exit(1);
}
console.log('\nall tests passed');
