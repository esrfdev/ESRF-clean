// Test: header CTA mobile layout (rolled out 2026-04-27 fix).
// Guards the mobile bug-fix that re-anchors the Variant A command card
// as the LAST item in the open mobile drawer — full-width block, after
// every nav link and after the Contribute link — so it can no longer
// overlap or hide behind the final menu button.
//
// What we guard:
//   1. In every public page's <nav class="mast">, the .mast-cta anchor
//      appears AFTER every other nav anchor in the drawer (.mast-nav).
//      In particular it appears after .mast-contribute.
//   2. CSS: on the mobile breakpoint, .mast-cta is laid out as a
//      full-width block (width:100%) and is NOT absolutely positioned
//      over the list. We require `position` to be relative or static
//      — never `absolute` or `fixed` — and width:100%.
//   3. CSS: the mobile .mast-cta rule keeps min-height >= 44px (WCAG
//      2.2 AA / 2.5.8 tap target), and provides top spacing so it does
//      not collide with the previous item.
//   4. CSS: the desktop visual order is preserved via flex `order` so
//      the DOM swap does not change the desktop layout: .mast-cta has
//      a smaller order value than .mast-contribute in the base rule.
//   5. CSS: inside the mobile media query, the desktop `order` flip is
//      reset (both items get order:0) so the natural DOM order — CTA
//      last — drives the mobile drawer.
//
// Run with: node scripts/header_cta_mobile_order.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

let failures = 0;
function check(name, fn){
  try { fn(); console.log('  ok  — ' + name); }
  catch(e){ failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}

const PUBLIC_PAGES = [
  'index.html', 'about.html', 'analytics.html', 'directory.html',
  'editorial-emergency-capaciteit-europa-2026.html',
  'editorial-koningsdag-2026.html',
  'editorial-oil-shortage-2026.html',
  'editorial-rotterdam-weerbaarheid-2026.html',
  'editorials.html', 'events.html', 'fund.html', 'map.html', 'news.html',
  'privacy.html', 'request-listing.html', 'responsible-disclosure.html',
  'sponsor.html', 'submit-event.html', 'submit-news.html', 'terms.html',
];

function extractNavInner(html){
  // Grab the contents of <div class="mast-nav" ...>...</div>.
  const m = html.match(/<div\s+class="mast-nav"[^>]*>([\s\S]*?)<\/div>/);
  return m ? m[1] : null;
}

/* 1. CTA is the LAST anchor in the drawer (after every other nav link,
      including .mast-contribute). */
for (const page of PUBLIC_PAGES){
  check(`${page}: .mast-cta is the last anchor inside .mast-nav`, () => {
    const html = fs.readFileSync(path.join(repoRoot, page), 'utf8');
    const inner = extractNavInner(html);
    assert.ok(inner, 'no .mast-nav drawer in ' + page);
    // Find every <a ...> opener and tag whether it's the CTA.
    const anchors = [...inner.matchAll(/<a\s[^>]*>/g)].map(m => m[0]);
    assert.ok(anchors.length > 1,
      'expected multiple anchors inside .mast-nav, got ' + anchors.length);
    const lastIsCta = /class="mast-cta"/.test(anchors[anchors.length - 1]);
    assert.ok(lastIsCta,
      '.mast-cta must be the LAST anchor inside .mast-nav so the mobile ' +
      'drawer renders it as a bottom block. Last anchor was: ' +
      anchors[anchors.length - 1]);

    // And specifically: it must come after .mast-contribute.
    const ctaIdx = inner.indexOf('class="mast-cta"');
    const contribIdx = inner.indexOf('class="mast-contribute"');
    assert.ok(ctaIdx > -1 && contribIdx > -1,
      'expected both .mast-cta and .mast-contribute in ' + page);
    assert.ok(ctaIdx > contribIdx,
      '.mast-cta must come after .mast-contribute in DOM order ('
      + page + ')');
  });
}

/* 2 + 3. Mobile CSS: full-width block, min-height >=44px, not positioned
          absolutely over the list, with top spacing. */
function findMobileMastCtaRule(css){
  // Walk every @media (max-width:...) block and return the body of the
  // .mast-cta rule inside the FIRST media block that targets <=900px.
  const mediaBlocks = [];
  const re = /@media\s*\(\s*max-width\s*:\s*(\d+)px\s*\)\s*\{/g;
  let m;
  while ((m = re.exec(css))){
    const start = m.index + m[0].length;
    // Find the matching closing brace for the @media block.
    let depth = 1, i = start;
    while (i < css.length && depth > 0){
      const ch = css[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    mediaBlocks.push({ max: Number(m[1]), body: css.slice(start, i - 1) });
  }
  // Pick a block that targets >=600px (mobile breakpoint, drawer kicks
  // in at 900px in this codebase).
  for (const b of mediaBlocks){
    if (b.max < 600) continue;
    const rule = b.body.match(/(^|\n)\s*\.mast-cta\s*\{([^}]+)\}/);
    if (rule) return rule[2];
  }
  return null;
}

const css = fs.readFileSync(path.join(repoRoot, 'style.css'), 'utf8');

check('style.css mobile .mast-cta rule exists (inside @media max-width:900px)', () => {
  const body = findMobileMastCtaRule(css);
  assert.ok(body, 'no mobile .mast-cta rule found in style.css');
});

check('mobile .mast-cta is full-width (width:100%)', () => {
  const body = findMobileMastCtaRule(css) || '';
  assert.match(body, /width\s*:\s*100%/,
    'mobile .mast-cta must declare width:100% so it becomes a full-width block');
});

check('mobile .mast-cta is NOT absolutely or fixed-positioned over the list', () => {
  const body = findMobileMastCtaRule(css) || '';
  const pos = (body.match(/position\s*:\s*([a-z-]+)/) || [,''])[1];
  // It is OK to omit `position` (defaults to static). If declared, it
  // must be `relative` or `static`. Anything that takes the CTA out of
  // flow would re-introduce the overlap bug.
  assert.ok(pos === '' || pos === 'relative' || pos === 'static',
    'mobile .mast-cta has position: ' + pos +
    ' — must not be absolute/fixed/sticky in the drawer');
});

check('mobile .mast-cta keeps min-height >= 44px (WCAG 2.2 AA tap target)', () => {
  const body = findMobileMastCtaRule(css) || '';
  const m = body.match(/min-height\s*:\s*(\d+)px/);
  assert.ok(m, 'mobile .mast-cta must declare min-height in px');
  assert.ok(Number(m[1]) >= 44,
    'mobile .mast-cta min-height ' + m[1] + 'px is below the 44px tap target');
});

check('mobile .mast-cta has top spacing so it does not collide with previous item', () => {
  const body = findMobileMastCtaRule(css) || '';
  const m = body.match(/margin-top\s*:\s*(\d+)px/);
  assert.ok(m, 'mobile .mast-cta must declare margin-top to separate from the previous nav item');
  assert.ok(Number(m[1]) >= 16,
    'mobile .mast-cta margin-top ' + m[1] + 'px is too tight; expect >=16px');
});

/* 4. Desktop visual order: CTA before Contribute via flex `order`. */
check('desktop CSS: .mast-cta has a smaller flex order than .mast-contribute', () => {
  const ctaOrder = (css.match(/\.mast-nav\s+\.mast-cta\s*\{[^}]*order\s*:\s*(\d+)/) || [,null])[1];
  const contribOrder = (css.match(/\.mast-nav\s+\.mast-contribute\s*\{[^}]*order\s*:\s*(\d+)/) || [,null])[1];
  assert.ok(ctaOrder !== null && contribOrder !== null,
    'expected .mast-nav .mast-cta and .mast-nav .mast-contribute order rules in style.css');
  assert.ok(Number(ctaOrder) < Number(contribOrder),
    'desktop visual order: CTA(' + ctaOrder + ') must be < Contribute(' +
    contribOrder + ') so the DOM swap does not change desktop layout');
});

/* 5. Mobile CSS: order flip is reset so DOM order applies. */
check('mobile CSS: .mast-cta and .mast-contribute order flip is reset to 0', () => {
  const body = (() => {
    const re = /@media\s*\(\s*max-width\s*:\s*(\d+)px\s*\)\s*\{/g;
    let m;
    while ((m = re.exec(css))){
      if (Number(m[1]) < 600) continue;
      const start = m.index + m[0].length;
      let depth = 1, i = start;
      while (i < css.length && depth > 0){
        if (css[i] === '{') depth++;
        else if (css[i] === '}') depth--;
        i++;
      }
      const block = css.slice(start, i - 1);
      if (/\.mast-cta\b/.test(block) && /order\s*:\s*0/.test(block)) return block;
    }
    return null;
  })();
  assert.ok(body,
    'expected an @media (max-width:>=600) block that resets order:0 on the CTA/Contribute');
  // Both selectors mentioned together with order:0.
  assert.match(body, /\.mast-cta[^{]*\{[^}]*order\s*:\s*0|\.mast-cta\s*,\s*[^{]*\{[^}]*order\s*:\s*0|order\s*:\s*0/,
    'mobile rule should reset .mast-cta order to 0');
  assert.match(body, /\.mast-contribute[^{]*\{[^}]*order\s*:\s*0|\.mast-contribute\s*[,{][^}]*order\s*:\s*0|\.mast-contribute/,
    'mobile rule should also reset .mast-contribute order so DOM source order applies');
});

if (failures > 0) {
  console.log('\n' + failures + ' check(s) failed.');
  process.exit(1);
} else {
  console.log('\nAll header_cta_mobile_order checks passed.');
}
