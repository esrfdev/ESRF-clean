/* ════════════════════════════════════════════════════════════════
   ESRF.net — Lightweight client-side site search
   - Injects a search trigger into the masthead (desktop + mobile)
   - Opens an accessible overlay with grouped results
   - Indexes: static pages, countries, organisations, dispatch,
     events. Index is built lazily on first open and cached in
     memory per page load.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Resolve paths relative to current depth (country pages live in /countries/XX/)
  const isSubDir = window.location.pathname.includes('/countries/');
  const base = isSubDir ? '../../' : '';

  // ── Static page entries (title, url, kind)
  // Titles are plain fallbacks; i18n titles are applied if nav.* keys resolve.
  const STATIC_PAGES = [
    { title: 'Home',                url: 'index.html',        kind: 'page', i18n: null },
    { title: 'Foundation',          url: 'about.html',        kind: 'page', i18n: 'nav.foundation' },
    { title: 'Directory',           url: 'directory.html',    kind: 'page', i18n: 'nav.directory' },
    { title: 'Atlas',               url: 'map.html',          kind: 'page', i18n: 'nav.atlas' },
    { title: 'Analytics',           url: 'analytics.html',    kind: 'page', i18n: 'nav.analytics' },
    { title: 'Dispatch',            url: 'news.html',         kind: 'page', i18n: 'nav.dispatch' },
    { title: 'Events',              url: 'events.html',       kind: 'page' },
    { title: 'Contribute',          url: 'fund.html',         kind: 'page', i18n: 'nav.fund' },
    { title: 'Sponsor',             url: 'sponsor.html',      kind: 'page' },
    { title: 'Claim your listing',  url: 'request-listing.html', kind: 'page', i18n: 'nav.request_listing' },
    { title: 'Submit an event',     url: 'submit-event.html', kind: 'page' },
    { title: 'Submit a signal',     url: 'submit-news.html',  kind: 'page' },
    { title: 'Privacy',             url: 'privacy.html',      kind: 'page' },
    { title: 'Terms',               url: 'terms.html',        kind: 'page' },
    { title: 'Responsible disclosure', url: 'responsible-disclosure.html', kind: 'page' },
    { title: 'Editorial — Oil shortage 2026', url: 'editorial-oil-shortage-2026.html', kind: 'page' },
  ];

  // ── Canonical list of country slugs (matches countries/<slug>/index.html)
  const COUNTRY_SLUGS = [
    ['austria','Austria'],['belgium','Belgium'],['bulgaria','Bulgaria'],['croatia','Croatia'],
    ['cyprus','Cyprus'],['czech-republic','Czech Republic'],['denmark','Denmark'],['estonia','Estonia'],
    ['finland','Finland'],['france','France'],['germany','Germany'],['greece','Greece'],
    ['hungary','Hungary'],['ireland','Ireland'],['italy','Italy'],['latvia','Latvia'],
    ['lithuania','Lithuania'],['luxembourg','Luxembourg'],['malta','Malta'],['netherlands','Netherlands'],
    ['norway','Norway'],['poland','Poland'],['portugal','Portugal'],['romania','Romania'],
    ['slovakia','Slovakia'],['slovenia','Slovenia'],['spain','Spain'],['sweden','Sweden'],
    ['switzerland','Switzerland'],['united-kingdom','United Kingdom'],
  ];

  // Sector keywords (derived from companies.sector_normalized values, used for quick chips)
  const SECTOR_FALLBACKS = [
    'Digital Infrastructure & Cybersecurity',
    'Critical Infrastructure',
    'Public Safety & Emergency Services',
    'Defence & Security Industry',
    'Energy & Climate Resilience',
    'Transport & Logistics',
    'Water & Food Systems',
    'Health & Biomedical Resilience',
    'Finance & Economic Resilience',
    'Governance & Civil Society',
  ];

  // ── State
  let _index = null;      // Array<Entry>  once built
  let _buildPromise = null;
  let _overlay = null;
  let _inputEl = null;
  let _resultsEl = null;
  let _statusEl = null;
  let _lastFocused = null;

  // ── Utilities
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  }
  function normalize(s) {
    return String(s || '').toLowerCase()
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  }
  function tSafe(key, fallback) {
    try {
      const fn = window.esrfI18n && window.esrfI18n.t;
      if (typeof fn === 'function') {
        const v = fn(key, fallback);
        if (v && v !== key) return v;
      }
    } catch (e) {}
    return fallback;
  }
  function applyI18n() {
    try {
      const fn = window.esrfI18n && window.esrfI18n.applyTranslations;
      if (typeof fn === 'function') fn();
    } catch (e) {}
  }

  // ── Index build
  async function fetchJSON(path) {
    try {
      const r = await fetch(base + path);
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (e) {
      return null;
    }
  }

  async function buildIndex() {
    if (_index) return _index;
    if (_buildPromise) return _buildPromise;

    _buildPromise = (async () => {
      const entries = [];

      // Static pages
      STATIC_PAGES.forEach(p => {
        const title = p.i18n ? tSafe(p.i18n, p.title) : p.title;
        entries.push({
          kind: 'page',
          title,
          subtitle: p.url,
          url: base + p.url,
          haystack: normalize(title + ' ' + p.url),
        });
      });

      // Countries
      COUNTRY_SLUGS.forEach(([slug, name]) => {
        entries.push({
          kind: 'country',
          title: name,
          subtitle: 'countries/' + slug + '/',
          url: base + 'countries/' + slug + '/',
          haystack: normalize(name + ' ' + slug),
        });
      });

      // Sector chips (link into directory with sector filter via hash fallback)
      SECTOR_FALLBACKS.forEach(sec => {
        entries.push({
          kind: 'sector',
          title: sec,
          subtitle: 'Directory · sector',
          url: base + 'directory.html#sector=' + encodeURIComponent(sec),
          haystack: normalize(sec),
        });
      });

      // Parallel fetches for heavier sources
      const [companies, news, events] = await Promise.all([
        fetchJSON('companies_extracted.json'),
        fetchJSON('news-data.json'),
        fetchJSON('events.json'),
      ]);

      if (Array.isArray(companies)) {
        companies.forEach(c => {
          const name = c.name || '';
          const country = c.country_name_en || c.country || '';
          const city = c.city || '';
          const sector = c.sector_normalized || '';
          entries.push({
            kind: 'org',
            title: name,
            subtitle: [sector, city, country].filter(Boolean).join(' · '),
            url: c.website || (base + 'directory.html'),
            external: !!c.website,
            haystack: normalize([name, sector, city, country, c.description_en].join(' ')),
          });
        });
      }

      if (news && Array.isArray(news.articles)) {
        news.articles.forEach(a => {
          const title = a.title || '';
          const org = a.organisation || '';
          const country = a.country || '';
          // Internal editorial vs external source URL
          const url = a.url || '';
          const isInternal = url && !/^https?:\/\//i.test(url);
          entries.push({
            kind: 'dispatch',
            title,
            subtitle: [org, country].filter(Boolean).join(' · '),
            url: isInternal ? base + url : url,
            external: !isInternal,
            haystack: normalize([title, org, country, a.snippet, a.source].join(' ')),
          });
        });
      }

      if (Array.isArray(events)) {
        events.forEach(e => {
          const title = e.event_name || '';
          const subtitle = [e.city, e.country, e.dates].filter(Boolean).join(' · ');
          entries.push({
            kind: 'event',
            title,
            subtitle,
            url: e.url || (base + 'events.html'),
            external: !!e.url,
            haystack: normalize([title, e.city, e.country, e.organiser, e.dates, (e.sector_relevance || []).join(' ')].join(' ')),
          });
        });
      }

      _index = entries;
      return entries;
    })();

    return _buildPromise;
  }

  // ── Search
  function runSearch(query) {
    const q = normalize(query).trim();
    if (!q || !_index) return { groups: [], total: 0 };

    const tokens = q.split(/\s+/).filter(Boolean);
    const scored = [];
    const limitPerGroup = 12;

    for (let i = 0; i < _index.length; i++) {
      const e = _index[i];
      let score = 0;
      let matched = true;
      for (let j = 0; j < tokens.length; j++) {
        const tok = tokens[j];
        const idx = e.haystack.indexOf(tok);
        if (idx === -1) { matched = false; break; }
        score += 1;
        // Title match bonus
        if (normalize(e.title).indexOf(tok) !== -1) score += 2;
        if (normalize(e.title).startsWith(tok)) score += 2;
      }
      if (matched) scored.push({ e, score });
    }

    scored.sort((a, b) => b.score - a.score);

    // Group by kind
    const ORDER = ['page', 'country', 'sector', 'org', 'dispatch', 'event'];
    const buckets = Object.fromEntries(ORDER.map(k => [k, []]));
    for (const { e } of scored) {
      const arr = buckets[e.kind];
      if (arr && arr.length < limitPerGroup) arr.push(e);
    }
    const groups = ORDER.map(k => ({ kind: k, items: buckets[k] })).filter(g => g.items.length);
    const total = groups.reduce((a, g) => a + g.items.length, 0);
    return { groups, total };
  }

  // ── Rendering
  const KIND_LABEL = {
    page:     ['Pages',         'search.group.pages'],
    country:  ['Countries',     'search.group.countries'],
    sector:   ['Sectors',       'search.group.sectors'],
    org:      ['Organisations', 'search.group.organisations'],
    dispatch: ['Dispatch',      'search.group.dispatch'],
    event:    ['Events',        'search.group.events'],
  };

  function renderResults(query) {
    const { groups, total } = runSearch(query);
    if (!query.trim()) {
      _resultsEl.innerHTML = '';
      _statusEl.textContent = tSafe('search.hint', 'Start typing to search pages, organisations, countries, dispatch and events.');
      return;
    }
    if (total === 0) {
      _resultsEl.innerHTML = '';
      _statusEl.textContent = tSafe('search.no_results', 'No matches found.');
      return;
    }
    _statusEl.textContent = (tSafe('search.results_count', '{n} results').replace('{n}', String(total)));

    let html = '';
    let globalIdx = 0;
    groups.forEach(g => {
      const [fallback, key] = KIND_LABEL[g.kind];
      html += `<div class="search-group"><h3 class="search-group-title">${esc(tSafe(key, fallback))}</h3><ul class="search-group-list" role="list">`;
      g.items.forEach(it => {
        const extAttr = it.external ? ' target="_blank" rel="noopener"' : '';
        html += `<li><a class="search-result" role="option" data-idx="${globalIdx++}" href="${esc(it.url)}"${extAttr}>`;
        html += `<span class="search-result-title">${esc(it.title)}</span>`;
        if (it.subtitle) html += `<span class="search-result-sub">${esc(it.subtitle)}</span>`;
        if (it.external) html += `<span class="search-result-ext" aria-hidden="true">↗</span>`;
        html += `</a></li>`;
      });
      html += `</ul></div>`;
    });
    _resultsEl.innerHTML = html;
  }

  // ── Overlay
  function buildOverlay() {
    if (_overlay) return _overlay;
    const wrap = document.createElement('div');
    wrap.id = 'search-overlay';
    wrap.className = 'search-overlay';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'search-title');
    wrap.hidden = true;
    wrap.innerHTML = `
      <div class="search-backdrop" data-search-close></div>
      <div class="search-panel" role="document">
        <div class="search-header">
          <label for="search-input" id="search-title" class="search-title">
            <span data-i18n="search.title">Search</span>
          </label>
          <button class="search-close" type="button" aria-label="Close search" data-search-close>✕</button>
        </div>
        <div class="search-input-row">
          <span class="search-icon" aria-hidden="true">⌕</span>
          <input
            id="search-input"
            type="search"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            role="combobox"
            aria-expanded="true"
            aria-controls="search-results"
            aria-autocomplete="list"
            data-i18n-placeholder="search.placeholder"
            placeholder="Search pages, organisations, countries…"
          />
        </div>
        <p class="search-status" id="search-status" aria-live="polite"></p>
        <div class="search-results" id="search-results" role="listbox" aria-label="Search results"></div>
        <div class="search-footer">
          <span><kbd>↵</kbd> <span data-i18n="search.kbd.open">open</span></span>
          <span><kbd>Esc</kbd> <span data-i18n="search.kbd.close">close</span></span>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    _overlay = wrap;
    _inputEl = wrap.querySelector('#search-input');
    _resultsEl = wrap.querySelector('#search-results');
    _statusEl = wrap.querySelector('#search-status');

    // Wire close
    wrap.querySelectorAll('[data-search-close]').forEach(el => {
      el.addEventListener('click', closeSearch);
    });

    // Input
    let debounce;
    _inputEl.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => renderResults(_inputEl.value), 80);
    });

    // Keyboard: Esc, arrow navigation, Enter
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSearch();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = Array.from(_resultsEl.querySelectorAll('.search-result'));
        if (!items.length) return;
        e.preventDefault();
        const active = document.activeElement;
        let i = items.indexOf(active);
        if (e.key === 'ArrowDown') i = i < 0 ? 0 : Math.min(items.length - 1, i + 1);
        else i = i <= 0 ? items.length - 1 : i - 1;
        items[i].focus();
      }
      if (e.key === 'Enter' && document.activeElement === _inputEl) {
        const first = _resultsEl.querySelector('.search-result');
        if (first) { e.preventDefault(); first.click(); }
      }
    });

    // Focus trap: when tabbing past last, loop to first
    wrap.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const focusables = wrap.querySelectorAll('input, button, a[href]');
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    });

    // Re-apply translations for newly added nodes (if i18n loaded)
    applyI18n();
    return wrap;
  }

  async function openSearch() {
    buildOverlay();
    _lastFocused = document.activeElement;
    _overlay.hidden = false;
    document.body.classList.add('search-open');
    // Translate any newly added data-i18n attrs
    applyI18n();
    _inputEl.value = '';
    _statusEl.textContent = tSafe('search.loading', 'Loading index…');
    _resultsEl.innerHTML = '';
    setTimeout(() => { try { _inputEl.focus(); } catch(e) {} }, 10);
    await buildIndex();
    renderResults(_inputEl.value);
  }

  function closeSearch() {
    if (!_overlay || _overlay.hidden) return;
    _overlay.hidden = true;
    document.body.classList.remove('search-open');
    if (_lastFocused && typeof _lastFocused.focus === 'function') {
      try { _lastFocused.focus(); } catch(e) {}
    }
  }

  // ── Nav triggers
  function iconSVG() {
    return '<svg class="search-btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
  }

  function injectTriggers() {
    document.querySelectorAll('.mast-inner').forEach(inner => {
      if (inner.querySelector('.search-trigger')) return;

      // Desktop compact icon trigger — placed before .lang-switch
      const desktopBtn = document.createElement('button');
      desktopBtn.type = 'button';
      desktopBtn.className = 'search-trigger search-trigger-desktop';
      desktopBtn.setAttribute('aria-label', tSafe('search.open', 'Open search'));
      desktopBtn.setAttribute('data-i18n-label', 'search.open');
      desktopBtn.innerHTML = iconSVG();
      desktopBtn.addEventListener('click', openSearch);

      const lang = inner.querySelector('.lang-switch');
      if (lang) inner.insertBefore(desktopBtn, lang);
      else inner.appendChild(desktopBtn);

      // Mobile: inject as first item inside .mast-nav so it's visible in hamburger
      const nav = inner.querySelector('.mast-nav');
      if (nav && !nav.querySelector('.search-trigger-mobile')) {
        const mobileBtn = document.createElement('button');
        mobileBtn.type = 'button';
        mobileBtn.className = 'search-trigger search-trigger-mobile';
        mobileBtn.innerHTML = iconSVG() + '<span data-i18n="search.title">' + esc(tSafe('search.title', 'Search')) + '</span>';
        mobileBtn.addEventListener('click', () => {
          // Close the mobile nav if open, then open search
          const mast = mobileBtn.closest('.mast');
          const navEl = mast && mast.querySelector('.mast-nav');
          const burger = mast && mast.querySelector('.mast-burger');
          if (navEl && navEl.classList.contains('open')) {
            navEl.classList.remove('open');
            mast.classList.remove('nav-open');
            if (burger) { burger.setAttribute('aria-expanded', 'false'); burger.textContent = '≡'; }
            document.body.style.overflow = '';
          }
          openSearch();
        });
        nav.insertBefore(mobileBtn, nav.firstChild);
      }
    });
  }

  // ── Global keyboard shortcut (Ctrl/Cmd+K) to open search
  function wireGlobalKeys() {
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        openSearch();
      }
      // "/" as shortcut when not typing in a field
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target && e.target.tagName || '').toLowerCase();
        const editable = e.target && e.target.isContentEditable;
        if (tag !== 'input' && tag !== 'textarea' && tag !== 'select' && !editable) {
          e.preventDefault();
          openSearch();
        }
      }
    });
  }

  // ── Re-render after language change
  function wireLangSync() {
    window.addEventListener('esrf:langchange', () => {
      // Update labels on trigger buttons
      document.querySelectorAll('.search-trigger-desktop').forEach(b => {
        b.setAttribute('aria-label', tSafe('search.open', 'Open search'));
      });
      document.querySelectorAll('.search-trigger-mobile').forEach(b => {
        const span = b.querySelector('span');
        if (span) span.textContent = tSafe('search.title', 'Search');
      });
      // Rebuild index so static page titles reflect new language
      _index = null;
      _buildPromise = null;
      if (_overlay && !_overlay.hidden) {
        buildIndex().then(() => renderResults(_inputEl ? _inputEl.value : ''));
      }
    });
  }

  function init() {
    injectTriggers();
    wireGlobalKeys();
    wireLangSync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for debugging / programmatic open
  window.esrfSearch = { open: openSearch, close: closeSearch };
})();
