/* ════════════════════════════════════════════════════════════════
   ESRF.net — shared helpers
   ════════════════════════════════════════════════════════════════ */

// Sector → pillar mapping
const SECTOR_TO_PILLAR = {
  'Risk & Continuity Management'        : 'prevent',
  'Knowledge, Training & Research'      : 'prevent',
  'Security & Protection'               : 'protect',
  'Critical Infrastructure'             : 'protect',
  'Digital Infrastructure & Cybersecurity': 'prepare',
  'Dual-use Technology & Manufacturing' : 'prepare',
  'Emergency & Crisis Response'         : 'respond',
  'Health & Medical Manufacturing'      : 'respond',
  'Energy & Grid Resilience'            : 'recover',
  'Transport, Maritime & Aerospace'     : 'recover',
};

const PILLAR_META = {
  prevent:  { key:'prevent',  num:'01', verb:'Prevent',  virtue:'Vigilance',   color:'#204E7A', body:'To notice before it is loud — structural attention to signals and systemic risks.' },
  protect:  { key:'protect',  num:'02', verb:'Protect',  virtue:'Stewardship', color:'#D24B1F', body:'To guard what sustains us — critical functions, vital processes, shared interests.' },
  prepare:  { key:'prepare',  num:'03', verb:'Prepare',  virtue:'Empowerment', color:'#5A2E4A', body:'To stand ready, together — through training, innovation and sustainable preparedness.' },
  respond:  { key:'respond',  num:'04', verb:'Respond',  virtue:'Solidarity',  color:'#A8741E', body:'To act as one when it matters — reliable networks, rapid coordination, mutual support.' },
  recover:  { key:'recover',  num:'05', verb:'Recover',  virtue:'Renewal',     color:'#4F5E2F', body:'To rise stronger than before — absorb shocks, accelerate recovery, renew the system.' },
};

// News tag (virtue) → pillar key
const VIRTUE_TO_PILLAR = {
  vigilance:'prevent', stewardship:'protect', empowerment:'prepare',
  solidarity:'respond', renewal:'recover',
};

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

// Short labels
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

function pillarOf(sector){ return SECTOR_TO_PILLAR[sector] || 'prevent'; }
function pillarColor(p){ return PILLAR_META[p]?.color || '#7A6E62'; }
function sectorColor(sector){ return pillarColor(pillarOf(sector)); }

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
      const nav = b.closest('.mast').querySelector('.mast-nav');
      nav.classList.toggle('open');
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
              <input type="text" id="m-name" name="name" required maxlength="120" placeholder="ACME Security GmbH" autocomplete="organization">
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
