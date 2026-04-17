/* ════════════════════════════════════════════════════════════════
   ESRF.net — AdSense activator (Google CMP in charge of consent UI)
   ════════════════════════════════════════════════════════════════
   • Google's own CMP (Privacy & messaging in AdSense) renders the GDPR dialog
   • AdSense loader is placed statically in <head> with pauseAdRequests = 1
   • This script listens to IAB TCF v2.2 signals from the Google CMP
   • When consent is granted (or outside EER/TCF scope) it unpauses and pushes ads
   • When consent is denied it hides empty ad slots gracefully
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var activated = false;

  function activateAds() {
    if (activated) return;
    activated = true;

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

  /* Check if TCData signals full consent for Google (vendor 755) and purposes 1-4.
     This is a pragmatic check; AdSense itself will re-check TC string server-side. */
  function hasAdsConsent(tcData) {
    if (!tcData) return false;
    if (tcData.gdprApplies === false) return true; // outside EER
    var p = tcData.purpose && tcData.purpose.consents;
    if (!p) return false;
    return !!(p[1] && p[2] && p[3] && p[4]);
  }

  /* Wait for Google CMP (__tcfapi) to initialise and react to consent events. */
  function waitForCMP() {
    var timeout = setTimeout(function () {
      // No TCF API detected within 3s: likely outside EER or CMP failed to load.
      // Let AdSense decide — unpause so Google CMP (if any) can still show its own UI.
      activateAds();
    }, 3000);

    function onTcData(tcData, success) {
      if (!success || !tcData) return;
      if (tcData.eventStatus === 'tcloaded' ||
          tcData.eventStatus === 'useractioncomplete') {
        clearTimeout(timeout);
        if (hasAdsConsent(tcData)) {
          activateAds();
        } else {
          hideAdSlots();
        }
      } else if (tcData.eventStatus === 'cmpuishown') {
        // CMP dialog is showing; keep ads paused, clear the no-CMP timeout.
        clearTimeout(timeout);
      }
    }

    if (typeof window.__tcfapi === 'function') {
      window.__tcfapi('addEventListener', 2, onTcData);
    } else {
      // Poll briefly for the API to appear (Google CMP loads async via adsbygoogle.js).
      var tries = 0;
      var poll = setInterval(function () {
        tries++;
        if (typeof window.__tcfapi === 'function') {
          clearInterval(poll);
          window.__tcfapi('addEventListener', 2, onTcData);
        } else if (tries > 30) { // ~3s
          clearInterval(poll);
        }
      }, 100);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForCMP);
  } else {
    waitForCMP();
  }
})();
