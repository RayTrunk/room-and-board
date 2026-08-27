// ---------- the power tittle's placement probe ----------
// The standalone wordmark (.imark--led) wears the IEC 5009 power symbol where
// the i's dot goes, drawn as a mask over a cover disc; info.css carries the
// full construction and the reasoning behind every part of it.
// Placing it needs numbers that belong to the RENDERED FACE rather than to the
// design: where the baseline sits inside the inline box, where the letter's own
// tittle sits above that baseline, and where the stem's top and centre are (the
// ring hangs midway down the gap between tittle and stem, so both ends of that
// gap are measurements, not constants).
// One stack apart (Helvetica Neue, which is what Chrome resolves on the guide,
// against the generic sans one entry further down) the baseline alone moves
// 0.045em, which is 2.9px of misplaced mark at the masthead's 64px, so no
// single static offset serves them. The stylesheets ship the Helvetica Neue
// numbers as var() fallbacks and this probe replaces them with the truth for
// the face that actually loaded; info.css tabulates all of them.
//
// TWO CONSUMERS, ONE MODULE. The guide's masthead h1 (js/info.js) and the
// board's welcome card (js/main.js) both wear the standalone form, on two
// different faces: a desktop browser resolves Helvetica Neue or SF, and a Board
// Pro resolves CiscoSansTT, which nothing in this repo has ever measured. That
// is precisely the case the probe exists for, and duplicating it per page would
// be two copies of 150 lines drifting apart over a mark that must be one mark.
//
// It is a progressive enhancement and must stay one. A DOM with no layout
// (happy-dom) and a browser with no canvas both leave fallbacks standing,
// which is a correct wordmark, only not a per-face one: everything below
// feature-detects, sanity-checks its own answer, and publishes each number it
// believes and nothing it does not. THE TWO MEASUREMENTS PUBLISH SEPARATELY
// (2026-08-26): the baseline needs only layout, the ink scan also needs a
// canvas it can read back, and those fail separately. The first stance here
// was all-or-nothing, on the theory that one real number under six static ones
// is worse than seven static ones; the Desk Pro wore the refutation. The six
// scan numbers are offsets FROM the baseline and vary a little across faces,
// while the baseline itself is where the whole construction hangs and varies a
// lot (the Helvetica Neue fallback is 0.965em; the welcome card's face on a
// Desk Pro renders visibly lower), so a panel whose canvas cannot answer but
// whose layout can still gets the mark hung off the true baseline, with only
// the ink offsets assumed. Silence remains the answer for a number that fails
// its own sanity check.

const SCAN_PX = 200; // ink-scan at 200px, so one scanned pixel is 1/200 em
const SCAN_H = SCAN_PX * 2;
const SCAN_PEN = SCAN_PX * 0.25; // the pen sits in from the edge: no side bearing can clip
const SCAN_BASE = SCAN_PX * 1.5; // ...and the whole ascender fits above the baseline
const INK = 32; // alpha over this is ink; under it is the antialiased skirt

// The rendered face's own "i", scanned: the tittle's box and the stem's centre,
// in em off the pen origin and the baseline. null whenever the environment
// cannot answer, or answers with something that is not a dotted i.
function scanTittle(cs) {
  try {
    const cv = document.createElement('canvas');
    cv.width = SCAN_PX;
    cv.height = SCAN_H;
    const ctx = cv.getContext?.('2d');
    if (!ctx || typeof ctx.fillText !== 'function') return null;
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${SCAN_PX}px ${cs.fontFamily}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff';
    ctx.fillText('i', SCAN_PEN, SCAN_BASE);
    const px = ctx.getImageData(0, 0, SCAN_PX, SCAN_H)?.data;
    if (!px) return null;

    // One pass down the bitmap, keeping each inked row's left and right extreme.
    const rows = [];
    for (let y = 0; y < SCAN_H; y++) {
      let lo = -1;
      let hi = -1;
      for (let x = 0; x < SCAN_PX; x++) {
        if (px[(y * SCAN_PX + x) * 4 + 3] > INK) {
          if (lo < 0) lo = x;
          hi = x;
        }
      }
      rows.push(lo < 0 ? null : [lo, hi]);
    }
    // A dotted "i" is two pieces with clear air between them. A face that draws
    // them joined, or draws nothing, is not one this construction can place, so
    // say so instead of guessing at a tittle that is not there.
    const top = rows.findIndex(Boolean);
    if (top < 0) return null;
    let gap = top;
    while (gap < SCAN_H && rows[gap]) gap++;
    let stem = gap;
    while (stem < SCAN_H && !rows[stem]) stem++;
    if (gap >= SCAN_H || stem >= SCAN_H) return null;

    // Pixel EDGES, not indices: a row spanning columns 3..7 covers x 3 to 8.
    const box = (from, to) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let y = from; y < to; y++) {
        if (!rows[y]) continue;
        lo = Math.min(lo, rows[y][0]);
        hi = Math.max(hi, rows[y][1] + 1);
      }
      return [lo, hi];
    };
    const [tl, tr] = box(top, gap);
    const [sl, sr] = box(stem, SCAN_H);
    const em = (v) => v / SCAN_PX;
    return {
      tx: em((tl + tr) / 2 - SCAN_PEN),
      ty: em(SCAN_BASE - (top + gap) / 2),
      tb: em(SCAN_BASE - gap),
      // The stem's top, which is the other end of the gap the ring is hung in.
      st: em(SCAN_BASE - stem),
      // 1.3x the tittle's larger dimension: a disc that only just spans the ink
      // leaves its antialiased skirt showing round the cover's own edge.
      td: 1.3 * Math.max(em(tr - tl), em(gap - top)),
      sx: em((sl + sr) / 2 - SCAN_PEN),
    };
  } catch {
    return null; // no canvas, or a tainted/blocked one: the fallbacks stand
  }
}

// An empty inline-block's bottom margin edge IS its baseline, so a zero-height
// one dropped into the word reports where the line's baseline actually landed.
// BOTH RECTS ARRIVE IN VISUAL COORDINATES, AND ON A DESKTOP THOSE ARE NOT
// LAYOUT PIXELS: util.js's fitViewport lays a zoom on <html> to fit the fixed
// 1920 page into whatever window is watching, and getBoundingClientRect
// multiplies by it while the computed font-size does not. Dividing across the
// two spaces is how the welcome mark shipped ~7.5px high on every desktop
// preview (2026-08-26: base read 0.8611 in a 1710px window, which is the true
// 0.9664 times the 0.891 of zoom). So the em is measured with the same ruler
// the baseline is: the probe is 1em wide, and its own rect width is the
// denominator, zoomed exactly as the numerator is. Width, not height, because
// a baseline-aligned box a full em tall can grow the line box and move the
// very baseline it is reading.
// The probe carries no text, so textContent stays exactly "idlescreen" while
// it is in there, and the finally is what guarantees it leaves again: this
// construction exists to keep the DOM holding the plain word, and a probe
// stranded inside the mark by a throw would be a worse bug than a misplaced
// dot.
function probeBaseline(el) {
  const probe = document.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'display:inline-block;width:1em;height:0';
  el.appendChild(probe);
  try {
    const r = probe.getBoundingClientRect();
    if (!(r.width > 0)) return 0; // no layout (happy-dom): unmeasurable, not 0/0
    return (r.bottom - el.getBoundingClientRect().top) / r.width;
  } finally {
    probe.remove();
  }
}

// Measure the face `host` rendered and publish the answer as custom properties
// ON `host`, which is any element containing the mark: the vars inherit down to
// the pseudo-elements that read them. Silent on every environment that cannot
// answer; that silence is the no-JS state, and it is a correct one.
export function placeTittle(host) {
  const idle = host?.querySelector?.('.imark--led .imark__idle');
  if (!idle) return;
  const cs = window.getComputedStyle?.(idle);
  const size = parseFloat(cs?.fontSize);
  if (!size) return;
  let base = 0;
  try {
    base = probeBaseline(idle);
  } catch {
    return;
  }
  // Sanity, not superstition. Every value here is a fraction of an em with a
  // known neighbourhood across every face a browser can hand us; one outside it
  // means the measurement measured something else (no layout, a fallback face
  // that never loaded, a canvas that returned an empty bitmap), and a mark
  // placed off a wrong number is worse than one placed off the sheet's default.
  if (!(base > 0.6 && base < 1.4)) return;
  // The baseline publishes on its own, ahead of the scan: it is the number the
  // whole construction hangs from, it needs nothing but layout to measure, and
  // a panel whose canvas cannot answer (the module comment has the Desk Pro
  // account) is exactly the panel whose face the static baseline is wrong for.
  host.style.setProperty('--im-base', base.toFixed(4));
  const m = scanTittle(cs);
  if (!m) return;
  const ok =
    m.ty > 0.4 && m.ty < 0.95 &&
    m.tb > 0.35 && m.tb < m.ty &&
    m.st > 0.25 && m.st < m.tb &&
    m.td > 0.02 && m.td < 0.4 &&
    m.tx > -0.1 && m.tx < 0.5 &&
    m.sx > -0.1 && m.sx < 0.5;
  if (!ok) return;
  host.style.setProperty('--im-tx', m.tx.toFixed(4));
  host.style.setProperty('--im-ty', m.ty.toFixed(4));
  host.style.setProperty('--im-tb', m.tb.toFixed(4));
  host.style.setProperty('--im-st', m.st.toFixed(4));
  host.style.setProperty('--im-td', m.td.toFixed(4));
  host.style.setProperty('--im-sx', m.sx.toFixed(4));
}

// Once now, for the face the first paint uses, and again when the web font
// lands and every one of these numbers changes under it. Nothing is bound to
// resize, because every answer is em-relative and survives the clamp. The one
// exception is harmless and worth naming: --im-base is read off an inline box
// the browser has rounded to whole pixels, so it comes back 0.9688 at 64px and
// 0.9737 at 38px. Carrying one across a resize costs about a fifth of a pixel.
// The fonts.ready callback is WRAPPED rather than passed: `.then(placeTittle)`
// would hand the resolved FontFaceSet in as the host and place nothing.
export function trackTittle(host) {
  if (!host) return;
  placeTittle(host);
  document.fonts?.ready?.then?.(() => placeTittle(host))?.catch?.(() => {});
}
