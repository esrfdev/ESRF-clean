// Test: mobile drawer scrolling + Variant A CTA reachability.
//
// After the 2026-04-27 anchor-CTA-at-bottom fix, real users on short
// phones reported that the open mobile menu would not scroll, leaving
// the Variant A command card cut off at the bottom of the viewport.
//
// Root cause guarded here:
//   * .mast-nav (the open drawer) must declare overflow-y:auto so the
//     panel scrolls when its content is taller than the viewport.
//   * .mast-nav must NOT declare overflow:hidden, overflow-y:hidden, or
//     a fixed `height` that clips the CTA — only height-bounding via
//     `max-height: 100vh|100dvh` is allowed.
//   * .mast-nav must declare a max-height anchored to the viewport
//     (100vh or 100dvh) so scroll is meaningful even when iOS Safari's
//     dynamic chrome shrinks the visible area. We require at least one
//     of `100vh` / `100dvh` to appear in the rule.
//   * .mast-nav must declare overscroll-behavior so scroll attempts
//     inside the locked-body drawer don't bubble to <body> (which would
//     make the drawer feel un-scrollable).
//   * .mast-nav padding-bottom must be generous enough (>=64px) that
//     the CTA, sitting as the last child, never sits flush against the
//     viewport edge / iOS Safari bottom bar.
//   * .mast-cta on mobile must NOT shrink below its 56px tap target
//     when the column overflows: it must declare flex-shrink:0 (or
//     equivalent) so the CTA stays clickable even after scrolling.
//   * .mast-cta on mobile must remain a full-width, in-flow block — not
//     position:absolute/fixed/sticky — so it sits at the BOTTOM of the
//     scrollable column, visible after the user scrolls down.
//   * Cache-buster on style.css must be the post-fix value so visitors
//     holding pre-fix HTML revalidate.
//
// Run with: node scripts/header_cta_mobile_drawer_scroll.test.mjs

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

const css = fs.readFileSync(path.join(repoRoot, 'style.css'), 'utf8');

/* Helper: pick the body of a selector inside the first @media block whose
   max-width is >=600 (the mobile drawer kicks in at 900px). */
function findMobileRule(css, selectorRegex){
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
    const rule = block.match(selectorRegex);
    if (rule) return rule[rule.length - 1];
  }
  return null;
}

/* 1. .mast-nav declares overflow-y:auto. */
check('mobile .mast-nav declares overflow-y:auto', () => {
  const body = findMobileRule(css, /(^|\s)\.mast-nav\s*\{([^}]+)\}/);
  assert.ok(body, 'no mobile .mast-nav rule found');
  assert.match(body, /overflow-y\s*:\s*auto/,
    '.mast-nav must declare overflow-y:auto so the drawer scrolls when content overflows');
});

/* 2. .mast-nav does NOT declare overflow:hidden / overflow-y:hidden, and
      does NOT pin a fixed `height` (which would clip the CTA). */
check('mobile .mast-nav does not pin height or hide overflow on Y', () => {
  const body = findMobileRule(css, /(^|\s)\.mast-nav\s*\{([^}]+)\}/) || '';
  // overflow:hidden on its own would hide vertical scroll. overflow-x is fine.
  const overflows = [...body.matchAll(/(^|\s|;)overflow\s*:\s*([a-z-]+)/g)].map(m => m[2]);
  for (const v of overflows){
    assert.ok(v !== 'hidden',
      '.mast-nav must not declare overflow:hidden — it kills the scroll');
  }
  const yHidden = /overflow-y\s*:\s*hidden/.test(body);
  assert.ok(!yHidden, '.mast-nav must not declare overflow-y:hidden');
  // A fixed `height` (not max-height) would clip the CTA when content
  // overflows. We only allow `max-height` for viewport bounding.
  const heightDecl = body.match(/(^|;|\s)height\s*:\s*[^;]+/);
  assert.ok(!heightDecl,
    '.mast-nav must not declare a fixed `height` — use max-height:100dvh instead so content can scroll');
});

/* 3. .mast-nav max-height is anchored to the viewport (100vh / 100dvh). */
check('mobile .mast-nav max-height is viewport-anchored (100vh or 100dvh)', () => {
  const body = findMobileRule(css, /(^|\s)\.mast-nav\s*\{([^}]+)\}/) || '';
  assert.match(body, /max-height\s*:\s*100(?:d?vh)/,
    '.mast-nav must declare max-height:100vh (or 100dvh) so the drawer is bounded by the visible viewport, not its content');
});

/* 4. .mast-nav declares overscroll-behavior to isolate from body lock. */
check('mobile .mast-nav declares overscroll-behavior to isolate scroll', () => {
  const body = findMobileRule(css, /(^|\s)\.mast-nav\s*\{([^}]+)\}/) || '';
  assert.match(body, /overscroll-behavior(?:-y)?\s*:\s*(?:contain|none)/,
    '.mast-nav must declare overscroll-behavior:contain so scroll inside the drawer does not bubble to <body> (which is locked)');
});

/* 5. .mast-nav has generous padding-bottom (>=64px) so the CTA, as the
      last item, does not sit flush against the viewport edge / iOS
      Safari bottom bar. */
check('mobile .mast-nav padding-bottom is generous (>=64px)', () => {
  const body = findMobileRule(css, /(^|\s)\.mast-nav\s*\{([^}]+)\}/) || '';
  // padding shorthand: padding:T R/H B L?  We accept either shorthand or
  // an explicit padding-bottom.
  let bottom = null;
  const pb = body.match(/padding-bottom\s*:\s*(\d+)px/);
  if (pb) bottom = Number(pb[1]);
  else {
    const sh = body.match(/padding\s*:\s*([^;]+)/);
    if (sh){
      const parts = sh[1].trim().split(/\s+/).map(s => s.replace('px','').trim());
      // 1: all, 2: V H, 3: T H B, 4: T R B L
      if (parts.length === 1) bottom = Number(parts[0]);
      else if (parts.length === 2) bottom = Number(parts[0]);
      else if (parts.length >= 3) bottom = Number(parts[2]);
    }
  }
  assert.ok(bottom !== null && !Number.isNaN(bottom),
    'could not parse padding-bottom from .mast-nav');
  assert.ok(bottom >= 64,
    '.mast-nav padding-bottom is ' + bottom + 'px; expected >=64px so the CTA is not flush against the bottom edge / iOS chrome');
});

/* 6. .mast-cta on mobile declares flex-shrink:0 so the 56px tap target
      is never squeezed when the column overflows. */
check('mobile .mast-cta declares flex-shrink:0 to preserve tap target', () => {
  const body = findMobileRule(css, /(^|\s)\.mast-cta\s*\{([^}]+)\}/) || '';
  assert.ok(body, 'no mobile .mast-cta rule found');
  assert.match(body, /flex-shrink\s*:\s*0/,
    'mobile .mast-cta must declare flex-shrink:0 so it cannot be compressed below 56px when the drawer overflows');
});

/* 7. .mast-cta on mobile is in-flow (not absolute/fixed/sticky) and
      full-width — i.e. it sits at the BOTTOM of the scrollable list. */
check('mobile .mast-cta is in-flow and full-width (sits at end of column)', () => {
  const body = findMobileRule(css, /(^|\s)\.mast-cta\s*\{([^}]+)\}/) || '';
  const pos = (body.match(/position\s*:\s*([a-z-]+)/) || [,''])[1];
  assert.ok(pos === '' || pos === 'relative' || pos === 'static',
    'mobile .mast-cta has position: ' + pos +
    ' — must be in-flow so it sits at the end of the scrollable column');
  assert.match(body, /width\s*:\s*100%/,
    'mobile .mast-cta must be width:100% (full-width block at end of column)');
});

/* 8. Cache-buster on style.css must be post-fix. */
check('cache-buster on style.css is post-fix (20260427-mobile-drawer-scroll)', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  assert.match(html, /style\.css\?v=20260427-mobile-drawer-scroll/,
    'index.html must reference style.css?v=20260427-mobile-drawer-scroll so visitors revalidate after the fix');
});

if (failures > 0) {
  console.log('\n' + failures + ' check(s) failed.');
  process.exit(1);
} else {
  console.log('\nAll header_cta_mobile_drawer_scroll checks passed.');
}
