/* ════════════════════════════════════════════════════════════════
   ESRF.net — i18n framework for 27 languages
   ════════════════════════════════════════════════════════════════ */

const LANGS = [
  { code: 'bg', name: 'Български' },
  { code: 'cs', name: 'Čeština' },
  { code: 'da', name: 'Dansk' },
  { code: 'de', name: 'Deutsch' },
  { code: 'el', name: 'Ελληνικά' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'et', name: 'Eesti' },
  { code: 'fi', name: 'Suomi' },
  { code: 'fr', name: 'Français' },
  { code: 'ga', name: 'Gaeilge' },
  { code: 'hr', name: 'Hrvatski' },
  { code: 'hu', name: 'Magyar' },
  { code: 'is', name: 'Íslenska' },
  { code: 'it', name: 'Italiano' },
  { code: 'lt', name: 'Lietuvių' },
  { code: 'lv', name: 'Latviešu' },
  { code: 'mt', name: 'Malti' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'no', name: 'Norsk' },
  { code: 'pl', name: 'Polski' },
  { code: 'pt', name: 'Português' },
  { code: 'ro', name: 'Română' },
  { code: 'sk', name: 'Slovenčina' },
  { code: 'sl', name: 'Slovenščina' },
  { code: 'sv', name: 'Svenska' },
  { code: 'uk', name: 'Українська' },
];

let _strings = {};
let _currentLang = 'en';

/* ── Safe static fallbacks for counter tokens ──────────────────────
   i18n strings contain {total}/{countries}/{sectors} placeholders
   that counters.js fills with live data from companies_extracted.json.
   counters.js is loaded deferred, so on slow mobile webviews (e.g.
   WhatsApp in-app browser) i18n may write translated strings to the
   DOM before counters.js has had a chance to interpolate, leaving raw
   "{total}" / "{countries}" visible to the user.

   We embed the same static FALLBACK values here so applyTranslations
   can pre-interpolate every string before writing to the DOM. Counters
   still refines these values once live JSON loads — but the user never
   sees a raw token, blank, NaN or undefined. */
const TOKEN_FALLBACK = { total: 2083, countries: 30, sectors: 10 };

function _fmtTokenNumber(n) {
  try { return new Intl.NumberFormat(_currentLang || 'en').format(n); }
  catch (e) { return String(n); }
}

function _interpolateTokens(str) {
  if (typeof str !== 'string' || str.indexOf('{') === -1) return str;
  const live = (window.esrfCounters && window.esrfCounters.ready) ? window.esrfCounters : null;
  return str.replace(/\{([^}]+)\}/g, (match, token) => {
    const t = token.trim();
    // Prefer live counters interpolate if counters.js has loaded AND
    // computed real data — it handles the full token vocabulary
    // (sector:, country:, country-sector:).
    if (live && typeof live.interpolate === 'function') {
      const resolved = live.interpolate(match);
      if (resolved !== match) return resolved;
    }
    if (t === 'total') return _fmtTokenNumber(TOKEN_FALLBACK.total);
    if (t === 'countries') return _fmtTokenNumber(TOKEN_FALLBACK.countries);
    if (t === 'sectors') return _fmtTokenNumber(TOKEN_FALLBACK.sectors);
    // Unknown tokens (sector:, country:, etc.) without counters loaded:
    // fall back to empty string rather than leave a visible placeholder.
    return '';
  });
}

/* ── Detect language from URL → localStorage → browser → fallback ── */
function detectLang() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('lang');
  if (fromUrl && LANGS.find(l => l.code === fromUrl)) return fromUrl;

  try {
    const stored = localStorage.getItem('esrfnetLang');
    if (stored && LANGS.find(l => l.code === stored)) return stored;
  } catch(e) {}

  const browser = (navigator.language || navigator.userLanguage || 'en').split('-')[0].toLowerCase();
  if (LANGS.find(l => l.code === browser)) return browser;

  return 'en';
}

/* ── Fetch translation file ── */
async function fetchStrings(lang) {
  // Resolve path relative to current page depth
  const depth = (window.location.pathname.match(/\//g) || []).length - 1;
  const prefix = depth > 1 ? '../'.repeat(depth - 1) : '';
  // Detect if we're in a subdirectory (countries/XX)
  const isSubDir = window.location.pathname.includes('/countries/');
  const base = isSubDir ? '../' : '';

  try {
    const r = await fetch(`${base}i18n/${lang}.json`);
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();
  } catch(e) {
    if (lang !== 'en') {
      try {
        const r2 = await fetch(`${base}i18n/en.json`);
        return await r2.json();
      } catch(e2) { return {}; }
    }
    return {};
  }
}

/* ── Nested key getter: t('nav.foundation') → strings.nav.foundation ── */
function getNestedKey(obj, path) {
  return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), obj);
}

/* ── Public t() function ──
   Returns the raw translation string with any {total}/{countries}/
   {sectors} tokens already resolved. This guarantees that no caller
   ever receives a raw token, even when counters.js has not loaded. */
function t(key, fallback) {
  const val = getNestedKey(_strings, key);
  if (val !== null && val !== undefined) return _interpolateTokens(val);
  if (fallback !== undefined) return _interpolateTokens(fallback);
  return key;
}

/* ── Propagate ?lang= to internal navigation links ──
   Ensures the donation/fund button (and any other internal nav link)
   carries the user's current locale into the next page, even before
   localStorage hydrates (fresh tab, shared link, in-app browsers with
   localStorage blocked). Only same-origin .html anchors are touched;
   mailto/tel/external/javascript/anchor-only links and language-switcher
   buttons are left alone. Anchors already pinned to a different lang
   are respected. */
function propagateLangToInternalLinks() {
  const lang = _currentLang || 'en';
  document.querySelectorAll('a[href]').forEach(a => {
    const raw = a.getAttribute('href');
    if (!raw) return;
    if (/^(?:mailto:|tel:|javascript:|#|data:)/i.test(raw)) return;
    if (/^https?:\/\//i.test(raw) && !/^https?:\/\/(?:[^/]*\.)?esrf\.net(?:[/:?#]|$)/i.test(raw)) return;
    if (!/\.html(?:[?#]|$)/i.test(raw)) return;
    if (a.closest('.lang-menu') || a.closest('.lang-current')) return;
    try {
      const url = new URL(raw, window.location.href);
      if (url.origin !== window.location.origin && !/(?:^|\.)esrf\.net$/i.test(url.hostname)) return;
      const existing = url.searchParams.get('lang');
      if (existing && existing !== lang) return;
      if (lang === 'en') {
        url.searchParams.delete('lang');
      } else {
        url.searchParams.set('lang', lang);
      }
      const isAbsolute = /^(?:https?:)?\/\//i.test(raw) || raw.startsWith('/');
      let rebuilt;
      if (isAbsolute) {
        rebuilt = url.toString();
      } else {
        const here = window.location.pathname.replace(/[^/]*$/, '');
        let p = url.pathname;
        if (p.startsWith(here)) p = p.slice(here.length);
        else p = p.replace(/^\//, '');
        rebuilt = p + (url.search || '') + (url.hash || '');
      }
      if (rebuilt && rebuilt !== raw) a.setAttribute('href', rebuilt);
    } catch (e) { /* malformed — ignore */ }
  });
}

/* ── Apply translations to DOM ── */
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    if (val !== key) el.textContent = val;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const val = t(key);
    if (val !== key) el.placeholder = val;
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    const val = t(key);
    if (val !== key) el.innerHTML = val;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    const val = t(key);
    if (val !== key) el.setAttribute('title', val);
  });
  document.querySelectorAll('[data-i18n-label]').forEach(el => {
    const key = el.getAttribute('data-i18n-label');
    const val = t(key);
    if (val !== key) el.setAttribute('label', val);
  });
  // Generic attribute i18n: data-i18n-attr="content" targets content attr
  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    const attrName = el.getAttribute('data-i18n-attr');
    const keyAttr = el.getAttribute('data-i18n');
    // If data-i18n is also on element we already handled textContent; check a dedicated key instead.
    // Expected pattern: <meta data-i18n-attr="content" data-i18n-attr-key="meta.description">
    const key = el.getAttribute('data-i18n-attr-key');
    if (attrName && key) {
      const val = t(key);
      if (val !== key) el.setAttribute(attrName, val);
    }
  });

  // Defensive sweep: after all translations are written, scan every
  // translated node for any residual {token} (should never happen
  // because t() pre-interpolates, but a belt-and-braces guarantee
  // against any future translation that bypasses t()).
  document.querySelectorAll('[data-i18n], [data-i18n-html], [data-i18n-placeholder]').forEach(el => {
    if (el.hasAttribute('data-i18n-html')) {
      if (el.innerHTML.indexOf('{') !== -1) el.innerHTML = _interpolateTokens(el.innerHTML);
    } else if (el.hasAttribute('data-i18n')) {
      if (el.textContent.indexOf('{') !== -1) el.textContent = _interpolateTokens(el.textContent);
    }
    if (el.hasAttribute('data-i18n-placeholder')) {
      const p = el.getAttribute('placeholder') || '';
      if (p.indexOf('{') !== -1) el.setAttribute('placeholder', _interpolateTokens(p));
    }
  });

  // After every translation pass, ask counters.js (if loaded) to
  // refill [data-count] elements with the latest live values. Counters
  // may overwrite the static fallback with live totals once JSON loads.
  try {
    if (window.esrfCounters) {
      if (typeof window.esrfCounters.reinterpolateDom === 'function') {
        window.esrfCounters.reinterpolateDom();
      }
      if (typeof window.esrfCounters.applyDataCounts === 'function') {
        window.esrfCounters.applyDataCounts();
      }
    }
  } catch (e) { /* swallow — counters are non-critical */ }

  // Append ?lang= to internal nav links so the donation button (and
  // every other internal anchor) keeps the user's locale across pages,
  // even when localStorage is blocked or unhydrated.
  try { propagateLangToInternalLinks(); } catch (e) { /* non-critical */ }
}

/* ── Update lang current display ── */
function updateLangDisplay(lang) {
  document.querySelectorAll('[data-lang-current]').forEach(el => {
    el.textContent = lang.toUpperCase();
  });
  // Update flag in .lang-current button
  document.querySelectorAll('.lang-current').forEach(btn => {
    const existing = btn.querySelector('.lang-flag');
    if (existing) existing.remove();
    if (window.esrfFlags) {
      const flagHtml = window.esrfFlags.flagForLang(lang, {size:'inline'});
      const tmp = document.createElement('span');
      tmp.className = 'lang-flag';
      tmp.style.cssText = 'display:inline-flex;align-items:center';
      tmp.innerHTML = flagHtml.replace('class="flag-icon flag-inline"','class="flag-icon flag-inline" style="margin-right:0"');
      btn.insertBefore(tmp, btn.firstChild);
    }
  });
  document.querySelectorAll('.lang-menu button').forEach(btn => {
    btn.setAttribute('aria-current', btn.dataset.lang === lang ? 'true' : 'false');
  });
}

/* ── Add hreflang alternate links ── */
function addHreflangLinks() {
  const base = window.location.href.split('?')[0];
  LANGS.forEach(l => {
    // Remove existing
    const existing = document.querySelector(`link[hreflang="${l.code}"]`);
    if (existing) existing.remove();
    const link = document.createElement('link');
    link.rel = 'alternate';
    link.hreflang = l.code;
    link.href = `${base}?lang=${l.code}`;
    document.head.appendChild(link);
  });
}

/* ── Render language dropdown menu ── */
function renderLangMenu() {
  document.querySelectorAll('#lang-menu').forEach(menu => {
    menu.innerHTML = LANGS.map(l => {
      const flagImg = window.esrfFlags ? window.esrfFlags.flagForLang(l.code, {size:'inline'}) : '';
      return `
      <li>
        <button data-lang="${l.code}" aria-current="${l.code === _currentLang ? 'true' : 'false'}">
          ${flagImg}<span>${l.name}</span>
          <span class="lang-code">${l.code}</span>
        </button>
      </li>`;
    }).join('');

    menu.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        switchLang(btn.dataset.lang);
      });
    });
  });
}

/* ── Switch language ── */
async function switchLang(lang) {
  _currentLang = lang;
  try { localStorage.setItem('esrfnetLang', lang); } catch(e) {}

  // Update URL without reload
  const url = new URL(window.location.href);
  url.searchParams.set('lang', lang);
  window.history.replaceState({}, '', url.toString());

  _strings = await fetchStrings(lang);
  document.documentElement.setAttribute('lang', lang);
  applyTranslations();
  updateLangDisplay(lang);
  renderLangMenu();

  // Close dropdown
  document.querySelectorAll('.lang-current').forEach(btn => {
    btn.setAttribute('aria-expanded', 'false');
  });
  document.querySelectorAll('#lang-menu').forEach(m => m.hidden = true);

  // Notify other code (e.g. re-render directory cards)
  window.dispatchEvent(new CustomEvent('esrf:langchange', { detail: { lang } }));
}

/* ── Wire up dropdown toggle buttons ── */
function wireLangToggle() {
  document.querySelectorAll('.lang-current').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      const menuId = btn.getAttribute('aria-controls');
      const menu = document.getElementById(menuId);
      if (menu) menu.hidden = expanded;
    });
  });

  // Close on outside click
  document.addEventListener('click', () => {
    document.querySelectorAll('.lang-current').forEach(btn => {
      btn.setAttribute('aria-expanded', 'false');
    });
    document.querySelectorAll('#lang-menu').forEach(m => m.hidden = true);
  });
}

/* ── Main init ──
   `ready` is a single promise that resolves once initial strings are loaded
   and the first esrf:langchange has fired. Page scripts that need i18n
   before rendering (e.g. to canonicalise ?sector=<localised label>) can
   `await window.esrfI18n.ready` regardless of whether they loaded before
   or after initI18n resolved. */
let _readyResolve;
const _readyPromise = new Promise(res => { _readyResolve = res; });
async function initI18n() {
  _currentLang = detectLang();
  _strings = await fetchStrings(_currentLang);
  document.documentElement.setAttribute('lang', _currentLang);
  applyTranslations();
  addHreflangLinks();
  renderLangMenu();
  updateLangDisplay(_currentLang);
  wireLangToggle();
  // Notify pages that depend on t() for dynamic rendering (e.g. directory cards)
  window.dispatchEvent(new CustomEvent('esrf:langchange', { detail: { lang: _currentLang, initial: true } }));
  if (_readyResolve) { _readyResolve(_currentLang); _readyResolve = null; }
}

// Auto-init on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initI18n);
} else {
  initI18n();
}

// Export for use in other scripts
window.esrfI18n = {
  t, switchLang, initI18n, LANGS,
  getCurrentLang: () => _currentLang,
  applyTranslations,
  ready: _readyPromise,
};
