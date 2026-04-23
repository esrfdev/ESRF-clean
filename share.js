/* ═══════════════════════════════════════════════════════════════════════════
   share.js — Social share + light copy-protection for ESRF.net
   ───────────────────────────────────────────────────────────────────────────
   Responsibilities
   1. Render a social share bar wherever a <div data-esrf-share> is placed,
      and auto-insert one on article-style pages that have none.
   2. Render a row of social-follow icons inside every footer (<footer.foot>).
   3. Apply light copy-friction on public content areas (not inputs/forms/links).
      This is deterrence, not security — we keep text selectable on interactive
      elements and never break accessibility.

   Networks: LinkedIn, X/Twitter, Facebook, WhatsApp, Email, Copy-link, Native.
   ═══════════════════════════════════════════════════════════════════════════ */

(function(){
  'use strict';

  // ── ESRF official social handles (follow links in footer) ────────────────
  const ESRF_SOCIALS = {
    linkedin: 'https://www.linkedin.com/company/esrf-net',
    x:        'https://x.com/esrf_net',
    facebook: 'https://www.facebook.com/esrf.net',
    youtube:  'https://www.youtube.com/@esrf-net',
    mastodon: 'https://mastodon.social/@esrfnet',
    rss:      '/news.html'
  };

  // ── SVG icons (inline, currentColor) ─────────────────────────────────────
  const ICONS = {
    linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.11 1 2.5 1s2.48 1.12 2.48 2.5zM.22 8h4.56v14H.22V8zm7.5 0h4.37v1.92h.06c.61-1.15 2.1-2.37 4.32-2.37 4.62 0 5.47 3.04 5.47 6.99V22h-4.56v-6.2c0-1.48-.03-3.38-2.06-3.38-2.07 0-2.38 1.62-2.38 3.27V22H7.72V8z"/></svg>',
    x:        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M18.244 2H21.5l-7.5 8.574L22.5 22h-6.828l-5.348-6.99L4.2 22H.94l8.02-9.164L.5 2h7l4.836 6.39L18.244 2zm-2.4 18h1.88L6.26 4H4.24l11.604 16z"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M22 12.07C22 6.51 17.52 2 12 2S2 6.51 2 12.07c0 5.02 3.66 9.18 8.44 9.93v-7.02H7.9v-2.91h2.54V9.84c0-2.52 1.5-3.91 3.78-3.91 1.1 0 2.24.2 2.24.2v2.48h-1.26c-1.24 0-1.63.77-1.63 1.57v1.88h2.77l-.44 2.91h-2.33V22c4.78-.75 8.44-4.91 8.44-9.93z"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17.5 14.38c-.28-.14-1.66-.82-1.92-.91-.26-.1-.44-.14-.63.14-.19.28-.72.91-.88 1.1-.16.19-.33.21-.6.07-.28-.14-1.18-.44-2.25-1.39-.83-.74-1.39-1.66-1.55-1.94-.16-.28-.02-.43.12-.57.13-.13.28-.33.42-.5.14-.16.19-.28.28-.47.09-.19.05-.35-.02-.49-.07-.14-.63-1.52-.86-2.08-.23-.55-.46-.47-.63-.48h-.54c-.19 0-.49.07-.75.35-.26.28-.98.96-.98 2.34 0 1.38 1 2.72 1.14 2.91.14.19 1.97 3.01 4.78 4.22.67.29 1.19.46 1.6.59.67.21 1.28.18 1.77.11.54-.08 1.66-.68 1.9-1.33.24-.66.24-1.22.16-1.33-.07-.11-.26-.18-.54-.32zM12 2C6.48 2 2 6.48 2 12c0 1.76.46 3.42 1.27 4.87L2 22l5.24-1.37c1.4.77 3 1.2 4.76 1.2 5.52 0 10-4.48 10-10S17.52 2 12 2zm0 18.09c-1.56 0-3.02-.41-4.28-1.13l-.3-.18-3.12.82.83-3.04-.2-.31c-.8-1.28-1.26-2.79-1.26-4.43 0-4.45 3.62-8.07 8.08-8.07 4.45 0 8.08 3.62 8.08 8.07 0 4.45-3.63 8.08-8.08 8.08z"/></svg>',
    email:    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4.24-8 4.99-8-4.99V6l8 4.99L20 6v2.24z"/></svg>',
    link:     '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M10.59 13.41a1 1 0 0 0 1.41 0l3-3a3 3 0 1 0-4.24-4.24l-1.5 1.5a1 1 0 1 0 1.41 1.41l1.5-1.5a1 1 0 1 1 1.41 1.41l-3 3a1 1 0 0 0 0 1.42zm2.83-2.82a1 1 0 0 0-1.41 0l-3 3a3 3 0 1 0 4.24 4.24l1.5-1.5a1 1 0 1 0-1.41-1.41l-1.5 1.5a1 1 0 1 1-1.41-1.41l3-3a1 1 0 0 0 0-1.42z"/></svg>',
    share:    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>',
    youtube:  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.6 15.6V8.4L15.8 12l-6.2 3.6z"/></svg>',
    mastodon: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M21.58 13.91c-.3 1.52-2.66 3.18-5.36 3.5-1.41.17-2.8.32-4.28.25-2.42-.1-4.33-.57-4.33-.57 0 .23.02.46.04.68.31 2.39 2.37 2.53 4.32 2.6 1.97.07 3.72-.48 3.72-.48l.08 1.78s-1.37.74-3.82.87c-1.35.08-3.03-.03-5-.55C2.7 20.85.95 16.2.68 11.48c-.08-1.4-.1-2.73-.1-3.83 0-4.85 3.18-6.27 3.18-6.27C5.36.7 8.11.42 10.97.4h.07c2.86.02 5.62.3 7.22 1 0 0 3.18 1.4 3.18 6.26 0 0 .04 3.58-.44 6.26zM18.2 8v6.3h-2.5V8.18c0-1.28-.54-1.93-1.62-1.93-1.19 0-1.78.77-1.78 2.29v3.32h-2.48V8.54c0-1.52-.6-2.29-1.79-2.29-1.08 0-1.62.65-1.62 1.93V14.3H3.9V8c0-1.28.33-2.3.98-3.05.67-.75 1.54-1.13 2.64-1.13 1.26 0 2.22.48 2.85 1.45L11 6.27l.61-1c.63-.97 1.6-1.45 2.86-1.45 1.08 0 1.96.38 2.63 1.13.65.75.98 1.77.98 3.05z"/></svg>',
    rss:      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18A2.18 2.18 0 0 1 6.18 20 2.18 2.18 0 0 1 4 17.82a2.18 2.18 0 0 1 2.18-2.18zM4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44zm0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1z"/></svg>'
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const absoluteUrl = (() => {
    try { return window.location.href.split('#')[0]; }
    catch(e){ return ''; }
  })();

  const pageTitle = (() => {
    const og = document.querySelector('meta[property="og:title"]');
    if (og && og.content) return og.content;
    return document.title || 'ESRF.net';
  })();

  const pageDescription = (() => {
    const og = document.querySelector('meta[property="og:description"]');
    if (og && og.content) return og.content;
    const d = document.querySelector('meta[name="description"]');
    return d ? d.content : '';
  })();

  function enc(s){ return encodeURIComponent(s || ''); }

  function buildShareUrls(url, title, text){
    const u = enc(url), t = enc(title), x = enc(text || title);
    return {
      linkedin: 'https://www.linkedin.com/sharing/share-offsite/?url=' + u,
      x:        'https://twitter.com/intent/tweet?url=' + u + '&text=' + t,
      facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + u,
      whatsapp: 'https://wa.me/?text=' + t + '%20' + u,
      email:    'mailto:?subject=' + t + '&body=' + x + '%0A%0A' + u
    };
  }

  // Escape for HTML attributes
  function esc(s){
    return String(s || '').replace(/[&<>"']/g, c => (
      {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
    ));
  }

  // Translation helper (graceful fallback if i18n not loaded)
  function tr(key, fallback){
    if (typeof window.t === 'function') {
      try { return window.t(key, fallback); } catch(e){}
    }
    return fallback;
  }

  // ── Share bar rendering ───────────────────────────────────────────────────
  function renderShareBar(host){
    if (!host || host.dataset.esrfShareMounted === '1') return;
    host.dataset.esrfShareMounted = '1';

    const url   = host.getAttribute('data-url')   || absoluteUrl;
    const title = host.getAttribute('data-title') || pageTitle;
    const text  = host.getAttribute('data-text')  || pageDescription;
    const label = host.getAttribute('data-label') || tr('share.label', 'Share');

    const urls = buildShareUrls(url, title, text);
    const hasNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

    const btn = (network, href, name) =>
      `<a class="esrf-share-btn esrf-share-${network}" href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(tr('share.on_' + network, 'Share on ' + name))}" data-network="${network}">
         <span class="esrf-share-icon" aria-hidden="true">${ICONS[network]}</span>
         <span class="esrf-share-name">${esc(name)}</span>
       </a>`;

    host.classList.add('esrf-share');
    host.setAttribute('role', 'group');
    host.setAttribute('aria-label', label);

    host.innerHTML =
      `<span class="esrf-share-label" aria-hidden="true">${esc(label)}</span>
       <div class="esrf-share-buttons">` +
         btn('linkedin', urls.linkedin, 'LinkedIn') +
         btn('x',        urls.x,        'X') +
         btn('facebook', urls.facebook, 'Facebook') +
         btn('whatsapp', urls.whatsapp, 'WhatsApp') +
         btn('email',    urls.email,    'Email') +
         `<button type="button" class="esrf-share-btn esrf-share-copy" data-network="copy" aria-label="${esc(tr('share.copy_link', 'Copy link'))}">
            <span class="esrf-share-icon" aria-hidden="true">${ICONS.link}</span>
            <span class="esrf-share-name">${esc(tr('share.copy', 'Copy'))}</span>
          </button>` +
         (hasNative ?
          `<button type="button" class="esrf-share-btn esrf-share-native" data-network="native" aria-label="${esc(tr('share.more', 'More sharing options'))}">
            <span class="esrf-share-icon" aria-hidden="true">${ICONS.share}</span>
            <span class="esrf-share-name">${esc(tr('share.more_short', 'More'))}</span>
          </button>` : '') +
      '</div>';

    // Wire buttons
    host.addEventListener('click', async (e) => {
      const copyBtn = e.target.closest('.esrf-share-copy');
      const nativeBtn = e.target.closest('.esrf-share-native');
      if (copyBtn){
        e.preventDefault();
        try {
          await navigator.clipboard.writeText(url);
          flashCopied(copyBtn);
        } catch(err){
          // Fallback for older browsers
          const ta = document.createElement('textarea');
          ta.value = url; ta.setAttribute('readonly', '');
          ta.style.position = 'absolute'; ta.style.left = '-9999px';
          document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); flashCopied(copyBtn); }
          catch(e2){}
          document.body.removeChild(ta);
        }
      } else if (nativeBtn && navigator.share){
        e.preventDefault();
        try {
          await navigator.share({ title, text, url });
        } catch(err){ /* user cancelled */ }
      }
    });
  }

  function flashCopied(btn){
    const nameEl = btn.querySelector('.esrf-share-name');
    if (!nameEl) return;
    const orig = nameEl.textContent;
    nameEl.textContent = tr('share.copied', 'Copied!');
    btn.classList.add('esrf-share-copied');
    setTimeout(() => {
      nameEl.textContent = orig;
      btn.classList.remove('esrf-share-copied');
    }, 1800);
  }

  // Auto-insert a share bar on article/editorial pages if none exists
  function autoInsertShareBar(){
    if (document.querySelector('[data-esrf-share]')) return;
    // Editorial / article-style pages
    const article = document.querySelector('article.ed-article, article.news-article, .phero--editorial + article, .phero + article');
    if (article){
      // Append a share bar after the intro (before the references if present)
      const refs = article.querySelector('.ed-refs');
      const bar = document.createElement('div');
      bar.setAttribute('data-esrf-share', '');
      bar.setAttribute('data-placement', 'article');
      if (refs) article.insertBefore(bar, refs);
      else article.appendChild(bar);
      return;
    }
    // Hero-based pages (home, dispatch, etc.) — tuck under the hero/phero
    const hero = document.querySelector('.phero .phero-inner');
    if (hero){
      const bar = document.createElement('div');
      bar.setAttribute('data-esrf-share', '');
      bar.setAttribute('data-placement', 'hero');
      hero.appendChild(bar);
    }
  }

  // ── Footer social icons ──────────────────────────────────────────────────
  function renderFooterSocials(){
    document.querySelectorAll('footer.foot').forEach(foot => {
      if (foot.querySelector('.foot-socials')) return;

      const row = document.createElement('div');
      row.className = 'foot-socials';
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', tr('footer.follow_us', 'Follow ESRF.net'));
      row.innerHTML =
        '<span class="foot-socials-label">' + esc(tr('footer.follow_us', 'Follow')) + '</span>' +
        '<div class="foot-socials-row">' +
        [
          ['linkedin', ESRF_SOCIALS.linkedin, 'LinkedIn'],
          ['x',        ESRF_SOCIALS.x,        'X (Twitter)'],
          ['facebook', ESRF_SOCIALS.facebook, 'Facebook'],
          ['youtube',  ESRF_SOCIALS.youtube,  'YouTube'],
          ['mastodon', ESRF_SOCIALS.mastodon, 'Mastodon'],
          ['rss',      ESRF_SOCIALS.rss,      'Dispatch (RSS)']
        ].map(([net, href, name]) =>
          `<a class="foot-social foot-social-${net}" href="${esc(href)}" target="_blank" rel="noopener noreferrer me" aria-label="${esc(name)}">
             <span aria-hidden="true">${ICONS[net]}</span>
           </a>`
        ).join('') +
        '</div>';

      // Insert above the foot-bar if present, else at the end
      const bar = foot.querySelector('.foot-bar');
      if (bar) foot.insertBefore(row, bar);
      else foot.appendChild(row);
    });
  }

  // ── Copy friction (deterrence only) ──────────────────────────────────────
  // Guards: never applied to form fields, links, buttons, or anything marked
  // .esrf-selectable. Keyboard users and screen readers are NOT blocked.
  function isInteractive(el){
    if (!el) return false;
    if (el.closest('input, textarea, select, button, a, [contenteditable="true"], .esrf-selectable, .esrf-share, .mast, .foot, [data-esrf-share], .search-input, .search-result')) return true;
    return false;
  }

  function applyCopyFriction(){
    // Mark body so CSS can disable user-select on public content only
    document.body.classList.add('esrf-copy-protected');

    // Block context menu on images only (so casual "Save image as" needs effort).
    // We keep text right-click working, because power users need it.
    document.addEventListener('contextmenu', (e) => {
      const t = e.target;
      if (t && t.tagName === 'IMG' && !t.closest('.esrf-selectable')) {
        e.preventDefault();
      }
    });

    // Block drag of images (prevents drag-to-save on mobile/desktop)
    document.addEventListener('dragstart', (e) => {
      const t = e.target;
      if (t && t.tagName === 'IMG' && !t.closest('.esrf-selectable')) {
        e.preventDefault();
      }
    });

    // When the user copies, append a short attribution line. This is a gentle
    // "hey, consider sharing instead" nudge — it does not break copy.
    document.addEventListener('copy', (e) => {
      try {
        const sel = window.getSelection && window.getSelection();
        if (!sel || sel.isCollapsed) return;
        // Don't modify copies from form fields or interactive elements
        const anchor = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
        if (isInteractive(anchor)) return;
        const text = sel.toString();
        if (!text || text.length < 40) return; // allow short snippets untouched
        const attribution = '\n\n— ' + tr('share.attribution', 'Source: ESRF.net — ') + (window.location.href);
        const html = '<p>' + (text.replace(/</g,'&lt;').replace(/>/g,'&gt;')) + '</p><p><em>' + attribution + '</em></p>';
        if (e.clipboardData && e.clipboardData.setData){
          e.clipboardData.setData('text/plain', text + attribution);
          e.clipboardData.setData('text/html',  html);
          e.preventDefault();
        }
      } catch(err){ /* ignore */ }
    });
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  function boot(){
    autoInsertShareBar();
    document.querySelectorAll('[data-esrf-share]').forEach(renderShareBar);
    renderFooterSocials();
    applyCopyFriction();

    // Re-render on language change so share labels stay localised
    window.addEventListener('esrf:langchange', () => {
      document.querySelectorAll('[data-esrf-share]').forEach(host => {
        host.dataset.esrfShareMounted = '';
        host.innerHTML = '';
        renderShareBar(host);
      });
    });
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Expose for manual mounting
  window.ESRFShare = { mount: renderShareBar, icons: ICONS };
})();
