/* ════════════════════════════════════════════════════════════════
   ESRF.net — GDPR Cookie Consent + AdSense activator
   ════════════════════════════════════════════════════════════════
   • Shows a minimal consent banner on first visit
   • Stores choice in localStorage (no cookies for consent itself)
   • AdSense loader is placed statically in <head> with pauseAdRequests = 1
   • This script only *activates* ads (pauseAdRequests = 0) after consent
   • Respects ad-blocker gracefully (hides empty ad slots)
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const STORAGE_KEY = 'esrf_ad_consent';

  function getConsent() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }
  function setConsent(value) {
    try { localStorage.setItem(STORAGE_KEY, value); } catch (e) {}
  }

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

    if (window.esrfI18n && typeof window.esrfI18n.applyTranslations === 'function') {
      window.esrfI18n.applyTranslations();
    }

    document.getElementById('consent-accept').addEventListener('click', function () {
      setConsent('granted');
      banner.classList.add('consent-hide');
      setTimeout(function () { banner.remove(); }, 400);
      activateAds();
    });

    document.getElementById('consent-decline').addEventListener('click', function () {
      setConsent('denied');
      banner.classList.add('consent-hide');
      setTimeout(function () { banner.remove(); }, 400);
      hideAdSlots();
    });
  }

  /* AdSense loader is already in <head> with pauseAdRequests=1.
     This function flips the switch and fires the ad pushes. */
  function activateAds() {
    window.gtag && window.gtag('consent', 'update', {
      ad_user_data: 'granted',
      ad_personalization: 'granted',
      ad_storage: 'granted',
    });

    (window.adsbygoogle = window.adsbygoogle || []).pauseAdRequests = 0;

    document.querySelectorAll('ins.adsbygoogle').forEach(function () {
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
    });

    setTimeout(function () {
      document.querySelectorAll('.esrf-ad-wrap').forEach(function (wrap) {
        var ins = wrap.querySelector('ins.adsbygoogle');
        if (ins && (!ins.dataset.adStatus || ins.dataset.adStatus === 'unfilled')) {
          wrap.style.display = 'none';
        }
      });
    }, 4000);
  }

  function hideAdSlots() {
    document.querySelectorAll('.esrf-ad-wrap').forEach(function (el) {
      el.style.display = 'none';
    });
  }

  /* Google consent mode defaults (before AdSense activates) */
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

  function init() {
    var consent = getConsent();
    if (consent === 'granted') {
      activateAds();
    } else if (consent === 'denied') {
      hideAdSlots();
    } else {
      showBanner();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
