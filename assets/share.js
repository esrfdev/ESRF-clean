/* ═══ ESRF compact share — one-line, small-format ═══
   Renders a quiet single-line share row into any element with
   [data-esrf-share]. No storage APIs. Accessible labels. */

(function(){
  'use strict';

  var ICONS = {
    linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1 4.98 2.12 4.98 3.5zM.24 8h4.53v14H.24V8zm7.5 0h4.34v1.92h.06c.6-1.14 2.08-2.34 4.28-2.34 4.58 0 5.43 3.01 5.43 6.93V22h-4.52v-6.58c0-1.57-.03-3.6-2.19-3.6-2.19 0-2.53 1.71-2.53 3.48V22H7.74V8z"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2H21.5l-7.49 8.56L22.75 22h-6.78l-5.31-6.94L4.5 22H1.24l8.02-9.16L1.25 2h6.95l4.8 6.34L18.24 2zm-1.19 18.1h1.78L6.98 3.8H5.08l11.98 16.3z"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 22v-8.3h2.8l.42-3.25H13.5V8.36c0-.94.26-1.58 1.6-1.58h1.72V3.87c-.3-.04-1.33-.13-2.52-.13-2.5 0-4.21 1.53-4.21 4.33v2.38H7.28v3.25h2.81V22H13.5z"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.11 4.87A10 10 0 0 0 4.1 18.2L3 22l3.9-1.02a10 10 0 0 0 4.77 1.22h.01a10 10 0 0 0 10-10 9.93 9.93 0 0 0-2.57-7.33zM11.68 20.5a8.3 8.3 0 0 1-4.22-1.15l-.3-.18-2.32.6.62-2.26-.2-.31a8.3 8.3 0 1 1 6.42 3.3zm4.56-6.22c-.25-.13-1.47-.73-1.7-.8-.23-.09-.4-.13-.56.13-.17.25-.65.8-.8.97-.15.17-.29.19-.54.06-.25-.13-1.05-.38-2-1.22-.74-.66-1.24-1.47-1.38-1.73-.15-.25-.02-.39.11-.51.12-.12.25-.3.38-.45.13-.15.17-.25.25-.42.08-.17.04-.32-.02-.45-.06-.12-.56-1.34-.77-1.83-.2-.48-.4-.42-.56-.43-.14-.01-.31-.01-.48-.01-.17 0-.45.06-.68.32s-.89.87-.89 2.12.92 2.46 1.05 2.63c.13.17 1.82 2.78 4.41 3.9.62.27 1.1.43 1.47.55.62.2 1.18.17 1.63.1.5-.07 1.47-.6 1.68-1.18.2-.58.2-1.07.15-1.18-.06-.12-.22-.18-.47-.31z"/></svg>',
    email: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm9 8.5L4 8v9h16V8l-8 5.5zM20 7H4l8 5 8-5z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2l-3.5-3.5L4 14.2 9 19.2l11-11-1.5-1.5z"/></svg>'
  };

  function tr(key, fallback){
    try{
      if(typeof window.t === 'function'){
        var v = window.t(key, fallback);
        if(v && v !== key) return v;
      }
    }catch(e){}
    return fallback;
  }

  function canonicalUrl(){
    var link = document.querySelector('link[rel="canonical"]');
    if(link && link.href) return link.href;
    return window.location.href.split('#')[0];
  }

  function pageTitle(){
    var og = document.querySelector('meta[property="og:title"]');
    if(og && og.content) return og.content;
    return document.title || 'ESRF.net';
  }

  function withUtm(url, source){
    try{
      var u = new URL(url);
      if(!u.searchParams.has('utm_source')) u.searchParams.set('utm_source', source);
      if(!u.searchParams.has('utm_medium')) u.searchParams.set('utm_medium', 'social');
      if(!u.searchParams.has('utm_campaign')) u.searchParams.set('utm_campaign', 'share');
      return u.toString();
    }catch(e){ return url; }
  }

  function btn(cls, label, href, iconKey){
    var tag = href ? 'a' : 'button';
    var attrs = href
      ? ' href="'+href+'" target="_blank" rel="noopener noreferrer"'
      : ' type="button"';
    return '<'+tag+' class="esrf-share__btn '+cls+'" aria-label="'+label+'" title="'+label+'"'+attrs+'>'+iconKey+'</'+tag+'>';
  }

  function render(el){
    var url = el.getAttribute('data-url') || canonicalUrl();
    var title = el.getAttribute('data-title') || pageTitle();
    var labelText = el.getAttribute('data-label') || tr('share.label', 'Share');

    var li  = withUtm(url, 'linkedin');
    var tw  = withUtm(url, 'x');
    var fb  = withUtm(url, 'facebook');
    var wa  = withUtm(url, 'whatsapp');
    var em  = withUtm(url, 'email');

    var liHref = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(li);
    var twHref = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(title) + '&url=' + encodeURIComponent(tw);
    var fbHref = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(fb);
    var waHref = 'https://wa.me/?text=' + encodeURIComponent(title + ' — ' + wa);
    var mailHref = 'mailto:?subject=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(title + '\n\n' + em);

    el.classList.add('esrf-share');
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', labelText);

    el.innerHTML =
      '<span class="esrf-share__label" aria-hidden="true">'+labelText+'</span>' +
      '<ul class="esrf-share__list">' +
        '<li>'+btn('esrf-share__btn--linkedin', tr('share.linkedin', 'Share on LinkedIn'), liHref, ICONS.linkedin)+'</li>' +
        '<li>'+btn('esrf-share__btn--x',        tr('share.x',        'Share on X'),        twHref, ICONS.x)+'</li>' +
        '<li>'+btn('esrf-share__btn--facebook', tr('share.facebook', 'Share on Facebook'), fbHref, ICONS.facebook)+'</li>' +
        '<li>'+btn('esrf-share__btn--whatsapp', tr('share.whatsapp', 'Share on WhatsApp'), waHref, ICONS.whatsapp)+'</li>' +
        '<li>'+btn('esrf-share__btn--email',    tr('share.email',    'Share by email'),    mailHref, ICONS.email)+'</li>' +
        '<li>'+btn('esrf-share__btn--copy js-esrf-copy', tr('share.copy', 'Copy link'), null, ICONS.copy)+'</li>' +
      '</ul>';

    var copyBtn = el.querySelector('.js-esrf-copy');
    if(copyBtn){
      copyBtn.addEventListener('click', function(){
        var value = url;
        var done = function(){
          copyBtn.classList.add('is-copied');
          copyBtn.innerHTML = ICONS.check;
          copyBtn.setAttribute('aria-label', tr('share.copied', 'Link copied'));
          setTimeout(function(){
            copyBtn.classList.remove('is-copied');
            copyBtn.innerHTML = ICONS.copy;
            copyBtn.setAttribute('aria-label', tr('share.copy', 'Copy link'));
          }, 1800);
        };
        if(navigator.clipboard && navigator.clipboard.writeText){
          navigator.clipboard.writeText(value).then(done).catch(function(){
            fallbackCopy(value); done();
          });
        }else{
          fallbackCopy(value); done();
        }
      });
    }
  }

  function fallbackCopy(text){
    try{
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly','');
      ta.style.position='absolute'; ta.style.left='-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }catch(e){}
  }

  function init(){
    document.querySelectorAll('[data-esrf-share]').forEach(function(el){
      if(el.dataset.esrfShareReady === '1') return;
      el.dataset.esrfShareReady = '1';
      render(el);
    });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  }else{
    init();
  }

  // Re-render on language change so labels update.
  window.addEventListener('esrf:langchange', function(){
    document.querySelectorAll('[data-esrf-share]').forEach(function(el){
      el.dataset.esrfShareReady = '';
    });
    init();
  });
})();
