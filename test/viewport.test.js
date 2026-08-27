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
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OVERLAY_BODY_H, BOARD_VIEWPORT_H } from '../site/js/expand.js';
import { registeredSurfaces } from '../site/js/surfaces.js';
// Loading a surface's module is how it signs the register, so the inventory
// below is only complete with all seven owners in hand (expand.js is above).
import '../site/js/textviewer.js';
import '../site/js/imageshow.js';
import '../site/js/screensaver.js';
import '../site/js/widgets/iptv.js';
import '../site/js/settings/settings.js';
import { blockZoomGestures } from '../site/js/zoomguard.js';

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
// PAGE px, every one of them: the height of the page box each device can show.
// On a device that fitViewport has zoomed, that is NOT the same number as the
// viewport height the engine reports — a Navigator measured 1280x800 of glass on
// 2026-08-27, which is these 1920x1200 page px at the 0.667 fit. Anything
// comparing a raw viewport unit against one of these is comparing two rulers.
const BOARD = 1040;      // Cisco Board Pro / Desk Pro (the bar sits BELOW this)
const DESKTOP = 1080;    // the browser preview a change is authored in
const NAVIGATOR = 1200;  // Cisco Room Navigator (PWA), = 800 glass px at 0.667
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
    // measured fit backstop (only subway fits itself on open), so a canvas that
    // grew on a Navigator would be unverified layout there — exactly the
    // ongoing per-device test burden this file exists to prevent. The models
    // get the floor; the 160px a Navigator has spare stays unspent.
    expect(BOARD_VIEWPORT_H).toBe(BOARD);
    expect(OVERLAY_BODY_H).toBe(814);
    expect(Math.min(...VIEWPORTS)).toBe(BOARD_VIEWPORT_H);
  });
});

describe('the page cannot be zoomed, and the fix is not in the viewport meta', () => {
  // A pinch on a live board zoomed the dashboard to ~200%. Browser zoom is
  // engine state, so it outlived the reload Save does after a layout edit and
  // the board stayed unusable until a person undid it by hand. Two halves,
  // pinned here together because either one alone leaves a way in.

  it('refuses pinch-zoom at the root while still allowing panning', () => {
    // Touch behaviour is the intersection of the touched element's touch-action
    // with every ancestor's, so the root is where a document-wide refusal goes.
    const value = decl('html, body', 'touch-action', bare);
    const tokens = value.split(/\s+/);
    expect(tokens).not.toContain('pinch-zoom');
    expect(tokens).not.toContain('auto');
    // NOT `manipulation`: it still carries pinch-zoom, it only gives up
    // double-tap zoom. NOT `none`: it would take panning with it and the
    // settings rail and the reading views scroll to be read.
    expect(tokens).not.toContain('manipulation');
    expect(tokens).not.toContain('none');
    expect(tokens).toContain('pan-x');
    expect(tokens).toContain('pan-y');
  });

  it.each(['.slideshow', '.edit-block', '.edit-handle', '.tk-grip'])(
    'leaves %s claiming every touch that starts on it', (sel) => {
      // These claim their own touches outright: the swipe classifier and the
      // drag/resize pointer handlers only run if the browser never arbitrates.
      // Intersecting none with the root's pan-x pan-y is still none, so the
      // root rule cannot have weakened them; this asserts they were not
      // "simplified" away into it either.
      expect(decl(sel, 'touch-action', bare)).toBe('none');
    });

  it('centres the page in page px, not in raw viewport px (regression: 2026-08-27)', () => {
    // The rule that had never fired: on a Room Navigator (1280x800 of glass at
    // zoom 0.667) `100dvh` reads 800 against a 1080px page and clamps to 0,
    // while the page's true visible height is 800/0.667 = 1199. Both sides have
    // to be in the same ruler, and --fit-zoom (published by fitViewport) is the
    // only thing that converts one into the other.
    expect(decl('body', 'top', bare), 'the centring sum compares raw viewport px against page px')
      .toContain('var(--fit-zoom');
    // …and the other end of that wire, which no stylesheet assertion can see.
    expect(read('../site/js/util.js'), 'nothing publishes --fit-zoom any more')
      .toContain("setProperty?.('--fit-zoom'");
  });

  it('pins the page scale, and leaves the fit to JS (regressions: 2026-07-25 AND 2026-08-26)', () => {
    // The landmine, and it has a live mine on BOTH sides now. Two devices pull
    // this one tag in opposite directions and only the pair of fixes is safe:
    //
    //   2026-07-25, Room Navigator. `initial-scale=1` pins 1:1 on every device,
    //     so a panel with 1280 of glass rendered only the top-left ~1280px of
    //     the 1920 page and needed a pinch to read. It was dropped, and the
    //     engine's own shrink-to-fit did the fitting instead.
    //   2026-08-26, Board Pro. That shrink-to-fit picks a scale of exactly 2
    //     (== devicePixelRatio) on the RoomOS in-place reload path, so EVERY
    //     location.reload() this app does brought the board back magnified 2x
    //     with a quarter of the content visible. Measured over CDP on a Desk
    //     Pro G2; docs/signage-zoom-bug.md.
    //
    // So the engine gets no discretion here, and fitViewport() does the fitting
    // from the visual viewport. Deleting either half restores one of the bugs.
    const html = read('../site/index.html');
    const meta = /<meta\s+name="viewport"\s+content="([^"]*)"/i.exec(html);
    expect(meta, 'no viewport meta in index.html').not.toBeNull();
    const tokens = meta[1].split(',').map((t) => t.trim());
    expect(tokens).toContain('width=1920');      // the fixed layout box, a constant
    expect(tokens).toContain('initial-scale=1'); // the 2026-08-26 fix itself
    expect(tokens).toContain('maximum-scale=1'); // second lock: initial scale clamps to it
    // `device-width` would hand the engine back the very quantity it gets wrong
    // on the reload path. `minimum-scale` would forbid the shrink a small panel
    // may still legitimately want from the engine.
    expect(meta[1]).not.toContain('device-width');
    expect(meta[1]).not.toContain('minimum-scale');
    // And the other half has to still be there: with the scale pinned and
    // nothing measuring the glass, this tag IS the 2026-07-25 regression. The
    // behaviour of that measurement is pinned in misc-widgets.test.js.
    expect(read('../site/js/util.js'), 'fitViewport no longer reads the visual viewport')
      .toContain('visualViewport');
  });
});

describe('the zoom guard blocks the pointer paths CSS cannot reach', () => {
  // touch-action says nothing about a wheel or a WebKit gesture event, and a
  // Desk or a Navigator can have a trackpad paired to it.
  const wheel = (ctrlKey) => {
    // happy-dom's WheelEvent extends UIEvent, where a real engine's extends
    // MouseEvent, so it silently drops ctrlKey out of the init dict and every
    // wheel event it builds reads `undefined`. Set it on the instance instead:
    // the listener reads the same property either way, and the browser check
    // in the ship notes covers the real engine.
    const e = new window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 });
    Object.defineProperty(e, 'ctrlKey', { value: ctrlKey });
    window.dispatchEvent(e);
    return e;
  };

  beforeAll(() => blockZoomGestures(window));

  it('prevents ctrl+wheel, which is how a trackpad pinch arrives', () => {
    expect(wheel(true).defaultPrevented).toBe(true);
  });

  it('leaves a plain wheel alone, so the overlays still scroll', () => {
    // The half that would go unnoticed: a guard that ate every wheel event
    // would make the settings rail and the reading views unscrollable.
    expect(wheel(false).defaultPrevented).toBe(false);
  });

  it('prevents the WebKit gesture events too, whatever engine RoomOS ships', () => {
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      const e = new window.Event(type, { bubbles: true, cancelable: true });
      window.dispatchEvent(e);
      expect(e.defaultPrevented, type).toBe(true);
    }
  });

  it('is a no-op on a target that cannot listen, rather than a boot crash', () => {
    // It runs as top-level setup in main.js, ahead of the __signageLoaded flag
    // bootguard.js watches. A throw here would look like a broken deploy.
    expect(() => blockZoomGestures(undefined)).not.toThrow();
    expect(() => blockZoomGestures({})).not.toThrow();
  });
});

describe('the page block centres in a taller viewport, and cannot move a board', () => {
  const top = decl('body', 'top');

  it('is clamped at zero so 1040 and 1080 are untouched to the pixel', () => {
    // Parsed out of the stylesheet and re-computed, rather than eyeballed: the
    // clamp is the entire safety argument for shipping this to live boards.
    // The `/ var(--fit-zoom, 1)` is what puts the left-hand side in page px, so
    // that NAVIGATOR's 1200 below is a quantity this sum can actually see. It
    // was missing until 2026-08-27, and without it the rule had never fired on
    // the one device it was written for.
    const m = /^max\(\s*0px\s*,\s*calc\(\s*\(\s*100dvh\s*\/\s*var\(--fit-zoom,\s*1\)\s*-\s*(\d+)px\s*\)\s*\/\s*2\s*\)\s*\)$/.exec(top);
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

  it('is the same seven the surfaces register knows', () => {
    // The stylesheet names a surface by its block class and the register by the
    // handle the JS actually toggles: same seven things, two vocabularies. The
    // pairing is written out so the two lists cannot drift, which is exactly
    // how the register's predecessor went wrong (a three-id allow-list in
    // util.js, still three ids four surfaces later).
    const PAIRS = {
      '.ambient': '#ambient',
      '.art-viewer': '#art-viewer',
      '.expand': '#expand-view',
      '.text-viewer': '#text-viewer',
      '.ss-preview': '.ss-preview',
      '.iptv.iptv--full': '.iptv--full',
      '.displaytest': '.displaytest',
    };
    expect(Object.keys(PAIRS).sort()).toEqual([...FULL_SCREEN].sort());
    expect(Object.values(PAIRS).sort())
      .toEqual(registeredSurfaces().map((s) => s.selector).sort());
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

describe('the settings rail keeps its footer on a board’s glass', () => {
  // The rail is a PAGE citizen: it is 1080px tall whatever the device shows.
  // On a Board Pro the glass stops at 1040, so the bottom 40px of that rail is
  // simply never seen, and the rail's bottom padding is what keeps Save,
  // Cancel and the What's new entry above the cut. The stylesheet used to
  // credit that number to Cisco's bar "overlaying" the page; the bar does no
  // such thing (see above), but the number it produced is exactly the
  // page-minus-glass strip, so it survived the correction unchanged. This is
  // the guard that stops someone reading the retired bar model as spare room.
  const shorthand = decl('.settings__rail', 'padding', bare).split(/\s+/);

  it('reserves at least the page a board never shows', () => {
    expect(shorthand).toHaveLength(3); // top | inline | bottom
    expect(px(shorthand[2])).toBeGreaterThanOrEqual(DESKTOP - BOARD);
  });

  it('scrolls the nav and never the footer', () => {
    // Everything pinned (the brand, Save/Cancel, the What's new entry) must sit
    // outside the scrolling box, or growing Settings starts hiding its own
    // primary action.
    expect(decl('.settings__nav', 'overflow-y')).toBe('auto');
    expect(decl('.settings__nav', 'flex')).toBe('1');
    expect(decl('.settings__railfoot', 'flex')).toBe('none');
    expect(decl('.settings__brand', 'flex')).toBe('none');
  });

  it('holds the What’s new entry to one line', () => {
    // The rail's content box is 270 − 24 − 24 = 222px. A second line there
    // costs the nav 24px, which is most of the slack the 15th nav row leaves —
    // so the line is pinned to one and a regression overhangs visibly instead
    // of quietly pushing a nav row off the bottom.
    expect(decl('.settings__wnline', 'white-space')).toBe('nowrap');
    expect(px(decl('.settings__whatsnew', 'min-height'))).toBeGreaterThanOrEqual(44);
  });
});
