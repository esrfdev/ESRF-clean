/* ════════════════════════════════════════════════════════════════
   ESRF.net — Analytics consent activator
   ════════════════════════════════════════════════════════════════
   • AdSense has been removed from the site; no ad consent is needed
   • Google Analytics (GA4) is present and starts with storage denied
   • This script grants analytics_storage when the visitor is outside
     the TCF/EER scope, or when a Google-CMP TCData signal indicates
     consent for purpose 1 (store/access info on a device)
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var granted = false;

  function grantAnalytics() {
    if (granted) return;
    granted = true;
    if (typeof gtag === 'function') {
      gtag('consent', 'update', {
        'analytics_storage': 'granted'
      });
    }
  }

  function hasAnalyticsConsent(tcData) {
    if (!tcData) return false;
    if (tcData.gdprApplies === false) return true;
    var p = tcData.purpose && tcData.purpose.consents;
    return !!(p && p[1]);
  }

  function waitForCMP() {
    // No AdSense means there's usually no CMP. If no TCF API appears within
    // 3s, assume analytics can run (the visitor is outside the TCF scope or
    // no CMP is loaded on this page).
    var timeout = setTimeout(grantAnalytics, 3000);

    function onTcData(tcData, success) {
      if (!success || !tcData) return;
      if (tcData.eventStatus === 'tcloaded' ||
          tcData.eventStatus === 'useractioncomplete') {
        clearTimeout(timeout);
        if (hasAnalyticsConsent(tcData)) grantAnalytics();
      } else if (tcData.eventStatus === 'cmpuishown') {
        clearTimeout(timeout);
      }
    }

    if (typeof window.__tcfapi === 'function') {
      window.__tcfapi('addEventListener', 2, onTcData);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForCMP);
  } else {
    waitForCMP();
  }
})();
