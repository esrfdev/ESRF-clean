/* ════════════════════════════════════════════════════════════════
   ESRF.net — dynamic counters
   ────────────────────────────────────────────────────────────────
   Computes all organisation / country / sector counts at runtime
   from companies_extracted.json and populates:
     • [data-count="total"]            → total organisations
     • [data-count="countries"]        → unique country count
     • [data-count="sectors"]          → unique sector count
     • [data-count="sector:<name>"]    → orgs in that sector
     • [data-count="country:<name>"]   → orgs in that country
     • [data-count="news"]             → total news articles (if loaded)

   Also interpolates i18n strings containing the placeholders
     {total} {countries} {sectors} {sector:<name>} {country:<name>}
   by patching window.esrfI18n.applyTranslations().

   Locale-aware number formatting uses document.documentElement.lang.
   Re-runs on esrf:langchange.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────
  const state = {
    total: 0,
    countries: 0,
    sectors: 0,
    bySector: {},   // { 'Emergency & Crisis Response': 469, ... }
    byCountry: {},  // { 'Germany': 144, ... }
    ready: false,
  };

  // Expose early so other scripts can await window.esrfCountersReady
  window.esrfCounters = state;

  let _resolveReady;
  window.esrfCountersReady = new Promise(res => { _resolveReady = res; });

  // ── Helpers ───────────────────────────────────────────────────
  function fetchOrgs() {
    // Compute a relative path back to the site root based on URL depth.
    //   /index.html                        → ''        (root)
    //   /countries/index.html              → '../'
    //   /countries/netherlands/index.html  → '../../'
    const path = window.location.pathname;
    const dir = path.replace(/[^/]*$/, '');      // directory portion ending in '/'
    const depth = dir.split('/').filter(Boolean).length;
    const base = '../'.repeat(depth);
    return fetch(base + 'companies_extracted.json').then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function fmt(n) {
    const lang = document.documentElement.getAttribute('lang') || 'en';
    try {
      return new Intl.NumberFormat(lang).format(n);
    } catch (e) {
      return String(n);
    }
  }

  function compute(orgs) {
    const bySector = {};
    const byCountry = {};        // keyed by country_name_en (e.g. 'Netherlands')
    const byCountryCode = {};    // keyed by uppercase ISO code (e.g. 'NL')
    const byCountrySector = {};  // 'Netherlands||Security & Protection' -> N
    const sectorsByCountry = {}; // 'Netherlands' -> unique sector count
    const sectorSets = {};       // temp: country -> Set(sector)
    for (const o of orgs) {
      const s = o.sector_normalized || o.sector || '—';
      const cn = o.country_name_en || o.country || '—';
      const cc = (o.country || '').toUpperCase();
      bySector[s] = (bySector[s] || 0) + 1;
      byCountry[cn] = (byCountry[cn] || 0) + 1;
      if (cc) byCountryCode[cc] = (byCountryCode[cc] || 0) + 1;
      const ck = cn + '||' + s;
      byCountrySector[ck] = (byCountrySector[ck] || 0) + 1;
      if (!sectorSets[cn]) sectorSets[cn] = new Set();
      sectorSets[cn].add(s);
    }
    for (const cn in sectorSets) sectorsByCountry[cn] = sectorSets[cn].size;
    state.total = orgs.length;
    state.bySector = bySector;
    state.byCountry = byCountry;
    state.byCountryCode = byCountryCode;
    state.byCountrySector = byCountrySector;
    state.sectorsByCountry = sectorsByCountry;
    state.countries = Object.keys(byCountry).length;
    state.sectors = Object.keys(bySector).length;
    state.ready = true;
  }

  // Interpolate {token} placeholders inside a string using state.
  // Tokens:
  //   {total} {countries} {sectors}
  //   {sector:Name Of Sector}
  //   {country:Name Of Country}
  function interpolate(str) {
    if (typeof str !== 'string') return str;
    if (str.indexOf('{') === -1) return str;
    return str.replace(/\{([^}]+)\}/g, (match, token) => {
      const t = token.trim();
      if (t === 'total') return fmt(state.total);
      if (t === 'countries') return fmt(state.countries);
      if (t === 'sectors') return fmt(state.sectors);
      if (t.startsWith('sector:')) {
        const name = t.slice(7).trim();
        return fmt(state.bySector[name] || 0);
      }
      if (t.startsWith('country:')) {
        const name = t.slice(8).trim();
        // Try byCountry first (English name), then ISO code
        if (state.byCountry[name] !== undefined) return fmt(state.byCountry[name]);
        const upper = name.toUpperCase();
        if (state.byCountryCode[upper] !== undefined) return fmt(state.byCountryCode[upper]);
        return fmt(0);
      }
      // Sector/country orgs combined: {country-sector:Netherlands|Security & Protection}
      if (t.startsWith('country-sector:')) {
        const [cn, sn] = t.slice(15).split('|').map(x => x.trim());
        const key = cn + '||' + sn;
        return fmt(state.byCountrySector[key] || 0);
      }
      return match; // leave unknown tokens untouched
    });
  }
  state.interpolate = interpolate;
  state.fmt = fmt;

  // ── Populate [data-count="..."] elements ──────────────────────
  function applyDataCounts(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-count]').forEach(el => {
      const key = el.getAttribute('data-count');
      let val;
      if (key === 'total') val = state.total;
      else if (key === 'countries') val = state.countries;
      else if (key === 'sectors') val = state.sectors;
      else if (key.startsWith('sector:')) val = state.bySector[key.slice(7)] || 0;
      else if (key.startsWith('country:')) {
        const nm = key.slice(8);
        val = (state.byCountry[nm] !== undefined)
          ? state.byCountry[nm]
          : (state.byCountryCode[nm.toUpperCase()] || 0);
      }
      else if (key.startsWith('country-sector:')) {
        val = state.byCountrySector[key.slice(15)] || 0;
      }
      else if (key.startsWith('country-sectors:')) {
        // number of unique sectors for a country
        val = state.sectorsByCountry[key.slice(16)] || 0;
      }
      else return;
      el.textContent = fmt(val);
    });

    // Also update <meta> descriptions that reference the token via data-count-meta
    scope.querySelectorAll('meta[data-count-template]').forEach(m => {
      const tpl = m.getAttribute('data-count-template');
      m.setAttribute('content', interpolate(tpl));
    });
  }

  // ── Patch i18n applyTranslations so translated strings get
  //    {token} interpolation before being inserted in the DOM ──
  function patchI18n() {
    if (!window.esrfI18n || window.esrfI18n._countersPatched) return;
    const orig = window.esrfI18n.applyTranslations;
    const tOrig = window.esrfI18n.t;

    // Wrap t() so all string lookups are interpolated automatically.
    window.esrfI18n.t = function (key, fallback) {
      const v = tOrig(key, fallback);
      return (typeof v === 'string') ? interpolate(v) : v;
    };

    window.esrfI18n.applyTranslations = function () {
      orig.apply(this, arguments);
      // After i18n applied its translations, re-interpolate any
      // data-i18n / data-i18n-html elements that contain {tokens}
      // (applyTranslations uses the ORIGINAL t internally → we
      // post-process here just in case of race conditions).
      document.querySelectorAll('[data-i18n], [data-i18n-html], [data-i18n-placeholder], [data-i18n-attr][data-i18n-attr-key]').forEach(el => {
        // Text content
        if (el.hasAttribute('data-i18n')) {
          if (el.textContent.indexOf('{') !== -1) {
            el.textContent = interpolate(el.textContent);
          }
        }
        if (el.hasAttribute('data-i18n-html')) {
          if (el.innerHTML.indexOf('{') !== -1) {
            el.innerHTML = interpolate(el.innerHTML);
          }
        }
        if (el.hasAttribute('data-i18n-placeholder')) {
          const p = el.getAttribute('placeholder') || '';
          if (p.indexOf('{') !== -1) el.setAttribute('placeholder', interpolate(p));
        }
        if (el.hasAttribute('data-i18n-attr-key')) {
          const attr = el.getAttribute('data-i18n-attr');
          if (attr) {
            const cur = el.getAttribute(attr) || '';
            if (cur.indexOf('{') !== -1) el.setAttribute(attr, interpolate(cur));
          }
        }
      });
      // Always re-populate data-count elements too (handles locale number format changes)
      applyDataCounts();
    };

    window.esrfI18n._countersPatched = true;
  }

  // Re-apply translations (for i18n strings with {token} placeholders).
  // This scans the DOM and interpolates any {tokens} still present.
  function reinterpolateDom() {
    document.querySelectorAll('[data-i18n], [data-i18n-html], [data-i18n-placeholder]').forEach(el => {
      if (el.hasAttribute('data-i18n-html')) {
        if (el.innerHTML.indexOf('{') !== -1) el.innerHTML = interpolate(el.innerHTML);
      } else if (el.hasAttribute('data-i18n')) {
        if (el.textContent.indexOf('{') !== -1) el.textContent = interpolate(el.textContent);
      }
      if (el.hasAttribute('data-i18n-placeholder')) {
        const pp = el.getAttribute('placeholder') || '';
        if (pp.indexOf('{') !== -1) el.setAttribute('placeholder', interpolate(pp));
      }
    });
    // <meta>, <title> etc. that use data-i18n-attr mechanism
    document.querySelectorAll('[data-i18n-attr][data-i18n-attr-key]').forEach(el => {
      const attr = el.getAttribute('data-i18n-attr');
      if (!attr) return;
      const cur = el.getAttribute(attr) || '';
      if (cur.indexOf('{') !== -1) el.setAttribute(attr, interpolate(cur));
    });
  }
  state.reinterpolateDom = reinterpolateDom;

  // ── Bootstrap ─────────────────────────────────────────────────
  function boot() {
    fetchOrgs()
      .then(orgs => {
        compute(orgs);
        patchI18n();
        applyDataCounts();
        reinterpolateDom();
        _resolveReady(state);
      })
      .catch(err => {
        console.warn('[counters] failed to load orgs:', err);
        _resolveReady(state);
      });
  }

  // Re-apply after language change (i18n has just replaced DOM text
  // with new translations that may again contain {tokens}).
  window.addEventListener('esrf:langchange', () => {
    patchI18n();
    applyDataCounts();
    reinterpolateDom();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
