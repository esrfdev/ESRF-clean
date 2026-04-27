// Test: event-submission CTAs preserve runtime language and route through
// the combined intake form, and the legacy public submit-event /
// request-listing forms have been retired in favour of signposts.
//
// Background — 2026-04-27 live issue (Wouter):
//   Visitors landing on the events page in English context were following
//   the "Submit an event" CTA into a Dutch-only standalone form. The fix
//   is two-fold:
//
//     1. submit-event.html no longer ships a standalone <form>; it shows
//        a signpost (NL + EN) whose CTA links to the combined intake at
//        /submit-news?lang=<runtime-lang>&mode=event. Same for
//        request-listing.html.
//
//     2. Every public event-submission CTA is marked with
//        [data-event-cta] and rewritten at runtime to include the
//        visitor's detected ?lang= so the destination form opens in the
//        right language, with the Event-aanmelden / Submit-an-event
//        radio preselected via mode=event.
//
// What this test guards:
//   • submit-event.html and request-listing.html contain NO standalone
//     <form> bodies and NO legacy event/listing input fields.
//   • Both pages contain a clear signpost CTA pointing at the combined
//     intake with mode=event (resp. mode=org / mode=change_request).
//   • Both pages carry the language-detection + CTA-rewrite JS so the
//     CTA href ends up as /submit-news?lang=...&mode=...
//   • The intake reads mode= and treats 'event' as a valid preselect
//     target in BOTH the NL and EN forms.
//   • events.html event-submission CTAs are tagged [data-event-cta] and
//     point at /submit-news?mode=event (rewritten at runtime to add
//     ?lang=).
//   • search.js no longer surfaces the legacy submit-event.html URL.
//
// Run with: node scripts/event_cta_language.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

let failures = 0;
function check(name, fn){
  try { fn(); console.log('  ok  — ' + name); }
  catch(e){ failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}

const submitEvent  = fs.readFileSync(path.join(repoRoot, 'submit-event.html'),  'utf8');
const requestList  = fs.readFileSync(path.join(repoRoot, 'request-listing.html'), 'utf8');
const submitNews   = fs.readFileSync(path.join(repoRoot, 'submit-news.html'),  'utf8');
const eventsHtml   = fs.readFileSync(path.join(repoRoot, 'events.html'),       'utf8');
const searchJs     = fs.readFileSync(path.join(repoRoot, 'search.js'),         'utf8');

/* ── 1. submit-event.html: no legacy form, only the signpost ───────────── */

check('submit-event.html contains no <form> element', () => {
  assert.ok(!/<form\b/i.test(submitEvent), 'submit-event.html still has a <form> element');
});

check('submit-event.html contains no legacy event input fields', () => {
  // Specific id/name attributes from the retired event form.
  const legacyIds = [
    'ev-name','ev-type','ev-date-start','ev-date-end','ev-description',
    'ev-topics','ev-city','ev-country','ev-venue','ev-website',
    'ev-organiser','ev-organiser-url','ev-source','ev-contact-name',
    'ev-contact-email','ev-contact-role','ev-gdpr',
  ];
  const offenders = legacyIds.filter(id => new RegExp('id=["\']' + id + '["\']').test(submitEvent));
  assert.deepEqual(offenders, [], 'legacy event input ids still present: ' + offenders.join(', '));
});

check('submit-event.html contains no <input>/<textarea>/<select> body fields', () => {
  // The page should contain no form controls at all (signpost only).
  const offenders = [];
  if (/<input\b/i.test(submitEvent))    offenders.push('<input>');
  if (/<textarea\b/i.test(submitEvent)) offenders.push('<textarea>');
  if (/<select\b/i.test(submitEvent))   offenders.push('<select>');
  assert.deepEqual(offenders, [], 'form controls found on submit-event.html: ' + offenders.join(', '));
});

check('submit-event.html no longer references the retired mailto:event@esrf.net handler', () => {
  assert.ok(!/mailto:event@esrf\.net/.test(submitEvent),
    'submit-event.html still wires up the legacy mailto: handler');
});

check('submit-event.html signposts to /submit-news?...mode=event', () => {
  // At least one anchor must carry mode=event in its initial href so
  // crawlers and JS-disabled visitors still see the correct route.
  assert.match(submitEvent, /href="\/submit-news\?[^"]*mode=event/,
    'no signpost link to /submit-news?...mode=event found');
});

check('submit-event.html declares [data-signpost-cta] anchors', () => {
  const matches = submitEvent.match(/data-signpost-cta\b/g) || [];
  assert.ok(matches.length >= 1, 'expected at least one [data-signpost-cta] anchor');
});

check('submit-event.html ships JS that detects lang and rewrites CTA href', () => {
  assert.match(submitEvent, /\/submit-news\?lang=['"]?\s*\+\s*ctaLang/,
    'expected runtime CTA rewrite to include ?lang= prefix');
  assert.match(submitEvent, /mode=event/, 'rewritten CTA must carry mode=event');
});

check('submit-event.html serves NL-default + EN variants for the signpost', () => {
  assert.match(submitEvent, /data-signpost-title-nl/, 'missing NL signpost title variant');
  assert.match(submitEvent, /data-signpost-title-en/, 'missing EN signpost title variant');
});

/* ── 2. request-listing.html: no legacy form, only the signpost ────────── */

check('request-listing.html contains no <form> element', () => {
  assert.ok(!/<form\b/i.test(requestList), 'request-listing.html still has a <form> element');
});

check('request-listing.html contains no legacy listing input fields', () => {
  const legacyIds = [
    'name','country','city','website','sector',
    'contact_name','contact_email','description','gdpr_consent',
  ];
  const offenders = legacyIds.filter(id => new RegExp('<(?:input|textarea|select)[^>]*id=["\']' + id + '["\']').test(requestList));
  assert.deepEqual(offenders, [], 'legacy listing input ids still present: ' + offenders.join(', '));
});

check('request-listing.html contains no <input>/<textarea>/<select> body fields', () => {
  const offenders = [];
  if (/<input\b/i.test(requestList))    offenders.push('<input>');
  if (/<textarea\b/i.test(requestList)) offenders.push('<textarea>');
  if (/<select\b/i.test(requestList))   offenders.push('<select>');
  assert.deepEqual(offenders, [], 'form controls found on request-listing.html: ' + offenders.join(', '));
});

check('request-listing.html signposts to /submit-news?...mode=org', () => {
  assert.match(requestList, /href="\/submit-news\?[^"]*mode=org/,
    'no signpost link to /submit-news?...mode=org found');
});

check('request-listing.html signposts to /submit-news?...mode=change_request', () => {
  assert.match(requestList, /href="\/submit-news\?[^"]*mode=change_request/,
    'no signpost link to /submit-news?...mode=change_request found');
});

check('request-listing.html ships JS that detects lang and rewrites CTAs', () => {
  assert.match(requestList, /\/submit-news\?lang=['"]?\s*\+\s*ctaLang\s*\+\s*['"]?&mode=org/,
    'expected runtime CTA rewrite for org with ?lang= prefix');
  assert.match(requestList, /\/submit-news\?lang=['"]?\s*\+\s*ctaLang\s*\+\s*['"]?&mode=change_request/,
    'expected runtime CTA rewrite for change_request with ?lang= prefix');
});

/* ── 3. submit-news.html: 'event' is a valid preselect mode (NL + EN) ──── */

check('submit-news.html lists "event" as a valid preselect target in BOTH forms', () => {
  // Each form has its own VALID array; both must include 'event'.
  const re = /VALID\s*=\s*\[[^\]]*'event'/g;
  const matches = submitNews.match(re) || [];
  assert.ok(matches.length >= 2,
    'expected "event" in the VALID list of BOTH preselect helpers, found ' + matches.length);
});

check('submit-news.html reads ?mode= from the URL in both forms', () => {
  const matches = submitNews.match(/new URLSearchParams\(window\.location\.search\)\.get\('mode'\)/g) || [];
  assert.ok(matches.length >= 2,
    'expected at least 2 occurrences (NL + EN), found ' + matches.length);
});

check('submit-news.html has an event-mode radio for both NL and EN forms', () => {
  // Both forms include a radio with name="intake_mode" value="event".
  const matches = submitNews.match(/name=["']intake_mode["']\s+value=["']event["']/g) || [];
  assert.ok(matches.length >= 2,
    'expected event-mode radio in BOTH forms, found ' + matches.length);
});

check('submit-news.html applyMode handles "event" submit-button label in both languages', () => {
  // NL form sets a Dutch label; EN form sets an English label.
  assert.match(submitNews, /m === 'event'\)\s*submitBtn\.textContent\s*=\s*['"]Meld je event aan['"]/,
    'expected NL submit-button label "Meld je event aan"');
  assert.match(submitNews, /m === 'event'\)\s*submitBtn\.textContent\s*=\s*['"]Submit your event['"]/,
    'expected EN submit-button label "Submit your event"');
});

/* ── 4. events.html: event-submission CTAs preserve language ───────────── */

check('events.html "Submit an event" CTAs are tagged [data-event-cta]', () => {
  // Two separate CTAs on the page; both must carry the marker.
  const tagged = (eventsHtml.match(/data-event-cta\b/g) || []).length;
  assert.ok(tagged >= 2, 'expected ≥2 [data-event-cta] anchors, found ' + tagged);
});

check('events.html [data-event-cta] anchors point at /submit-news?mode=event', () => {
  const RE = /<a\s[^>]*data-event-cta[^>]*>/g;
  const tags = eventsHtml.match(RE) || [];
  assert.ok(tags.length >= 2, 'expected ≥2 [data-event-cta] anchors, found ' + tags.length);
  const offenders = [];
  for (const tag of tags) {
    const href = (tag.match(/\bhref="([^"]+)"/) || [,''])[1];
    if (!/\/submit-news\?[^"]*mode=event/.test(href)) offenders.push(tag);
  }
  assert.deepEqual(offenders, [], 'CTAs missing /submit-news?...mode=event:\n  ' + offenders.join('\n  '));
});

check('events.html no longer links to the legacy submit-event.html', () => {
  assert.ok(!/href=["']submit-event\.html["']/.test(eventsHtml),
    'events.html still links directly to submit-event.html');
});

check('events.html ships JS that rewrites [data-event-cta] hrefs with ?lang=', () => {
  // The rewrite block builds /submit-news?lang=<ctaLang>&mode=event.
  assert.match(eventsHtml, /document\.querySelectorAll\(['"]?\[data-event-cta\]/,
    'no rewrite logic for [data-event-cta] found');
  assert.match(eventsHtml, /\/submit-news\?lang=['"]?\s*\+\s*ctaLang/,
    'expected ?lang= prefix in the runtime CTA rewrite');
});

/* ── 5. EN-context vs NL-context behaviour (URL-detection logic) ───────── */

// Mirror the runtime-language detection used on submit-event.html /
// request-listing.html / events.html and assert that an EN visitor
// produces an EN target and a NL visitor produces an NL target.
function buildCtaForLang(visitorLang) {
  const ctaLang = (visitorLang === 'nl') ? 'nl' : 'en';
  return '/submit-news?lang=' + ctaLang + '&mode=event';
}

check('EN visitor → CTA resolves to /submit-news?lang=en&mode=event', () => {
  assert.equal(buildCtaForLang('en'), '/submit-news?lang=en&mode=event');
});
check('NL visitor → CTA resolves to /submit-news?lang=nl&mode=event', () => {
  assert.equal(buildCtaForLang('nl'), '/submit-news?lang=nl&mode=event');
});
check('Other-language visitor (de/fr/…) → CTA defaults to lang=en path', () => {
  // Any non-Dutch language renders the EN form on submit-news.html, so
  // the CTA should also normalise to lang=en for consistency.
  assert.equal(buildCtaForLang('de'), '/submit-news?lang=en&mode=event');
  assert.equal(buildCtaForLang('fr'), '/submit-news?lang=en&mode=event');
});

/* ── 6. search.js: no legacy submit-event.html in the page index ───────── */

check('search.js page index uses /submit-news?mode=event for "Submit an event"', () => {
  // The static title must remain so search hits still match, but the URL
  // must point at the combined intake.
  assert.match(searchJs, /title:\s*['"]Submit an event['"][\s\S]*?url:\s*['"]\/submit-news\?mode=event['"]/,
    'expected the "Submit an event" entry in search.js to point at /submit-news?mode=event');
  assert.ok(!/url:\s*['"]submit-event\.html['"]/.test(searchJs),
    'search.js still references the legacy submit-event.html URL');
});

if (failures > 0) {
  console.log('\n' + failures + ' check(s) failed.');
  process.exit(1);
} else {
  console.log('\nAll event_cta_language checks passed.');
}
