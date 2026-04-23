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

/* ── Public t() function ── */
function t(key, fallback) {
  const val = getNestedKey(_strings, key);
  if (val !== null && val !== undefined) return val;
  if (fallback !== undefined) return fallback;
  return key;
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

  // After every translation pass, ask counters.js (if loaded) to
  // resolve any {total}/{countries}/{sectors} tokens the translations
  // just injected and to refill any [data-count] elements. This
  // eliminates the race where i18n finishes before counters' langchange
  // handler runs and tokens would otherwise remain visible as literal
  // "{total}" / "{countries}" strings on the rendered page.
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

/* ── Main init ── */
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
}

// Auto-init on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initI18n);
} else {
  initI18n();
}

// Export for use in other scripts
window.esrfI18n = { t, switchLang, initI18n, LANGS, getCurrentLang: () => _currentLang, applyTranslations };
