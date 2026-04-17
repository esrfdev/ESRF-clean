/* ════════════════════════════════════════════════════════════════
   ESRF.net — GDPR Cookie Consent + AdSense loader
   ════════════════════════════════════════════════════════════════
   • Shows a minimal consent banner on first visit
   • Stores choice in localStorage (no cookies for consent itself)
   • Only loads Google AdSense when user explicitly consents
   • Respects ad-blocker gracefully (hides empty ad slots)
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const STORAGE_KEY = 'esrf_ad_consent';
  const PUBLISHER_ID = 'ca-pub-9792236154813874'; // ← Replace with your AdSense publisher ID

  /* ── Read stored consent ── */
  function getConsent() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }
  function setConsent(value) {
    try { localStorage.setItem(STORAGE_KEY, value); } catch (e) { /* private mode */ }
  }

  /* ── i18n helper (falls back to English) ── */
  function ct(key, fallback) {
    if (window.t && typeof window.t === 'function') {
      const v = window.t(key, fallback);
      return (v === key) ? fallback : v;
    }
    return fallback;
  }

  /* ── Inject consent banner ── */
  function showBanner() {
    if (document.getElementById('esrf-consent')) return;

    const banner = document.createElement('div');
    banner.id = 'esrf-consent';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.innerHTML = `
      <div class="consent-inner">
        <p class="consent-text" data-i18n="consent.text">
          ESRF.net uses minimal advertising to support its mission.
          We use cookies for personalised ads. You can accept or decline.
          <a href="privacy.html" data-i18n="consent.privacy_link">Privacy policy</a>
        </p>
        <div class="consent-actions">
          <button class="consent-btn consent-accept" id="consent-accept" data-i18n="consent.accept">Accept</button>
          <button class="consent-btn consent-decline" id="consent-decline" data-i18n="consent.decline">Decline</button>
        </div>
      </div>
    `;
    document.body.appendChild(banner);

    // Re-translate if i18n is loaded
    if (window.esrfI18n && typeof window.esrfI18n.applyTranslations === 'function') {
      window.esrfI18n.applyTranslations();
    }

    document.getElementById('consent-accept').addEventListener('click', function () {
      setConsent('granted');
      banner.classList.add('consent-hide');
      setTimeout(function () { banner.remove(); }, 400);
      loadAds();
    });

    document.getElementById('consent-decline').addEventListener('click', function () {
      setConsent('denied');
      banner.classList.add('consent-hide');
      setTimeout(function () { banner.remove(); }, 400);
      hideAdSlots();
    });
  }

  /* ── Load Google AdSense ── */
  function loadAds() {
    if (document.getElementById('esrf-adsense-script')) return;

    // Google tag consent mode — grant
    window.gtag && window.gtag('consent', 'update', {
      ad_user_data: 'granted',
      ad_personalization: 'granted',
      ad_storage: 'granted',
    });

    var s = document.createElement('script');
    s.id = 'esrf-adsense-script';
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + PUBLISHER_ID;
    document.head.appendChild(s);

    s.onload = function () {
      // Push all ad slots on the page
      document.querySelectorAll('.adsbygoogle').forEach(function () {
        try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* */ }
      });
    };

    // Fallback: if ads don't fill, hide the containers after 4 seconds
    setTimeout(function () {
      document.querySelectorAll('.esrf-ad-wrap').forEach(function (wrap) {
        var ins = wrap.querySelector('ins.adsbygoogle');
        if (ins && (!ins.dataset.adStatus || ins.dataset.adStatus === 'unfilled')) {
          wrap.style.display = 'none';
        }
      });
    }, 4000);
  }

  /* ── Hide ad slots when consent is denied or ad-blocker active ── */
  function hideAdSlots() {
    document.querySelectorAll('.esrf-ad-wrap').forEach(function (el) {
      el.style.display = 'none';
    });
  }

  /* ── Google consent mode defaults (before AdSense loads) ── */
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('consent', 'default', {
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    ad_storage: 'denied',
    analytics_storage: 'denied',
    wait_for_update: 500,
  });

  /* ── Init ── */
  function init() {
    var consent = getConsent();
    if (consent === 'granted') {
      loadAds();
    } else if (consent === 'denied') {
      hideAdSlots();
    } else {
      showBanner();
    }
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
