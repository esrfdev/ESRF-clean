/*
 * validate_sector_filters_driver.js
 *
 * End-to-end regression for the Atlas + Directory sector filter across every
 * language. Invoked by validate_sector_filters.py. For each locale:
 *
 *   map.html?lang=<L>       → reads localised chip, clicks it, asserts the
 *                             live count equals expected sector count, URL
 *                             syncs to ?sector=<canonical>, and for the
 *                             Emergency sector the tag-chip bar appears.
 *   directory.html?lang=<L> → opens the sector dropdown, clicks the localised
 *                             option, asserts the same invariants plus the
 *                             active-filter pill label.
 *
 * Expects a local HTTP server on 127.0.0.1:$PORT (default 8123) serving the
 * repo root — the caller (make / npm / CI) spins one up before running this.
 *
 * Environment:
 *   ESRF_LANGS     comma-separated list of locales to cover (default: all 27)
 *   ESRF_SECTORS   comma-separated list of canonical sectors (default: all 10)
 *   ESRF_PORT      HTTP server port (default 8123)
 *   ESRF_JSDOM     explicit path to jsdom module (auto-detected otherwise)
 */
'use strict';

const path = require('path');
const fs = require('fs');

const PORT = process.env.ESRF_PORT || '8123';
const BASE = `http://127.0.0.1:${PORT}`;

function findJsdom(){
  const candidates = [
    process.env.ESRF_JSDOM,
    '/tmp/j22/node_modules/jsdom',
    path.resolve(__dirname, '..', 'node_modules', 'jsdom'),
    '/usr/local/lib/node_modules/jsdom',
  ].filter(Boolean);
  for (const c of candidates) {
    try { require.resolve(c); return c; } catch (_) {}
  }
  return null;
}
function findNodeFetch(){
  const candidates = [
    '/tmp/j22/node_modules/node-fetch',
    path.resolve(__dirname, '..', 'node_modules', 'node-fetch'),
  ];
  for (const c of candidates) {
    try { require.resolve(c); return c; } catch (_) {}
  }
  return null;
}

const JSDOM_PATH = findJsdom();
if (!JSDOM_PATH) {
  console.error('jsdom not installed — skipping end-to-end suite');
  process.exit(0);
}
const { JSDOM, ResourceLoader } = require(JSDOM_PATH);
const NODE_FETCH = findNodeFetch();
const fetchFn = NODE_FETCH ? require(NODE_FETCH) : null;

class SilentLoader extends ResourceLoader {
  fetch(url, options) {
    if (/unpkg\.com|cloudflareinsights|googletagmanager|pagead2|fonts\.googleapis|fonts\.gstatic|basemaps\.cartocdn|adsbygoogle/.test(url)) {
      return Promise.resolve(Buffer.from(''));
    }
    return super.fetch(url, options);
  }
}

// Canonical sectors in the order app.js SECTOR_ORDER expects
const SECTOR_ORDER = [
  'Emergency & Crisis Response',
  'Security & Protection',
  'Risk & Continuity Management',
  'Digital Infrastructure & Cybersecurity',
  'Knowledge, Training & Research',
  'Health & Medical Manufacturing',
  'Critical Infrastructure',
  'Dual-use Technology & Manufacturing',
  'Transport, Maritime & Aerospace',
  'Energy & Grid Resilience',
];

function pickEnv(name, fallback){
  const v = process.env[name];
  if (!v) return fallback;
  return v.split(',').map(s => s.trim()).filter(Boolean);
}
const LANGS = pickEnv('ESRF_LANGS', null) || [
  'bg','cs','da','de','el','en','es','et','fi','fr','ga','hr','hu','is',
  'it','lt','lv','mt','nl','no','pl','pt','ro','sk','sl','sv','uk',
];
const SECTORS = pickEnv('ESRF_SECTORS', SECTOR_ORDER);

// Pre-compute expected sector counts from the data.
const orgs = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'companies_extracted.json'), 'utf8'));
const EXPECTED = {};
orgs.forEach(o => { EXPECTED[o.sector_normalized] = (EXPECTED[o.sector_normalized] || 0) + 1; });

function makeWindow(url){
  return JSDOM.fromURL(url, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    resources: new SilentLoader(),
  }).then(dom => {
    const { window } = dom;
    window.IntersectionObserver = class { constructor(){} observe(){} unobserve(){} disconnect(){} };
    if (fetchFn) {
      window.fetch = (u, o) => fetchFn(/^https?:/.test(u) ? u : new URL(u, BASE + '/').href, o);
    }
    // Stub Leaflet so map.html doesn't hit the network.
    window.L = {
      map: () => ({
        setView: function(){ return this; },
        zoomControl: { setPosition: () => {} },
        addLayer: () => {},
      }),
      tileLayer: () => ({ addTo: () => {} }),
      markerClusterGroup: () => ({ clearLayers: () => {}, addLayers: () => {}, addLayer: () => {} }),
      circleMarker: () => ({ bindTooltip: function(){return this;}, on: function(){return this;} }),
      divIcon: () => ({}),
    };
    const errs = [];
    dom.virtualConsole.on('jsdomError', e => errs.push('jsdomErr: ' + e.message));
    return { dom, window, errs };
  });
}

async function settle(win, ms){
  const until = Date.now() + (ms || 2000);
  while (Date.now() < until) { await new Promise(r => setTimeout(r, 30)); }
}

async function testMap(lang, sector){
  const expected = EXPECTED[sector] || 0;
  const { window, errs } = await makeWindow(`${BASE}/map.html?lang=${lang}`);
  await settle(window, 1500);
  const chip = [...window.document.querySelectorAll('#sector-chips .chip')]
    .find(c => c.dataset.sector === sector);
  if (!chip) return { ok:false, reason:`no chip for ${sector} in ${lang}` };
  const label = chip.textContent.trim();
  chip.click();
  await settle(window, 400);
  const count = parseInt(window.document.getElementById('count').textContent.replace(/[^\d]/g, ''), 10);
  const url = window.location.href;
  if (count !== expected) return { ok:false, reason:`count ${count} != expected ${expected} (label=${JSON.stringify(label)})` };
  if (!/[?&]sector=/.test(url)) return { ok:false, reason:`URL didn't sync: ${url}` };
  if (sector === 'Emergency & Crisis Response') {
    const tagBar = !window.document.getElementById('tag-group-label').hidden;
    const tagChips = window.document.querySelectorAll('#tag-chips .chip').length;
    if (!tagBar) return { ok:false, reason:'tag label not visible for Emergency' };
    if (tagChips < 2) return { ok:false, reason:`tag chips=${tagChips} expected >=2` };
  }
  if (errs.length) return { ok:false, reason:`jsdom errors: ${errs.slice(0,2).join(' | ')}` };
  return { ok:true, label, count };
}

async function testDir(lang, sector){
  const expected = EXPECTED[sector] || 0;
  const { window, errs } = await makeWindow(`${BASE}/directory.html?lang=${lang}`);
  await settle(window, 1500);
  const btn = window.document.querySelector('#dd-sector .dir-dropdown-btn');
  btn.click();
  await settle(window, 150);
  const option = [...window.document.querySelectorAll('#dd-sector-options .dd-option')]
    .find(o => o.dataset.value === sector);
  if (!option) return { ok:false, reason:`no dd-option for ${sector} in ${lang}` };
  const label = option.textContent.trim();
  option.click();
  await settle(window, 300);
  const count = parseInt(window.document.getElementById('count').textContent.replace(/[^\d]/g, ''), 10);
  const url = window.location.href;
  if (count !== expected) return { ok:false, reason:`count ${count} != expected ${expected} (label=${JSON.stringify(label)})` };
  if (!/[?&]sector=/.test(url)) return { ok:false, reason:`URL didn't sync: ${url}` };
  const pill = window.document.querySelector('#active-filters .dir-filter-tag');
  if (!pill) return { ok:false, reason:'no active filter pill' };
  if (sector === 'Emergency & Crisis Response') {
    const tagBar = !window.document.getElementById('dir-tag-bar').hidden;
    const tagChips = window.document.querySelectorAll('#dir-tag-chips .chip').length;
    if (!tagBar) return { ok:false, reason:'tag bar not visible for Emergency' };
    if (tagChips < 2) return { ok:false, reason:`tag chips=${tagChips} expected >=2` };
  }
  if (errs.length) return { ok:false, reason:`jsdom errors: ${errs.slice(0,2).join(' | ')}` };
  return { ok:true, label, count };
}

async function main(){
  const failures = [];
  let ok = 0, total = 0;
  for (const lang of LANGS) {
    for (const sector of SECTORS) {
      for (const [page, fn] of [['map', testMap], ['dir', testDir]]) {
        total++;
        try {
          const r = await fn(lang, sector);
          if (!r.ok) { failures.push(`${page}/${lang}/${sector}: ${r.reason}`); }
          else { ok++; }
        } catch (e) {
          failures.push(`${page}/${lang}/${sector}: threw ${e.message}`);
        }
      }
    }
    process.stdout.write(`  ${lang}: ${ok}/${total} ok so far\r`);
  }
  console.log('');
  if (failures.length) {
    console.log(`FAIL ${failures.length}/${total} cases:`);
    failures.slice(0, 25).forEach(f => console.log('  - ' + f));
    if (failures.length > 25) console.log(`  … ${failures.length - 25} more`);
    process.exit(1);
  }
  console.log(`OK ${ok}/${total} cases (${LANGS.length} langs × ${SECTORS.length} sectors × 2 pages)`);
}

main().catch(e => { console.error(e); process.exit(1); });
