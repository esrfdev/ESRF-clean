/* ════════════════════════════════════════════════════════════════
   ESRF.net — SVG Flag helpers
   Uses flag-icons CDN (lipis/flag-icons@7.2.3, 4x3 ratio)
   ════════════════════════════════════════════════════════════════ */

const FLAG_CDN_BASE = 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/';

/**
 * Returns the CDN URL for a country flag SVG.
 * @param {string} code – ISO 3166-1 alpha-2 country code (case-insensitive)
 * @returns {string} Full CDN URL
 */
function flagUrl(code) {
  return FLAG_CDN_BASE + String(code).toLowerCase() + '.svg';
}

/**
 * Returns an <img> tag string for a flag.
 * @param {string} code – ISO 3166-1 alpha-2 country code
 * @param {object} opts – { size: 'inline'|'card'|'big', extra: '' }
 * @returns {string} HTML img tag
 */
function flagHtml(code, opts) {
  opts = opts || {};
  const sizeClass = opts.size ? 'flag-' + opts.size : '';
  const cls = ['flag-icon', sizeClass, opts.extra || ''].filter(Boolean).join(' ');
  const c = String(code).toLowerCase();
  return `<img src="${flagUrl(c)}" alt="${c} flag" class="${cls}" width="20" height="15" loading="lazy">`;
}

/**
 * Maps language codes to their representative country flag code.
 * Languages without their own state use an appropriate country.
 */
const LANG_TO_COUNTRY = {
  bg: 'bg', // Bulgarian → Bulgaria
  cs: 'cz', // Czech → Czech Republic
  da: 'dk', // Danish → Denmark
  de: 'de', // German → Germany
  el: 'gr', // Greek → Greece
  en: 'gb', // English → United Kingdom
  es: 'es', // Spanish → Spain
  et: 'ee', // Estonian → Estonia
  fi: 'fi', // Finnish → Finland
  fr: 'fr', // French → France
  ga: 'ie', // Irish → Ireland
  hr: 'hr', // Croatian → Croatia
  hu: 'hu', // Hungarian → Hungary
  it: 'it', // Italian → Italy
  lt: 'lt', // Lithuanian → Lithuania
  lv: 'lv', // Latvian → Latvia
  mt: 'mt', // Maltese → Malta
  nl: 'nl', // Dutch → Netherlands
  pl: 'pl', // Polish → Poland
  pt: 'pt', // Portuguese → Portugal
  ro: 'ro', // Romanian → Romania
  sk: 'sk', // Slovak → Slovakia
  sl: 'si', // Slovenian → Slovenia
  sv: 'se', // Swedish → Sweden
  is: 'is', // Icelandic → Iceland
  no: 'no', // Norwegian → Norway
  uk: 'ua', // Ukrainian → Ukraine
};

/**
 * Returns a flag <img> tag for a given language code.
 * Uses LANG_TO_COUNTRY mapping; falls back to 'gb' for unknown languages.
 * @param {string} langCode – BCP 47 language code (2-letter)
 * @param {object} opts – passed to flagHtml()
 * @returns {string} HTML img tag
 */
function flagForLang(langCode, opts) {
  const cc = LANG_TO_COUNTRY[String(langCode).toLowerCase()] || 'gb';
  return flagHtml(cc, opts);
}

// ── Country name → ISO code map (for directory integration) ──
const COUNTRY_NAME_TO_CODE = {
  'Austria': 'at', 'Belgium': 'be', 'Bulgaria': 'bg', 'Croatia': 'hr',
  'Cyprus': 'cy', 'Czech Republic': 'cz', 'Czechia': 'cz',
  'Denmark': 'dk', 'Estonia': 'ee', 'Finland': 'fi', 'France': 'fr',
  'Germany': 'de', 'Greece': 'gr', 'Hungary': 'hu', 'Iceland': 'is',
  'Ireland': 'ie', 'Italy': 'it', 'Latvia': 'lv', 'Lithuania': 'lt',
  'Luxembourg': 'lu', 'Malta': 'mt', 'Netherlands': 'nl', 'Norway': 'no',
  'Poland': 'pl', 'Portugal': 'pt', 'Romania': 'ro', 'Slovakia': 'sk',
  'Slovenia': 'si', 'Spain': 'es', 'Sweden': 'se', 'Ukraine': 'ua',
  // Also handle ISO codes passed directly
  'AT': 'at', 'BE': 'be', 'BG': 'bg', 'HR': 'hr', 'CY': 'cy',
  'CZ': 'cz', 'DK': 'dk', 'EE': 'ee', 'FI': 'fi', 'FR': 'fr',
  'DE': 'de', 'GR': 'gr', 'HU': 'hu', 'IS': 'is', 'IE': 'ie',
  'IT': 'it', 'LV': 'lv', 'LT': 'lt', 'LU': 'lu', 'MT': 'mt',
  'NL': 'nl', 'NO': 'no', 'PL': 'pl', 'PT': 'pt', 'RO': 'ro',
  'SK': 'sk', 'SI': 'si', 'ES': 'es', 'SE': 'se', 'UA': 'ua',
  'GB': 'gb', 'UK': 'gb',
};

/**
 * Returns flag img tag for a country name or ISO code string.
 * @param {string} nameOrCode – e.g. "Netherlands" or "NL"
 * @param {object} opts – passed to flagHtml()
 * @returns {string} HTML img tag or empty string if not found
 */
function flagForCountry(nameOrCode, opts) {
  if (!nameOrCode) return '';
  const cc = COUNTRY_NAME_TO_CODE[nameOrCode] || COUNTRY_NAME_TO_CODE[String(nameOrCode).toUpperCase()];
  if (!cc) return '';
  return flagHtml(cc, opts);
}

// ── Expose as both ES module exports and window global ──
const esrfFlags = {
  flagUrl,
  flagHtml,
  flagForLang,
  flagForCountry,
  LANG_TO_COUNTRY,
  COUNTRY_NAME_TO_CODE,
};

// Window global (for non-module scripts)
if (typeof window !== 'undefined') {
  window.esrfFlags = esrfFlags;
}

// ES module export (for bundlers / future use)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = esrfFlags;
}
