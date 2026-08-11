import { icon } from './icons.js';
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
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
// a Board Pro lays the page out in 1920x1040 and a Room Navigator in 1920x1200,
// so the page's fixed 1080px height is TALLER than the board's viewport. A
// height term would read 1040/1080 and shrink the production board to 96% — the
// one device this must never touch. The page overflowing a board by 40px is
// deliberate and covered by the 84px --safe-bottom reserve (the grid ends at
// y=996). Guarded to only ever shrink and to never touch a viewport already
// >= 1920 wide, so the Board Pro is untouched by construction.
//
// `documentElement.clientWidth` is the LAYOUT viewport width. That makes this
// complementary to index.html's `width=1920` viewport meta rather than
// redundant: where the meta is honored this reads 1920 and no-ops (the engine
// already fit the page), and where the meta is ignored it reads the true panel
// width and does the fitting here. Exactly one half ever applies.
export function fitViewport(root = document.documentElement) {
  if (!root?.style) return null;
  root.style.zoom = ''; // reset first, so a resize re-measures unscaled (idempotent)
  const w = root.clientWidth;
  if (!Number.isFinite(w) || w <= 0 || w >= 1920) return null; // Board Pro and larger
  const scale = Math.round((w / 1920) * 1000) / 1000;
  if (scale < 0.25) return null; // implausible measurement — leave the page alone
  root.style.zoom = String(scale);
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
