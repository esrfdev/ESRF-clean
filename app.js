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
