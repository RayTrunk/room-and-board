import { icon } from './icons.js';
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// THE INVARIANT THE PAGE IS BUILT ON: the layout viewport is the glass.
//
// Every full-bleed surface (the ambient screensaver, the image and story
// viewers, the settings overlay, an expanded card) is sized by being
// position:fixed rather than by asking what device this is, and a fixed element
// sizes to the LAYOUT viewport. Measured in Chrome 2026-08-26: under a 0.891
// zoom on <html>, `position:fixed; inset:0` still renders at the full 1710x866
// layout viewport, i.e. the zoom that fits the dashboard does NOT shrink the
// overlays with it. So wherever the layout viewport is wider than the glass,
// every one of those surfaces hangs off the side of the screen while the
// dashboard underneath looks perfectly fitted.
//
// index.html pins `width=1920` because it is a constant no engine can
// miscompute, which is exactly right for a Board Pro (1920 of glass) and one
// value too wide for a Room Navigator (1280). This narrows it, once, from the
// measurement rather than from a guess:
//
//   Board Pro        glass 1920 == layout 1920 -> null, never touched
//   Room Navigator   glass 1280 <  layout 1920 -> width=1280, so a fixed
//                    overlay is the screen again and fitViewport does the rest
//   a page scale     glass is layout/scale, so a board that came back
//                    magnified regardless is brought back into agreement with
//                    itself instead of laying out into space it cannot show
//
// Mutating this tag re-runs the layout-size half of the viewport calculation.
// It does NOT re-run initial-scale selection, which is why the scale itself has
// to be pinned in the markup (docs/signage-zoom-bug.md). Idempotent, and a
// no-op on the production board by construction, which is the only reason it is
// safe to run at boot on every device.
export function narrowViewportToGlass(doc = document, view = doc?.defaultView) {
  const meta = doc?.querySelector?.('meta[name="viewport"]');
  const layout = doc?.documentElement?.clientWidth;
  const glass = view?.visualViewport?.width;
  if (!meta?.content || !Number.isFinite(layout) || !Number.isFinite(glass)) return null;
  if (!(glass > 0) || glass >= layout) return null; // already in agreement: nothing to do
  const w = Math.round(glass);
  if (w < 240) return null; // implausible measurement, same posture as fitViewport
  const current = /width=(\d+)/.exec(meta.content);
  if (current && Number(current[1]) === w) return null; // engine ignored the last rewrite
  meta.content = meta.content.replace(/width=[^,]+/, `width=${w}`);
  return w;
}

// Fit the fixed 1920x1080 layout (main.css pins html/body to exactly that, with
// overflow hidden) onto a smaller RoomOS panel such as a Cisco Room Navigator,
// which otherwise renders only the top-left corner and needs a pinch-zoom to see
// the board.
//
// `zoom`, not a transform: zoom scales the layout itself, so the body-level
// full-screen overlays (story/text viewer, image viewer, settings) scale with
// it. A transform on an ancestor would instead become the containing block for
// their fixed positioning and break them.
//
// WIDTH ONLY, deliberately, and the 2026-07-28 on-device measurements are why:
// a Board Pro lays the page out in 1920x1040 (a Room Navigator read 1920x1200
// then, and reads 1920x800 since the scale was pinned, which is the same glass
// either way), so the page's fixed 1080px height is TALLER than the board's
// viewport. A height term would read 1040/1080 and shrink the production board
// to 96%, the one device this must never touch. The page overflowing a board by
// 40px is deliberate and covered by the 84px --safe-bottom reserve (the grid
// ends at y=996). Guarded to only ever shrink and to never touch a viewport already
// >= 1920 wide, so the Board Pro is untouched by construction.
//
// MEASURED FROM THE VISUAL VIEWPORT AS WELL AS THE LAYOUT ONE (2026-08-26), and
// this is now the ONLY thing fitting the page. It used to be the fallback half
// of a pair: index.html carried a scale-free `width=1920`, engines that honored
// it shrink-to-fit the page themselves, and this covered the engines that
// ignored it. That pairing died when the RoomOS in-place reload path turned out
// to pick a page scale of 2 on a Board Pro, so the meta now pins the scale and
// no engine fits anything (see the long note above that tag).
//
// `documentElement.clientWidth` is the LAYOUT viewport, which with `width=1920`
// in the meta reads 1920 on every engine that honors the tag, INCLUDING a Room
// Navigator whose glass is 1280 wide. A clientWidth-only measurement therefore
// no-ops on the one device this function exists for. `visualViewport.width` is
// the glass. Taking the smaller of the two is correct in every combination we
// ship into:
//
//   Board Pro        layout 1920, visual 1920 -> null, production untouched
//   Room Navigator   layout 1920, visual 1280 -> 0.667, the fit the engine
//                    used to do for free before initial-scale=1 went back
//   desktop preview  the meta is ignored outright, so both read the window
//   page scale > 1   visual is layout/scale, so a board that came back
//                    magnified regardless is COMPENSATED rather than clipped:
//                    zoom 0.5 under scale 2 is 1:1 on the glass again. That is
//                    the safety net under the meta, not a substitute for it.
//
// The window is passed in (defaulting to the one owning `root`) so the tests
// can hand this a viewport without a browser; a bare object root has no
// ownerDocument, which lands on the clientWidth-only path.
export function fitViewport(root = document.documentElement, view = root?.ownerDocument?.defaultView) {
  if (!root?.style) return null;
  root.style.zoom = ''; // reset first, so a resize re-measures unscaled (idempotent)
  // …and publish the scale, because the stylesheet cannot see it. `zoom` is the
  // ONE thing that makes page px and viewport units disagree: inside a zoomed
  // subtree `100dvh` still computes to the raw viewport height, which is the
  // visible page height MULTIPLIED by the zoom, so any CSS comparing a viewport
  // unit against the page's own 1080px is comparing two different rulers. The
  // body centring rule in main.css divides by this to get back into page space.
  root.style.removeProperty?.('--fit-zoom');
  const layout = root.clientWidth;
  const visual = view?.visualViewport?.width;
  // A visual measurement of 0/NaN is an engine that has not laid out yet, not a
  // zero-width screen: fall back to the layout viewport rather than believe it.
  const w = Number.isFinite(visual) && visual > 0 ? Math.min(layout, visual) : layout;
  if (!Number.isFinite(w) || w <= 0 || w >= 1920) return null; // Board Pro and larger
  const scale = Math.round((w / 1920) * 1000) / 1000;
  // Implausible measurement: leave the page alone. The floor is for garbage,
  // NOT for small glass, so it sits below any real device (0.15 is ~290px) and
  // a phone opening the board URL at 390px still gets fitted.
  if (scale < 0.15) return null;
  root.style.zoom = String(scale);
  root.style.setProperty?.('--fit-zoom', String(scale));
  return scale;
}

// Chaikin corner-cutting: rounds a polyline ([[x,y],...]) into a denser,
// curve-like one so a chart reads smooth rather than angular. It stays inside
// the data's convex hull (NO overshoot, so no phantom crossings), preserves the
// exact endpoints, and remains a plain polyline. Two passes lose the polygon
// look. Shared by the markets and weather trend lines.
export function chaikin(pts, iterations = 2) {
  let p = pts;
  for (let it = 0; it < iterations && p.length >= 3; it++) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [x1, y1] = p[i];
      const [x2, y2] = p[i + 1];
      out.push([x1 + 0.25 * (x2 - x1), y1 + 0.25 * (y2 - y1)]);
      out.push([x1 + 0.75 * (x2 - x1), y1 + 0.75 * (y2 - y1)]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

// Countdown display for departure rows. Real minutes, however long the wait:
// alignment for 3-digit values is trains--widemin's job (fitTrainRows), and
// with the TrainTime horizon a column of identical capped rows told the rider
// nothing. 999 stays as a data-sanity clamp only — a four-digit countdown is
// a feed error, not a train.
export const fmtMin = (min) => (min > 999 ? '999+' : String(min));

export function fmtTime(epochSec) {
  return new Date(epochSec * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Options for a wall-clock time-of-day render at the board's 12/24-hour
// preference (cfg.clock24). Single source so the topbar Clock, World Clock,
// and every "as of"/freshness stamp format identically.
export const clockTimeOpts = (clock24) => (clock24
  ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
  : { hour: 'numeric', minute: '2-digit' });

// A "now"/"as of" reading (freshness stamps, card notes) honoring clock24 —
// distinct from fmtTime, which formats transit SCHEDULE times (always 12h).
export function fmtClock(epochSec, clock24 = false) {
  return new Date(epochSec * 1000).toLocaleTimeString('en-US', clockTimeOpts(clock24));
}

// Extract an iCloud shared-album token from a full URL, a #fragment, or a bare
// token. Case-sensitive (the token is), lenient about surrounding text.
export function parseAlbumToken(input) {
  let s = String(input ?? '').trim();
  if (s.includes('#')) s = s.slice(s.lastIndexOf('#') + 1); // token lives after the fragment
  s = s.replace(/[^A-Za-z0-9].*$/, ''); // drop a trailing slash or any junk
  return /^[A-Za-z0-9]{8,25}$/.test(s) ? s : null;
}

// Extract a Google Drive folder id from a shared link
// (drive.google.com/drive/folders/<id>, including /drive/u/N/folders/ variants
// and ?usp=sharing suffixes) or accept a bare id. null when unrecognizable.
export function parseDriveFolder(input) {
  const s = String(input ?? '').trim();
  const m = s.match(/folders\/([-\w]{10,80})/);
  if (m) return m[1];
  return /^[-\w]{10,80}$/.test(s) ? s : null;
}

// Unconfigured-card prompt: invites the tap (the card itself opens Settings
// focused on `section` — see main.js) and shows the gear GLYPH so users can
// find the settings button visually. Copy shape per Sean:
// "Tap here to <action> or via <gear> → <section name>".
// The "via ⚙ → X" unit stays unbreakable (nowrap span): it wraps to the
// next line whole or not at all.
export const viaSettings = (dest) =>
  `<span class="empty__via">via ${icon('settings', 'icon--inline')} → ${dest}</span>`;

export function setupPrompt(section, action, dest) {
  return `<div class="empty" data-setup="${section}">Tap here to ${action} or ${viaSettings(dest)}</div>`;
}

// Sunset prompt for a retired event card — the render half of the
// RETIRED_AFTER mechanism in config.js. The whole card taps into edit mode to
// swap the widget (main.js wires [data-edit]); the pencil glyph points at the
// on-screen button, same idea as viaSettings' gear. The glyph phrase stays
// unbreakable. No card uses it right now (World Cup 2026 was the last dated
// one and left the tree 2026-07-29); it waits here for the next seasonal card,
// which needs a RETIRED_AFTER line and this call and nothing else.
export function editPrompt(message) {
  return `<div class="empty" data-edit>${message} Tap here to replace this card, <span class="empty__via">or via ${icon('pencil', 'icon--inline')} Edit layout</span></div>`;
}

// Deterministic per-calendar-day pick, shared by the quote and word widgets.
export function dailyPick(list, date) {
  const start = Date.UTC(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor(
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - start) / 86400000,
  );
  return list[(date.getFullYear() * 366 + dayOfYear) % list.length];
}
