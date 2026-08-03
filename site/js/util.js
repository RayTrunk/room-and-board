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
// WIDTH ONLY on RoomOS devices (Board Pro 1920×1040, Navigator 1920×1200):
// the meta viewport `width=1920` always reports clientWidth=1920 on those, so
// scaleW==1 and the w<1920 guard prevents any height adjustment that would
// shrink production boards. On desktop browsers the meta is often ignored and
// clientWidth reflects the real window; there we also fit vertically so a
// narrow/short browser window doesn't clip the bottom rows of the dashboard.
export function fitViewport(root = document.documentElement) {
  if (!root?.style) return null;
  root.style.zoom = ''; // reset first so a resize re-measures unscaled (idempotent)
  const cssW = root.clientWidth;
  if (!Number.isFinite(cssW) || cssW <= 0) return null;
  // The viewport meta `width=1920` makes cssW==1920 on both RoomOS (Board Pro,
  // Navigator) AND desktop browsers. Use window.outerWidth (physical window
  // width, unaffected by the viewport meta) as the true available width.
  // On a Board Pro the display IS 1920 px so outerWidth ≈ 1920; on a desktop
  // browser in a narrower window it is the actual window size.
  const outerW = typeof window !== 'undefined' && window.outerWidth > 0 ? window.outerWidth : cssW;
  const scaleW = Math.min(cssW, outerW) / 1920;
  // Always also fit height: on a desktop browser with address bar + OS taskbar
  // window.innerHeight is typically < 1080, so the gear buttons at bottom:44px
  // would be clipped without this. (Board Pro: innerHeight ≈ 1040 → scale 0.963,
  // fitting the canvas exactly into the physical display.)
  const h = typeof window !== 'undefined' ? window.innerHeight : 0;
  const scaleH = Number.isFinite(h) && h > 0 ? h / 1080 : 1;
  const scale = Math.round(Math.min(scaleW, scaleH) * 1000) / 1000;
  if (scale >= 1) return null; // nothing needs scaling — Board Pro or wide/tall desktop
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

// Small right-aligned context note in a card's title ("as of 8:16 PM",
// "stops at Mineola"). Null/empty text removes it. Reuses .card__asof so the
// amber stale stamp keeps winning the corner (.card.is-stale hides the note).
export function setCardNote(el, text) {
  const title = el.closest?.('.card')?.querySelector('.card__title');
  if (!title) return;
  let note = title.querySelector('.card__asof');
  if (!text) {
    note?.remove();
    return;
  }
  if (!note) {
    note = document.createElement('span');
    note.className = 'card__asof';
    title.appendChild(note);
  }
  note.textContent = text;
}


// Every full-screen view that is dismissed by "tap anywhere": the expand
// overlay, the text/story reader, and the art viewer. All three toggle the
// `hidden` property, so the DOM is the live signal. One invariant to serve: a
// tap that CLOSES an overlay must never open another.
//
// It lives here, not in expand.js where it was written, because the image
// surface needs the same answer and cannot import the expand engine — expand.js
// already imports imageshow.js for the gesture classifier. expand.js re-exports
// it, so every existing importer is unchanged.
const OVERLAYS = '#expand-view, #text-viewer, #art-viewer';

export function isOverlayOpen(doc = document) {
  return [...doc.querySelectorAll(OVERLAYS)].some((el) => !el.hidden);
}

// ---------- the bottom-right corner badge ----------
//
// One element, two independent facts, and neither owner may write it alone:
//
//   how many rows are hidden   — the renderer's, via setMoreBadge
//   whether the card OPENS     — the engine's, via markExpandable
//
// They arrive in either order (every renderer paints its count BEFORE it
// registers its expansion) and on different schedules (a card re-renders its
// body every refresh but only re-registers when its data changes shape), so
// each records its fact on the card and calls paintMoreBadge, the one place
// that reads both. That is also what makes the affordance automatic: a widget
// that never heard of the badge gets it the moment it registers an expansion.
//
// The three forms, and the honesty rule that picks between them:
//
//   expands + hides N   "⤢ N more"   the mark invites the tap, the count says
//                                     what is behind it
//   expands, nothing hidden   "⤢"     weather, the image cards: there is no
//                                     count, but the tap still opens something
//   hides N, does not expand   "+N"    news, buses, world clock: the count is
//                                     honest and the mark would be a lie
//
// The corner is safe at every card width (a title badge clips beside long
// titles on 2-wide cards) and .card__stamp is top-anchored, so the badge and
// the amber "as of" stamp can never collide.
//
// It sits at EQUAL 12px insets (main.css .card__more, 2026-08-01) rather than
// on the content column's 26px edge: a glyph in a corner is a corner mark, not
// reading matter, and the inherited 26/10 read as misplaced. The one thing a
// renderer has to know is the consequence: a row that runs flush to the card's
// BOTTOM edge stands in the mark's corner and owes it --more-gutter, because
// there is nowhere sideways for the mark to go. Two rows pay it today
// (weather's day tiles, surf's footer strip).

// Reads the widget's own name off the card for an aria-label. First text node
// only: a title may carry an appended .card__asof span (same idiom as the text
// viewer's title read).
function cardName(card) {
  return card.querySelector?.('.card__title')?.childNodes[0]?.textContent?.trim() ?? '';
}

export function paintMoreBadge(card) {
  // querySelector may be absent on test fakes (capacity stubs) — no-op then.
  if (!card?.querySelector) return;
  const hidden = Number(card.dataset.more) || 0;
  const verbose = card.dataset.moreVerbose === '1';
  const expands = card.classList.contains('is-expandable');
  let badge = card.querySelector('.card__more');
  if (!hidden && !expands) {
    badge?.remove();
    card.classList.remove('has-more');
    return;
  }
  if (!badge) {
    badge = document.createElement('span');
    card.appendChild(badge);
  }
  badge.className = 'card__more';
  // The mark is an inline SVG, never a font character: a text chevron sits on
  // baseline metrics and rides along the bottom of the words beside it, which
  // is exactly the look Sean rejected. An SVG is a box, and a box centres.
  const mark = expands ? icon('expand', 'icon--more') : '';
  const text = hidden ? (expands ? `${hidden} more` : verbose ? `+${hidden} more` : `+${hidden}`) : '';
  badge.innerHTML = `${mark}${text ? `<span class="card__more-n">${escapeHtml(text)}</span>` : ''}`;
  card.classList.toggle('has-more', hidden > 0);
}

// The renderer's half: how many rows the card is NOT showing. Replaces the old
// in-flow ".more-hint" row — the count costs no list row, and the "enlarge the
// card" imperative lives only in edit mode (capacityLabel). hidden <= 0 drops
// the count (and the whole badge, unless the card expands). `verbose` picks the
// "+N more" wording for a card that does NOT expand; an expandable card always
// reads "N more" beside its mark, so the two can never coexist on one card.
export function setMoreBadge(el, hidden, { verbose = false } = {}) {
  const card = el.closest?.('.card');
  if (!card?.querySelector) return;
  const n = hidden > 0 ? Math.round(hidden) : 0;
  if (n) {
    card.dataset.more = String(n);
    card.dataset.moreVerbose = verbose ? '1' : '0';
  } else {
    delete card.dataset.more;
    delete card.dataset.moreVerbose;
  }
  paintMoreBadge(card);
}

// The engine's half: this card opens something when you tap it. Called from
// setExpandSource (the overlay engine) and from renderImageCard (the image
// surface, whose full-screen viewer is its own expansion) — the two places a
// card is MARKED tappable — so no widget wires the affordance itself and every
// future expandable card gets it for free.
//
// role/tabindex/aria-label ride along: a card that behaves like a button says
// so, and the label names the destination rather than the card ("Expand
// Weather details"). Image cards pass their own label, which already reads
// "View image full screen".
export function markExpandable(el, expands, { label = '' } = {}) {
  const card = el?.closest?.('.card');
  if (!card?.querySelector) return;
  card.classList.toggle('is-expandable', Boolean(expands));
  if (expands) {
    const name = cardName(card);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', label || (name ? `Expand ${name} details` : 'Expand details'));
  } else {
    card.removeAttribute('role');
    card.removeAttribute('tabindex');
    card.removeAttribute('aria-label');
  }
  paintMoreBadge(card);
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
