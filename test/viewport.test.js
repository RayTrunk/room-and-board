/**
 * @vitest-environment happy-dom
 *
 * The page/viewport contract, pinned.
 *
 * RoomBoard lays out in TWO coordinate systems and the whole class of bugs this
 * file guards against comes from confusing them:
 *
 *   the PAGE      a fixed 1920x1080 box (main.css html/body). The dashboard
 *                 grid, the editor and the settings overlay live here. Every
 *                 capacity number in js/capacity.js was measured against it,
 *                 which is precisely why those tables are the same on a 1040
 *                 Board Pro, a 1200 Room Navigator and an 1080 desktop preview
 *                 and why a new widget is verified ONCE, in a browser, not on a
 *                 per-device matrix.
 *   the VIEWPORT  whatever glass the device actually hands us. Only the
 *                 full-bleed contexts — the ambient screensaver and every
 *                 tap-opened full-screen overlay — are sized by it, and they do
 *                 it by being position:fixed rather than by asking what device
 *                 this is.
 *
 * Nothing at runtime re-checks the split, so it is checked here. happy-dom has
 * no layout engine, so (as in overlay-chrome.test.js) the stylesheet is read
 * back as text and the rules are asserted directly.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OVERLAY_BODY_H, BOARD_VIEWPORT_H } from '../site/js/expand.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');
const css = read('../site/css/main.css');
// Comments carry plenty of prose about vh and viewports; strip them so the
// scans below see declarations only. Replaced by a space, not deleted, so no
// two tokens are accidentally glued together.
const bare = css.replace(/\/\*[\s\S]*?\*\//g, ' ');

// The body of a rule, by exact selector. Deliberately literal, same idiom as
// overlay-chrome.test.js: renaming or splitting a rule throws rather than
// silently passing.
function rule(selector, src = css) {
  const at = src.indexOf(`\n${selector} {`);
  expect(at, `no rule for "${selector}" in main.css`).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf('}', at));
}
function decl(selector, prop, src = css) {
  const m = rule(selector, src).match(new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;}]+)`));
  expect(m, `no ${prop} in "${selector}"`).not.toBeNull();
  return m[1].trim();
}
const px = (v) => {
  const n = Number.parseFloat(v);
  expect(Number.isFinite(n), `not a number: ${v}`).toBe(true);
  return n;
};

// Every supported viewport HEIGHT, measured on-device 2026-07-28/29. Width is
// 1920 on all three, which is why only the height is ever in question.
const BOARD = 1040;      // Cisco Board Pro / Desk Pro (the bar sits BELOW this)
const DESKTOP = 1080;    // the browser preview a change is authored in
const NAVIGATOR = 1200;  // Cisco Room Navigator (PWA)
const VIEWPORTS = [BOARD, DESKTOP, NAVIGATOR];

describe('the dashboard canvas is viewport-INDEPENDENT', () => {
  it('keeps the page a fixed 1920x1080 box', () => {
    expect(px(decl('html, body', 'width'))).toBe(1920);
    expect(px(decl('html, body', 'height'))).toBe(1080);
    expect(decl('html, body', 'overflow')).toBe('hidden');
  });

  it('uses a viewport LENGTH unit in exactly one place, and it is not the grid', () => {
    // The guard that matters most. A future "just make the grid taller on a
    // Navigator" would land here as a vh/dvh somewhere in the dashboard rules,
    // and it must not: it would make every capacity table, every widget
    // minimum and every fit audit device-dependent, i.e. it would put a live
    // Room Navigator into the test loop for every future widget forever.
    // The ONE sanctioned use is the cosmetic centring of the page block, which
    // moves nothing inside the page.
    const found = new Map();
    const re = /(?<![\w-])\d*\.?\d+(?:vh|vw|dvh|dvw|svh|svw|lvh|lvw|vmin|vmax|vi|vb)(?![\w-])/g;
    for (const m of bare.matchAll(re)) {
      const brace = bare.lastIndexOf('{', m.index);
      const start = Math.max(
        bare.lastIndexOf('}', brace), bare.lastIndexOf('{', brace - 1), bare.lastIndexOf(';', brace),
      );
      const selector = bare.slice(start + 1, brace).trim().replace(/\s+/g, ' ');
      found.set(selector, (found.get(selector) ?? 0) + 1);
    }
    expect([...found.keys()].sort()).toEqual(['body']);
  });

  it('never lets the layout/capacity math ask what device this is', () => {
    // Row tables and fit models read ELEMENT boxes (that is the measured-trim
    // backstop and it is fine). What they must never read is the SCREEN — the
    // moment they do, the same board configuration renders differently on a
    // Navigator and every capacity claim needs re-verifying there.
    const device = /window\.inner|(?<![\w.])innerHeight|(?<![\w.])innerWidth|visualViewport|devicePixelRatio|matchMedia|(?<![\w.])screen\.|documentElement\.client/;
    for (const f of ['capacity.js', 'layout.js', 'expand.js']) {
      const src = read(`../site/js/${f}`).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
      expect(device.test(src), `${f} reads the device`).toBe(false);
    }
  });

  it('models the overlays against the SMALLEST viewport as a constant, not a measurement', () => {
    // Deliberately left alone in the viewport ship: markets' ticker wall has no
    // measured fit backstop (only subway registers an onFit), so a canvas that
    // grew on a Navigator would be unverified layout there — exactly the
    // ongoing per-device test burden this file exists to prevent. The models
    // get the floor; the 160px a Navigator has spare stays unspent.
    expect(BOARD_VIEWPORT_H).toBe(BOARD);
    expect(OVERLAY_BODY_H).toBe(814);
    expect(Math.min(...VIEWPORTS)).toBe(BOARD_VIEWPORT_H);
  });
});

describe('the page block centres in a taller viewport, and cannot move a board', () => {
  const top = decl('body', 'top');

  it('is clamped at zero so 1040 and 1080 are untouched to the pixel', () => {
    // Parsed out of the stylesheet and re-computed, rather than eyeballed: the
    // clamp is the entire safety argument for shipping this to live boards.
    const m = /^max\(\s*0px\s*,\s*calc\(\s*\(\s*100dvh\s*-\s*(\d+)px\s*\)\s*\/\s*2\s*\)\s*\)$/.exec(top);
    expect(m, `body top is not the clamped centring formula: ${top}`).not.toBeNull();
    const page = Number(m[1]);
    expect(page).toBe(px(decl('html, body', 'height')));
    const offset = (h) => Math.max(0, (h - page) / 2);
    expect(offset(BOARD)).toBe(0);
    expect(offset(DESKTOP)).toBe(0);
    expect(offset(NAVIGATOR)).toBe(60);
  });

  it('shifts by painting, not by transforming', () => {
    // A transform on body would become the containing block for every
    // position:fixed overlay and re-anchor the whole full-bleed tier back onto
    // the page this is trying to escape. `position: relative` does not.
    expect(decl('body', 'position')).toBe('relative');
    expect(rule('body')).not.toMatch(/transform|filter|perspective|will-change|contain\s*:/);
  });
});

describe('full-bleed contexts are fixed to the real viewport', () => {
  // Everything that covers the whole screen. The ambient screensaver is the
  // IDLE one; the rest are opened by a tap. All are appended to document.body,
  // so `absolute` would resolve against whatever happens to position body —
  // which is how .art-viewer silently grew 40px past a board's glass the first
  // time body was positioned. `fixed` is the only value that cannot be broken
  // from the outside.
  const FULL_SCREEN = ['.ambient', '.art-viewer', '.expand', '.text-viewer', '.ss-preview',
    '.iptv.iptv--full', '.displaytest'];

  it.each(FULL_SCREEN)('%s is position:fixed', (sel) => {
    expect(decl(sel, 'position')).toBe('fixed');
  });

  it('puts the ambient info band on the last visible pixel, on every device', () => {
    // bottom:0 in a viewport-fixed context. It replaced a --roomos-bar lift
    // that only ever meant "undo the 1080 page on a 1040 board" — the same
    // pixels there, and the right ones on a Navigator, with no device number.
    expect(px(decl('.strip', 'bottom'))).toBe(0);
    expect(rule('.strip', bare)).not.toMatch(/roomos-bar/); // the DECLARATIONS, not the prose above them
    // The gear rides that band, so it is fixed to the same viewport.
    expect(decl('body.mode-ambient .gear', 'position')).toBe('fixed');
  });

  it('leaves the caption clear of the band instead of under it', () => {
    // Both are measured off the same bottom now; before the .ambient fix the
    // caption was on the page and the band on the... also page, but lifted, so
    // the band ate the caption's lower 28px on every board.
    const band = 70; // measured: 18px padding x2 + the 24px/1.4 line box
    expect(px(decl('.slide-caption', 'bottom'))).toBeGreaterThan(band);
  });

  it('keeps the settings preview honest about what the screensaver looks like', () => {
    // .ss-preview has always been viewport-fixed and .clockface had not, so the
    // preview drew its clock 20px off from the thing it was previewing. Same
    // numbers now, and they have to stay the same numbers.
    expect(decl('.clockface', 'bottom')).toBe(decl('.ss-preview .cf', 'bottom'));
    expect(decl('body.has-strip .clockface', 'bottom')).toBe(decl('.ss-preview.has-strip .cf', 'bottom'));
    // …and the strip-on reserve really does clear the band.
    expect(px(decl('body.has-strip .clockface', 'bottom'))).toBeGreaterThan(70);
  });

  it('has retired --roomos-bar everywhere except the one plain margin left', () => {
    // Its old job — "sit flush with the last visible pixel" — is done by the
    // viewport itself now. Anything new that reaches for it is almost certainly
    // re-deriving the device instead of asking the glass.
    const users = [...bare.matchAll(/var\(--roomos-bar\)/g)].map((m) => {
      const brace = bare.lastIndexOf('{', m.index);
      const start = Math.max(bare.lastIndexOf('}', brace), bare.lastIndexOf('{', brace - 1));
      return bare.slice(start + 1, brace).trim().replace(/\s+/g, ' ');
    });
    expect(users).toEqual(['.iptv__mute']);
  });
});
