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

  var STORAGE_KEY = 'esrf_ad_consent';
  var PUBLISHER_ID = 'ca-pub-9792236154813874';

  /* ── Read stored consent ── */
  function getConsent() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }
  function setConsent(value) {
    try { localStorage.setItem(STORAGE_KEY, value); } catch (e) { /* private mode */ }
  }

  /* ── Inject consent banner ── */
  function showBanner() {
    if (document.getElementById('esrf-consent')) return;

    var banner = document.createElement('div');
    banner.id = 'esrf-consent';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie consent');

    var inner = document.createElement('div');
    inner.className = 'consent-inner';

    var text = document.createElement('p');
    text.className = 'consent-text';
    text.setAttribute('data-i18n', 'consent.text');
    text.textContent = 'ESRF.net uses minimal advertising to support its mission. We use cookies for personalised ads. You can accept or decline. ';

    var privLink = document.createElement('a');
    privLink.href = 'privacy.html';
    privLink.setAttribute('data-i18n', 'consent.privacy_link');
    privLink.textContent = 'Privacy policy';
    text.appendChild(privLink);

    var actions = document.createElement('div');
    actions.className = 'consent-actions';

    var acceptBtn = document.createElement('button');
    acceptBtn.className = 'consent-btn consent-accept';
    acceptBtn.id = 'consent-accept';
    acceptBtn.setAttribute('data-i18n', 'consent.accept');
    acceptBtn.textContent = 'Accept';

    var declineBtn = document.createElement('button');
    declineBtn.className = 'consent-btn consent-decline';
    declineBtn.id = 'consent-decline';
    declineBtn.setAttribute('data-i18n', 'consent.decline');
    declineBtn.textContent = 'Decline';

    actions.appendChild(acceptBtn);
    actions.appendChild(declineBtn);
    inner.appendChild(text);
    inner.appendChild(actions);
    banner.appendChild(inner);
    document.body.appendChild(banner);

    /* Re-translate if i18n is loaded */
    if (window.esrfI18n && typeof window.esrfI18n.applyTranslations === 'function') {
      window.esrfI18n.applyTranslations();
    }

    function dismiss() {
      banner.classList.add('consent-hide');
      setTimeout(function () { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 400);
    }

    acceptBtn.addEventListener('click', function () {
      setConsent('granted');
      dismiss();
      loadAds();
    });

    declineBtn.addEventListener('click', function () {
      setConsent('denied');
      dismiss();
      hideAdSlots();
    });
  }

  /* ── Load Google AdSense ── */
  function loadAds() {
    if (document.getElementById('esrf-adsense-script')) return;

    /* Google tag consent mode — grant */
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', {
        ad_user_data: 'granted',
        ad_personalization: 'granted',
        ad_storage: 'granted'
      });
    }

    var s = document.createElement('script');
    s.id = 'esrf-adsense-script';
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + PUBLISHER_ID;
    document.head.appendChild(s);

    s.onload = function () {
      var slots = document.querySelectorAll('.adsbygoogle');
      for (var i = 0; i < slots.length; i++) {
        try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* */ }
      }
    };

    /* Fallback: hide unfilled containers after 4s */
    setTimeout(function () {
      var wraps = document.querySelectorAll('.esrf-ad-wrap');
      for (var i = 0; i < wraps.length; i++) {
        var ins = wraps[i].querySelector('ins.adsbygoogle');
        if (ins && (!ins.dataset.adStatus || ins.dataset.adStatus === 'unfilled')) {
          wraps[i].style.display = 'none';
        }
      }
    }, 4000);
  }

  /* ── Hide ad slots when consent is denied or ad-blocker active ── */
  function hideAdSlots() {
    var els = document.querySelectorAll('.esrf-ad-wrap');
    for (var i = 0; i < els.length; i++) {
      els[i].style.display = 'none';
    }
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
    wait_for_update: 500
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

  /* Run when DOM is ready */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
