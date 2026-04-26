/* ════════════════════════════════════════════════════════════════
   ESRF Navigator — visitor help widget (MVP, static)
   No external dependencies. No backend. No analytics service.
   Predefined topics only. Compass avatar (inline SVG).
   ════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  if (window.__esrfNavigatorMounted) return;
  window.__esrfNavigatorMounted = true;

  // Inline SVG: compass — used for avatar and launcher button.
  var COMPASS_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="9.25"/>' +
      '<polygon points="12,5.5 14.2,11.4 12,12 9.8,11.4" fill="currentColor" stroke="none"/>' +
      '<polygon points="12,18.5 9.8,12.6 12,12 14.2,12.6" fill="none"/>' +
      '<circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none"/>' +
    '</svg>';

  // Topics — answers and CTAs reference confirmed pages/anchors.
  // Pattern set follows common nonprofit/foundation help-widget categories:
  // identity, mission, find/explore, governance/trust, partner, support,
  // publications, contact.
  var TOPICS = [
    {
      id: 'about',
      label: 'About ESRF',
      title: 'About the ESRF Foundation',
      body:
        '<p>The European Security &amp; Resilience Foundation (ESRF) is a non-profit ' +
        'community that maps and connects organisations working on security and ' +
        'resilience across Europe.</p>' +
        '<p>The Foundation curates a public directory and atlas, publishes editorials, ' +
        'and works in the open.</p>',
      cta: { href: 'about.html', label: 'Read the Foundation page' }
    },
    {
      id: 'mission',
      label: 'Mission &amp; focus',
      title: 'Our mission and focus',
      body:
        '<p>ESRF stands for <strong>a Europe that holds</strong>. Five pillars frame ' +
        'the work: <em>Vigilance</em> (prevent), <em>Stewardship</em> (protect), ' +
        '<em>Empowerment</em> (prepare), <em>Solidarity</em> (respond) and ' +
        '<em>Renewal</em> (recover).</p>' +
        '<p>We follow these principles across the sectors that keep daily life ' +
        'working — from emergency services and security to critical infrastructure, ' +
        'energy, transport, and digital resilience.</p>',
      cta: { href: 'about.html#pillars', label: 'See the five pillars' }
    },
    {
      id: 'explore',
      label: 'Find organisations',
      title: 'Directory and Atlas',
      body:
        '<p>The <strong>Directory</strong> lists organisations active in European ' +
        'security and resilience, organised by pillar, sector and country.</p>' +
        '<p>The <strong>Atlas</strong> is the same network shown on a map, useful for ' +
        'finding organisations near a place or along a corridor.</p>',
      cta: { href: 'directory.html', label: 'Open the Directory' },
      altCta: { href: 'map.html', label: 'Open the Atlas' }
    },
    {
      id: 'governance',
      label: 'Governance &amp; trust',
      title: 'Governance and transparency',
      body:
        '<p>ESRF is run by a small editorial team and supported by patrons. The ' +
        'Foundation does not sell listings, rank its members, or charge subscription ' +
        'fees.</p>' +
        '<p>How listings are reviewed, how the network is governed, and how the ' +
        'Foundation funds itself are documented on the about page.</p>',
      cta: { href: 'about.html#how-it-works', label: 'How it works' }
    },
    {
      id: 'partnership',
      label: 'Partnership',
      title: 'Partnerships and listings',
      body:
        '<p>Organisations working in security or resilience can request a listing in ' +
        'the ESRF directory at no cost. Listings are reviewed against the editorial ' +
        'criteria.</p>' +
        '<p>For partnership conversations, write to ' +
        '<a href="mailto:hello@esrf.net" style="color:var(--accent,#D24B1F)">hello@esrf.net</a>.</p>',
      cta: { href: 'request-listing.html', label: 'Request a listing' }
    },
    {
      id: 'contribute',
      label: 'Contribute &amp; support',
      title: 'Contribute and support the work',
      body:
        '<p>Individual contributors can donate to the Foundation. Organisations can ' +
        'become patrons or sponsors and help sustain the public infrastructure of the ' +
        'network.</p>' +
        '<p>Contributions keep the directory, the atlas, and the editorials open and ' +
        'free to read.</p>',
      cta: { href: 'fund.html', label: 'Contribute (donate)' },
      altCta: { href: 'sponsor.html', label: 'Become a patron' }
    },
    {
      id: 'publications',
      label: 'Publications',
      title: 'Editorials and Dispatch',
      body:
        '<p><strong>Editorials</strong> are long-form pieces on European security and ' +
        'resilience, written by the Foundation.</p>' +
        '<p><strong>Dispatch</strong> is a daily curated feed of articles from public ' +
        'sources across Europe.</p>',
      cta: { href: 'editorials.html', label: 'Read editorials' },
      altCta: { href: 'news.html', label: 'Open Dispatch' }
    },
    {
      id: 'contact',
      label: 'Contact',
      title: 'Contact the Foundation',
      body:
        '<p>General enquiries: ' +
        '<a href="mailto:hello@esrf.net" style="color:var(--accent,#D24B1F)">hello@esrf.net</a>.</p>' +
        '<p>Privacy matters: ' +
        '<a href="mailto:privacy@esrf.net" style="color:var(--accent,#D24B1F)">privacy@esrf.net</a>.</p>' +
        '<p>For security disclosures, please see the responsible disclosure page.</p>',
      cta: { href: 'responsible-disclosure.html', label: 'Responsible disclosure' }
    }
  ];

  var DISCLAIMER =
    'The ESRF Navigator provides general information based on the ESRF website. ' +
    'It does not provide legal, financial, security, or policy advice.';

  // Build DOM
  var launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'esrf-nav-launcher';
  launcher.setAttribute('aria-label', 'Open ESRF Navigator');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-controls', 'esrf-nav-panel');
  launcher.setAttribute('data-navigator-action', 'open');
  launcher.innerHTML = COMPASS_SVG;

  var panel = document.createElement('div');
  panel.className = 'esrf-nav-panel';
  panel.id = 'esrf-nav-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'esrf-nav-title');
  panel.setAttribute('data-open', 'false');

  panel.innerHTML =
    '<div class="esrf-nav-header">' +
      '<span class="esrf-nav-avatar" aria-hidden="true">' + COMPASS_SVG + '</span>' +
      '<span class="esrf-nav-title" id="esrf-nav-title">' +
        'ESRF Navigator' +
        '<span class="esrf-nav-subtitle">Find your way</span>' +
      '</span>' +
      '<button type="button" class="esrf-nav-close" ' +
        'aria-label="Close ESRF Navigator" ' +
        'data-navigator-action="close">×</button>' +
    '</div>' +
    '<div class="esrf-nav-body" id="esrf-nav-body" tabindex="-1"></div>' +
    '<div class="esrf-nav-footer">' + DISCLAIMER + '</div>';

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  var bodyEl = panel.querySelector('#esrf-nav-body');
  var closeBtn = panel.querySelector('.esrf-nav-close');
  var lastFocus = null;

  function escAttr(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
    });
  }

  function renderHome(){
    var optsHtml = TOPICS.map(function(t){
      return '<button type="button" class="esrf-nav-option" ' +
        'data-navigator-action="topic" data-topic="' + escAttr(t.id) + '">' +
        t.label + '</button>';
    }).join('');

    bodyEl.innerHTML =
      '<p>Welcome. The <strong>ESRF Navigator</strong> helps you find information ' +
      'about the Foundation, its mission, partnerships, ways to contribute, ' +
      'publications, and how to get in touch.</p>' +
      '<p>Choose a topic to continue:</p>' +
      '<div class="esrf-nav-options" role="group" aria-label="Topics">' +
        optsHtml +
      '</div>';

    var first = bodyEl.querySelector('.esrf-nav-option');
    if (first) first.focus();
  }

  function renderTopic(id){
    var t = TOPICS.find(function(x){ return x.id === id; });
    if (!t) { renderHome(); return; }

    var ctaHtml = '';
    if (t.cta){
      ctaHtml += '<a class="esrf-nav-cta" href="' + escAttr(t.cta.href) + '" ' +
        'data-navigator-action="cta" data-topic="' + escAttr(t.id) + '">' +
        t.cta.label + ' →</a>';
    }
    if (t.altCta){
      ctaHtml += ' <a class="esrf-nav-cta" href="' + escAttr(t.altCta.href) + '" ' +
        'style="background:transparent;color:var(--ink,#0F1419)" ' +
        'data-navigator-action="cta-alt" data-topic="' + escAttr(t.id) + '">' +
        t.altCta.label + ' →</a>';
    }

    bodyEl.innerHTML =
      '<h3 style="font-family:\'Archivo\',system-ui,sans-serif;font-weight:700;' +
        'font-size:16px;letter-spacing:-0.01em;margin:0 0 10px;color:var(--ink,#0F1419)">' +
        t.title + '</h3>' +
      t.body +
      (ctaHtml ? '<p style="margin-top:12px">' + ctaHtml + '</p>' : '') +
      '<button type="button" class="esrf-nav-back" data-navigator-action="back">' +
      '← All topics</button>';

    var heading = bodyEl.querySelector('h3');
    if (heading) {
      // Move keyboard focus to the new content so screen readers announce it.
      bodyEl.focus();
    }
  }

  function openPanel(){
    if (panel.getAttribute('data-open') === 'true') return;
    lastFocus = document.activeElement;
    panel.setAttribute('data-open', 'true');
    launcher.setAttribute('aria-expanded', 'true');
    renderHome();
  }

  function closePanel(){
    if (panel.getAttribute('data-open') !== 'true') return;
    panel.setAttribute('data-open', 'false');
    launcher.setAttribute('aria-expanded', 'false');
    if (lastFocus && typeof lastFocus.focus === 'function'){
      lastFocus.focus();
    } else {
      launcher.focus();
    }
  }

  // Click delegation
  launcher.addEventListener('click', openPanel);

  panel.addEventListener('click', function(e){
    var target = e.target.closest('[data-navigator-action]');
    if (!target) return;
    var action = target.getAttribute('data-navigator-action');
    if (action === 'close') { e.preventDefault(); closePanel(); return; }
    if (action === 'back')  { e.preventDefault(); renderHome(); return; }
    if (action === 'topic') {
      e.preventDefault();
      renderTopic(target.getAttribute('data-topic'));
      return;
    }
    // CTAs are real anchors — let the browser navigate.
  });

  // Keyboard: Escape closes; basic focus containment within the panel.
  document.addEventListener('keydown', function(e){
    if (panel.getAttribute('data-open') !== 'true') return;
    if (e.key === 'Escape' || e.keyCode === 27){
      e.preventDefault();
      closePanel();
      return;
    }
    if (e.key === 'Tab'){
      var focusables = panel.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      var first = focusables[0];
      var last  = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first){
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last){
        e.preventDefault(); first.focus();
      }
    }
  });
})();
