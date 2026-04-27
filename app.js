/* ════════════════════════════════════════════════════════════════
   ESRF.net — shared helpers
   ════════════════════════════════════════════════════════════════ */

// Sector colour maps
const SECTOR_COLOR = {
  'Emergency & Crisis Response'          : 'var(--sec-emergency)',
  'Security & Protection'                : 'var(--sec-security)',
  'Risk & Continuity Management'         : 'var(--sec-risk)',
  'Digital Infrastructure & Cybersecurity': 'var(--sec-digital)',
  'Knowledge, Training & Research'       : 'var(--sec-knowledge)',
  'Health & Medical Manufacturing'       : 'var(--sec-health)',
  'Critical Infrastructure'              : 'var(--sec-critical)',
  'Dual-use Technology & Manufacturing'  : 'var(--sec-dualuse)',
  'Transport, Maritime & Aerospace'      : 'var(--sec-transport)',
  'Energy & Grid Resilience'             : 'var(--sec-energy)',
};
const SECTOR_HEX = {
  'Emergency & Crisis Response'          : '#C14A2E',
  'Security & Protection'                : '#2F4858',
  'Risk & Continuity Management'         : '#7A4B2E',
  'Digital Infrastructure & Cybersecurity': '#3A5A7A',
  'Knowledge, Training & Research'       : '#6B5D8A',
  'Health & Medical Manufacturing'       : '#8C3A52',
  'Critical Infrastructure'              : '#4A6B3A',
  'Dual-use Technology & Manufacturing'  : '#A87C2B',
  'Transport, Maritime & Aerospace'      : '#5B6B7A',
  'Energy & Grid Resilience'             : '#AE5A1F',
};
function sectorColor(sector){ return SECTOR_COLOR[sector] || 'var(--ink-dim)'; }
function sectorColorHex(sector){ return SECTOR_HEX[sector] || '#7A6E62'; }

const SECTOR_ORDER = [
  'Emergency & Crisis Response',
  'Security & Protection',
  'Risk & Continuity Management',
  'Digital Infrastructure & Cybersecurity',
  'Knowledge, Training & Research',
  'Health & Medical Manufacturing',
  'Critical Infrastructure',
  'Dual-use Technology & Manufacturing',
  'Transport, Maritime & Aerospace',
  'Energy & Grid Resilience',
];

// Short labels (English — used as fallback when i18n has not loaded yet)
const SECTOR_SHORT = {
  'Emergency & Crisis Response'         : 'Emergency',
  'Security & Protection'               : 'Security',
  'Risk & Continuity Management'        : 'Risk',
  'Digital Infrastructure & Cybersecurity': 'Digital',
  'Knowledge, Training & Research'      : 'Knowledge',
  'Health & Medical Manufacturing'      : 'Health',
  'Critical Infrastructure'             : 'Critical',
  'Dual-use Technology & Manufacturing' : 'Dual-use',
  'Transport, Maritime & Aerospace'     : 'Transport',
  'Energy & Grid Resilience'            : 'Energy',
};

// Canonical sector key  ←→  i18n key. Canonical (English) values are what
// every part of the app stores in data attributes, state, and URLs — visible
// labels are looked up through i18n via sectorLabel(). Keeping the mapping
// here means map.html, directory.html, the site search and any future sector
// UI all pull from a single source of truth and stay in lockstep with the
// sector.* keys in i18n/*.json.
const SECTOR_I18N_KEYS = {
  'Emergency & Crisis Response'          : { full: 'sector.emergency',   short: 'sector.short_emergency'   },
  'Security & Protection'                : { full: 'sector.security',    short: 'sector.short_security'    },
  'Risk & Continuity Management'         : { full: 'sector.risk',        short: 'sector.short_risk'        },
  'Digital Infrastructure & Cybersecurity': { full: 'sector.digital',    short: 'sector.short_digital'     },
  'Knowledge, Training & Research'       : { full: 'sector.knowledge',   short: 'sector.short_knowledge'   },
  'Health & Medical Manufacturing'       : { full: 'sector.health',      short: 'sector.short_health'      },
  'Critical Infrastructure'              : { full: 'sector.critical',    short: 'sector.short_critical'    },
  'Dual-use Technology & Manufacturing'  : { full: 'sector.dual_use',    short: 'sector.short_dual_use'    },
  'Transport, Maritime & Aerospace'      : { full: 'sector.transport',   short: 'sector.short_transport'   },
  'Energy & Grid Resilience'             : { full: 'sector.energy',      short: 'sector.short_energy'      },
};

// Returns the user-visible label for a canonical sector key in the active
// language. Falls back to the English SECTOR_SHORT / canonical key when the
// i18n layer has not loaded yet (first paint on slow connections) so the UI
// is never blank.
function sectorLabel(canonicalKey, opts){
  if (!canonicalKey) return '';
  const keys = SECTOR_I18N_KEYS[canonicalKey];
  const isShort = !!(opts && opts.short);
  const fallback = isShort ? (SECTOR_SHORT[canonicalKey] || canonicalKey) : canonicalKey;
  if (!keys) return fallback;
  const i18nKey = isShort ? keys.short : keys.full;
  if (window.esrfI18n && typeof window.esrfI18n.t === 'function') {
    const v = window.esrfI18n.t(i18nKey, fallback);
    return (v && v !== i18nKey) ? v : fallback;
  }
  return fallback;
}

// Normalise any sector-label-ish string back to its canonical SECTOR_ORDER
// value. Accepts:
//   • the canonical English key itself (case-insensitive)
//   • the English short label ("Emergency")
//   • any localised full or short label from i18n/*.json ("Noodhulp",
//     "Notfall & Krisenreaktion", …)
//   • a slug of any of the above (e.g. "emergency-crisis-response")
// Returns '' when no match. This is the single chokepoint for translating
// user-supplied input (URL params, search results, editorial deep links)
// back to the canonical taxonomy the data is stored under.
let _sectorAliasIndex = null;
let _sectorAliasIndexHasI18n = false;
function _normaliseSectorLabel(s){
  return String(s || '').trim().toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[\s&/,.'’·\-]+/g, ' ').trim();
}
function _buildSectorAliasIndex(){
  const idx = {};
  const add = (alias, canon) => {
    const n = _normaliseSectorLabel(alias);
    if (n) idx[n] = canon;
  };
  SECTOR_ORDER.forEach(canon => {
    add(canon, canon);
    add(SECTOR_SHORT[canon] || '', canon);
  });
  // Walk the loaded i18n strings if available, so every language's
  // translations become valid aliases. If i18n hasn't finished loading yet
  // we still return an English-only index — the next call will detect the
  // i18n layer is now ready and rebuild.
  let i18nSeen = false;
  try {
    if (window.esrfI18n && typeof window.esrfI18n.t === 'function') {
      Object.entries(SECTOR_I18N_KEYS).forEach(([canon, keys]) => {
        const full = window.esrfI18n.t(keys.full, '');
        const shrt = window.esrfI18n.t(keys.short, '');
        if (full && full !== keys.full && full !== '') { add(full, canon); i18nSeen = true; }
        if (shrt && shrt !== keys.short && shrt !== '') { add(shrt, canon); i18nSeen = true; }
      });
    }
  } catch (e) { /* non-critical */ }
  _sectorAliasIndexHasI18n = i18nSeen;
  return idx;
}
function canonicalizeSector(input){
  if (!input) return '';
  // Direct canonical hit first (no normalisation loss).
  if (SECTOR_ORDER.indexOf(input) !== -1) return input;
  // Rebuild index if empty or if we built it before i18n was ready and
  // i18n has since loaded — this lets ?sector=<localised label> deep
  // links work regardless of whether the page script ran before or after
  // i18n fetchStrings resolved.
  const i18nReadyNow = !!(window.esrfI18n
    && typeof window.esrfI18n.t === 'function'
    && window.esrfI18n.t('sector.short_emergency','') !== ''
    && window.esrfI18n.t('sector.short_emergency','') !== 'sector.short_emergency');
  if (!_sectorAliasIndex || (i18nReadyNow && !_sectorAliasIndexHasI18n)) {
    _sectorAliasIndex = _buildSectorAliasIndex();
  }
  return _sectorAliasIndex[_normaliseSectorLabel(input)] || '';
}
// Alias index must be rebuilt after a language change so the new locale's
// labels become valid URL inputs.
if (typeof window !== 'undefined') {
  window.addEventListener('esrf:langchange', () => {
    _sectorAliasIndex = null;
    _sectorAliasIndexHasI18n = false;
  });
}

// Secondary tags — applied today to Emergency & Crisis Response organisations to
// surface humanitarian/aid/help work inside the Atlas. Canonical English keys are
// stored in data; i18n keys map to localised labels under tag.* in i18n JSON.
const SECONDARY_TAGS = [
  'Humanitarian aid',
  'Disaster relief',
  'Civil protection',
  'Search & rescue',
  'Shelter & evacuation',
  'Food & basic needs',
  'Volunteer response',
  'Psychosocial support',
  'Community resilience',
  'Crisis response',
];
const SECONDARY_TAG_I18N = {
  'Humanitarian aid'    : 'tag.humanitarian_aid',
  'Disaster relief'     : 'tag.disaster_relief',
  'Civil protection'    : 'tag.civil_protection',
  'Search & rescue'     : 'tag.search_rescue',
  'Shelter & evacuation': 'tag.shelter_evacuation',
  'Food & basic needs'  : 'tag.food_basic_needs',
  'Volunteer response'  : 'tag.volunteer_response',
  'Psychosocial support': 'tag.psychosocial_support',
  'Community resilience': 'tag.community_resilience',
  'Crisis response'     : 'tag.crisis_response',
};
function tagLabel(tag){
  const key = SECONDARY_TAG_I18N[tag];
  if (!key) return tag;
  if (window.esrfI18n && window.esrfI18n.t) {
    const v = window.esrfI18n.t(key, tag);
    return (v === key) ? tag : v;
  }
  return tag;
}

// Data loaders (cached)
let _orgs = null, _news = null;
async function loadOrgs(){
  if(_orgs) return _orgs;
  const r = await fetch('companies_extracted.json');
  _orgs = await r.json();
  return _orgs;
}
async function loadOrgsFromRoot(){
  if(_orgs) return _orgs;
  const r = await fetch('../companies_extracted.json');
  _orgs = await r.json();
  return _orgs;
}
async function loadNews(){
  if(_news) return _news;
  const r = await fetch('news-data.json');
  _news = await r.json();
  return _news;
}

// Escape
function esc(s){
  if(s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Slugify (country names)
function slugify(s){
  return String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}

// Mobile nav burger toggle
function wireBurger(){
  document.querySelectorAll('.mast-burger').forEach(b=>{
    b.addEventListener('click', ()=>{
      const mast = b.closest('.mast');
      const nav = mast.querySelector('.mast-nav');
      const isOpen = nav.classList.toggle('open');
      mast.classList.toggle('nav-open', isOpen);
      b.setAttribute('aria-expanded', isOpen);
      b.textContent = isOpen ? '✕' : '≡';
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });
  });
}
document.addEventListener('DOMContentLoaded', wireBurger);

// ── Listing request modal (injected globally) ──
function injectListingModal() {
  if (document.getElementById('listing-modal')) return;

  const html = `
    <div id="listing-modal" class="modal" hidden aria-hidden="true" role="dialog" aria-labelledby="listing-modal-title" aria-modal="true">
      <div class="modal-backdrop" data-close-modal></div>
      <div class="modal-panel">
        <button class="modal-close" aria-label="Close" data-close-modal type="button">&times;</button>
        <div class="modal-body">
          <div class="kicker" data-i18n="modal.kicker">§ Community · Listing request</div>
          <h2 id="listing-modal-title" class="modal-title" data-i18n="modal.title">Add your organisation</h2>
          <p class="modal-intro" data-i18n="modal.intro">Any organisation whose work strengthens European security and resilience is welcome. Listing is free. Submissions are reviewed within three working days.</p>

          <div id="modal-error" class="form-error" hidden role="alert"></div>

          <form id="listing-form-modal" class="form-grid" novalidate autocomplete="on" style="margin-top:0">
            <input type="text" name="company_website_hp" tabindex="-1" autocomplete="off"
              style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" aria-hidden="true">

            <div class="form-row">
              <label for="m-name" data-i18n="form.label_name">Organisation name <span class="req" aria-hidden="true">*</span></label>
              <input type="text" id="m-name" name="name" required maxlength="120" placeholder="My organisation" autocomplete="organization">
            </div>
            <div class="form-row">
              <label for="m-country" data-i18n="form.label_country">Country <span class="req" aria-hidden="true">*</span></label>
              <select id="m-country" name="country" required>
                <option value="">Select a country…</option>
                <optgroup label="EU Member States">
                  <option value="AT">Austria</option><option value="BE">Belgium</option>
                  <option value="BG">Bulgaria</option><option value="HR">Croatia</option>
                  <option value="CY">Cyprus</option><option value="CZ">Czech Republic</option>
                  <option value="DK">Denmark</option><option value="EE">Estonia</option>
                  <option value="FI">Finland</option><option value="FR">France</option>
                  <option value="DE">Germany</option><option value="GR">Greece</option>
                  <option value="HU">Hungary</option><option value="IE">Ireland</option>
                  <option value="IT">Italy</option><option value="LV">Latvia</option>
                  <option value="LT">Lithuania</option><option value="LU">Luxembourg</option>
                  <option value="MT">Malta</option><option value="NL">Netherlands</option>
                  <option value="PL">Poland</option><option value="PT">Portugal</option>
                  <option value="RO">Romania</option><option value="SK">Slovakia</option>
                  <option value="SI">Slovenia</option><option value="ES">Spain</option>
                  <option value="SE">Sweden</option>
                </optgroup>
                <optgroup label="Other European Countries">
                  <option value="IS">Iceland</option><option value="NO">Norway</option>
                  <option value="UA">Ukraine</option><option value="GB">United Kingdom</option>
                  <option value="CH">Switzerland</option>
                </optgroup>
              </select>
            </div>
            <div class="form-row">
              <label for="m-website" data-i18n="form.label_website">Website <span class="req" aria-hidden="true">*</span></label>
              <input type="url" id="m-website" name="website" required placeholder="https://example.com" autocomplete="url" pattern="https?://.+">
            </div>
            <div class="form-row">
              <label for="m-sector" data-i18n="form.label_sector">Sector <span class="req" aria-hidden="true">*</span></label>
              <select id="m-sector" name="sector" required>
                <option value="">Select a sector…</option>
                <option value="Emergency &amp; Crisis Response">Emergency &amp; Crisis Response</option>
                <option value="Security &amp; Protection">Security &amp; Protection</option>
                <option value="Risk &amp; Continuity Management">Risk &amp; Continuity Management</option>
                <option value="Digital Infrastructure &amp; Cybersecurity">Digital Infrastructure &amp; Cybersecurity</option>
                <option value="Knowledge, Training &amp; Research">Knowledge, Training &amp; Research</option>
                <option value="Health &amp; Medical Manufacturing">Health &amp; Medical Manufacturing</option>
                <option value="Critical Infrastructure">Critical Infrastructure</option>
                <option value="Dual-use Technology &amp; Manufacturing">Dual-use Technology &amp; Manufacturing</option>
                <option value="Transport, Maritime &amp; Aerospace">Transport, Maritime &amp; Aerospace</option>
                <option value="Energy &amp; Grid Resilience">Energy &amp; Grid Resilience</option>
              </select>
            </div>
            <div class="form-row">
              <label for="m-contact-email" data-i18n="form.label_contact_email">Contact email <span class="req" aria-hidden="true">*</span></label>
              <input type="email" id="m-contact-email" name="contact_email" required placeholder="you@example.com" autocomplete="email">
            </div>
            <div class="form-check">
              <input type="checkbox" id="m-gdpr" name="gdpr_consent" required>
              <label for="m-gdpr" data-i18n="form.label_gdpr">I agree to the <a href="privacy.html" data-i18n="form.privacy_link">privacy policy</a> and consent to storage of this data.</label>
            </div>
            <div>
              <button type="submit" class="form-submit" id="modal-submit-btn" data-i18n="form.submit">Submit request</button>
            </div>
          </form>

          <div id="modal-success" hidden style="text-align:center;padding:40px 0">
            <div class="kicker" data-i18n="form.success_kicker">§ Received</div>
            <h3 style="font-family:'Archivo',sans-serif;font-size:28px;margin:8px 0 12px" data-i18n="form.success_title">Request received.</h3>
            <p style="color:var(--ink-soft)" data-i18n="form.success_body">The ESRF.net team will review within three working days.</p>
          </div>

          <p class="modal-footnote"><a href="request-listing.html" data-i18n="modal.full_form_link">Open the full form →</a></p>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);
  wireModalButtons();
  wireModalForm();
}

function openModal(id) {
  const modal = document.getElementById(id + '-modal');
  if (!modal) return;
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  // Focus first focusable element
  const first = modal.querySelector('input, select, textarea, button:not([data-close-modal])');
  if (first) setTimeout(() => first.focus(), 50);
  // Store load time for timer check
  if (!window.__formLoadedAt) window.__formLoadedAt = Date.now();
  window.__modalOpenedAt = Date.now();
}

function closeModal(id) {
  const modal = document.getElementById(id + '-modal');
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

function wireModalButtons() {
  // Open triggers
  document.addEventListener('click', function(e) {
    const trigger = e.target.closest('[data-open-modal]');
    if (trigger) {
      e.preventDefault();
      openModal(trigger.dataset.openModal);
    }
  });

  // Close triggers
  document.addEventListener('click', function(e) {
    if (e.target.closest('[data-close-modal]')) {
      const modal = e.target.closest('.modal');
      if (modal) {
        const id = modal.id.replace('-modal', '');
        closeModal(id);
      }
    }
  });

  // Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal:not([hidden])').forEach(m => {
        const id = m.id.replace('-modal', '');
        closeModal(id);
      });
    }
  });
}

function wireModalForm() {
  const form = document.getElementById('listing-form-modal');
  const errorBox = document.getElementById('modal-error');
  const successBox = document.getElementById('modal-success');
  const submitBtn = document.getElementById('modal-submit-btn');
  if (!form) return;

  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    if (errorBox) { errorBox.hidden = true; errorBox.textContent = ''; }

    const data = new FormData(form);

    // Honeypot
    if (data.get('company_website_hp')) return;

    // Timer
    const elapsed = Date.now() - (window.__modalOpenedAt || window.__formLoadedAt || 0);
    if (elapsed < 3000) {
      if (errorBox) { errorBox.textContent = 'Please take a moment before submitting.'; errorBox.hidden = false; }
      return;
    }

    const name = data.get('name') || '';
    const country = data.get('country') || '';
    const website = data.get('website') || '';
    const sector = data.get('sector') || '';
    const contact_email = data.get('contact_email') || '';
    const gdpr = data.get('gdpr_consent');

    if (!name || !country || !website || !sector || !contact_email) {
      if (errorBox) { errorBox.textContent = 'Please fill in all required fields.'; errorBox.hidden = false; }
      return;
    }
    if (!gdpr) {
      if (errorBox) { errorBox.textContent = 'Please accept the privacy policy to continue.'; errorBox.hidden = false; }
      return;
    }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting…'; }

    try {
      const resp = await fetch('/api/submit-listing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name, country, website, sector,
          contact_name: name, // use org name as contact fallback in modal
          contact_email,
          gdpr_consent: true,
          company_website_hp: data.get('company_website_hp') || '',
          form_duration_ms: elapsed,
        }),
      });
      const result = await resp.json();
      if (result.ok) {
        form.hidden = true;
        if (successBox) successBox.hidden = false;
      } else {
        if (errorBox) { errorBox.textContent = result.error || 'An error occurred.'; errorBox.hidden = false; }
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit request'; }
      }
    } catch(err) {
      if (errorBox) { errorBox.textContent = 'Network error — please try again.'; errorBox.hidden = false; }
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit request'; }
    }
  });
}

document.addEventListener('DOMContentLoaded', injectListingModal);

// ── Update-or-verify CTA: append current lang to href so users land on the
// matching language variant of the combined submit form. The mode=change_request
// query param is already on the href; this only adds &lang=<current>. ──
function syncListingCtaLang() {
  function pickLang() {
    try {
      const u = new URLSearchParams(window.location.search).get('lang');
      if (u) return u.toLowerCase();
    } catch (e) {}
    if (window.esrfI18n && typeof window.esrfI18n.getCurrentLang === 'function') {
      const l = window.esrfI18n.getCurrentLang();
      if (l) return l;
    }
    try {
      const stored = localStorage.getItem('esrfnetLang');
      if (stored) return stored;
    } catch (e) {}
    return (document.documentElement.getAttribute('lang') || 'en').toLowerCase();
  }
  function apply() {
    const lang = pickLang();
    document.querySelectorAll('[data-mast-cta-listing]').forEach(function(a) {
      try {
        const url = new URL(a.getAttribute('href') || '/submit-news?mode=change_request', window.location.origin);
        url.searchParams.set('mode', 'change_request');
        url.searchParams.set('lang', lang);
        a.setAttribute('href', url.pathname + '?' + url.searchParams.toString());
      } catch (e) {}
    });
  }
  apply();
  window.addEventListener('esrf:langchange', apply);
}
document.addEventListener('DOMContentLoaded', syncListingCtaLang);

// ── Sponsor slot renderer ──
function renderSponsorSlot(slot, placeholder) {
  if (slot.name && slot.logo) {
    return `<a class="sponsor-slot filled" href="${esc(slot.url || 'sponsor.html')}" target="_blank" rel="noopener sponsored">
      <img src="${esc(slot.logo)}" alt="${esc(slot.name)}" loading="lazy">
    </a>`;
  }
  return `<a class="sponsor-slot empty" href="sponsor.html">
    <span class="sponsor-cta">${placeholder || 'Become a sponsor →'}</span>
  </a>`;
}

// ── Load and render sponsor bands ──
async function loadAndRenderSponsors(rootPrefix) {
  const prefix = rootPrefix || '';
  try {
    const resp = await fetch(prefix + 'sponsors-data.json');
    if (!resp.ok) return null;
    return await resp.json();
  } catch(e) { return null; }
}

function buildSponsorBand(slots, label, placeholder) {
  const slotsHtml = slots.map(s => renderSponsorSlot(s, placeholder)).join('');
  return `<section class="sponsor-band">
    <div class="sponsor-band-label">${esc(label || 'Supported by')}</div>
    <div class="sponsor-grid">${slotsHtml}</div>
  </section>`;
}
