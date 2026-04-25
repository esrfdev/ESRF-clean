/* validation-lab.js — renders the hidden ESRF.net Validation Lab hub from validation-lab.json.
   Pure static, no backend. Loaded only by /validation-lab.html. */
(function () {
  'use strict';

  var STATUS_LABELS = {
    'planned': 'Planned',
    'in-validation': 'In validation',
    'ready-for-review': 'Ready for review',
    'approved': 'Approved (awaiting promotion)',
    'archived': 'Archived'
  };

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function renderModule(mod) {
    var statusClass = 'vl-status vl-status-' + (mod.status || 'unknown');
    var card = el('article', { class: 'vl-card', 'data-module-id': mod.id });

    var header = el('header', { class: 'vl-card-head' }, [
      el('h3', { class: 'vl-card-title', text: mod.title || mod.id }),
      el('span', { class: statusClass, text: STATUS_LABELS[mod.status] || mod.status || 'unknown' })
    ]);
    card.appendChild(header);

    if (mod.purpose) card.appendChild(el('p', { class: 'vl-card-purpose', text: mod.purpose }));

    var meta = el('dl', { class: 'vl-card-meta' });
    [
      ['Owner', mod.owner],
      ['Last updated', mod.lastUpdated],
      ['Visibility', mod.visibility || 'hidden'],
      ['Path', mod.path]
    ].forEach(function (pair) {
      if (!pair[1]) return;
      meta.appendChild(el('dt', { text: pair[0] }));
      meta.appendChild(el('dd', { text: pair[1] }));
    });
    card.appendChild(meta);

    if (Array.isArray(mod.exitCriteria) && mod.exitCriteria.length) {
      card.appendChild(el('h4', { class: 'vl-card-subtitle', text: 'Exit criteria' }));
      var ul = el('ul', { class: 'vl-criteria' });
      mod.exitCriteria.forEach(function (c) { ul.appendChild(el('li', { text: c })); });
      card.appendChild(ul);
    }

    var actions = el('div', { class: 'vl-card-actions' });
    if (mod.path) {
      actions.appendChild(el('a', { class: 'vl-btn vl-btn-primary', href: mod.path, text: 'Open module →' }));
    }
    if (mod.thankYouPath) {
      actions.appendChild(el('a', { class: 'vl-btn', href: mod.thankYouPath, text: 'Open thank-you page' }));
    }
    card.appendChild(actions);

    return card;
  }

  function renderError(target, message) {
    target.innerHTML = '';
    target.appendChild(el('p', { class: 'vl-error', text: message }));
  }

  function init() {
    var target = document.getElementById('vl-modules');
    var meta = document.getElementById('vl-meta');
    if (!target) return;

    fetch('validation-lab.json', { credentials: 'omit', cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (meta && data.preview) {
          var p = el('p', { class: 'vl-meta-line' }, [
            'Preview branch: ',
            el('code', { text: data.preview.branch || '—' }),
            ' · ',
            el('a', { href: data.preview.url || '#', text: 'open preview' }),
            data.preview.draftPullRequest ? ' · ' : null,
            data.preview.draftPullRequest ? el('a', { href: data.preview.draftPullRequest, text: 'draft PR' }) : null
          ]);
          meta.appendChild(p);
        }

        var mods = Array.isArray(data.modules) ? data.modules : [];
        if (!mods.length) {
          renderError(target, 'No validation modules registered yet.');
          return;
        }
        target.innerHTML = '';
        mods.forEach(function (m) { target.appendChild(renderModule(m)); });
      })
      .catch(function (err) {
        renderError(target, 'Could not load validation-lab.json: ' + err.message);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
