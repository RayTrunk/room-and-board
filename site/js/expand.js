// Tap-to-expand: one shared full-screen overlay that shows everything a capped
// list card ALREADY fetched — the contents of its quiet "+N" badge — and then
// closes itself. The resting board never moves and never scrolls; expansion is
// a transient view, and the idle timer guarantees the board returns to its
// canonical state on its own (no residue left by a passer-by).
//
// Expansion reveals only what is already in hand: no fetch, no worker load.
// Cards register a builder via setExpandSource; a card with nothing hidden
// registers nothing and its taps stay inert.

import { escapeHtml } from './util.js';
import { swipeAction } from './imageshow.js';

// Mandatory auto-close. Long enough to read a full ticker wall, short enough
// that an abandoned board is canonical again before anyone else walks up.
export const EXPAND_IDLE_MS = 60 * 1000;

// The canvas a full-screen view gets: .expand__body's content box, which every
// overlay that MODELS its own fit reserves against (markets' ticker wall,
// subway's alert ladder). One number instead of the two that had drifted apart
// in those two widgets. Arithmetic, not a measurement, and main.css is the other
// half of it:
//   H − 56 (.expand padding-top) − 34 (.expand__head, pinned)
//     − 36 (.expand__body margin-top) − 100 (.expand__body padding-bottom)
// Every term is a fixed px in main.css precisely so this stays exact on a board
// whose font is not the one the widgets were measured in; test/expand.test.js
// reads them back out of the stylesheet and re-does the sum.
//
// KNOWN WRONG BY 40px ON THE BOARD, and deliberately left that way for now.
// H here is 1080, the height of the headless harness every widget in this repo
// was measured in. Sean's on-device diagnostic of 2026-07-28 found the Board Pro
// hands the page a 1920x1040 viewport (the OS bar sits BELOW it), so the real
// canvas is 814, not 854: the models believe they have 40px they do not have,
// and a dense wall can over-pack on-device while passing here. Correcting it
// re-tunes both ladders and needs its own browser sweep at 1040 — tracked as a
// follow-up, not folded into a chrome change.
export const OVERLAY_BODY_H = 854;

let idleTimer = null;
let rowTap = null; // per-session interactive-row handler (news family, wave 3)

// card element -> () => view. Weak so a re-rendered/removed card is collectable.
const sources = new WeakMap();

// Edit mode owns every tap on the board (drag, resize), and Settings covers the
// grid outright — expansion must never open behind either. openEditMode fills
// #edit-root and empties it again on done/cancel, so a child element there IS
// the live signal; openSettings does the same with #settings-root.
export function isEditing(doc = document) {
  return Boolean(
    doc.querySelector('#edit-root')?.firstElementChild ||
      doc.querySelector('#settings-root')?.firstElementChild,
  );
}

function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(closeExpand, EXPAND_IDLE_MS);
}

// Shared overlay element: created once, wired once. Its listeners read module
// state, so a session's row handler can change without re-binding.
function overlayEl() {
  let host = document.querySelector('#expand-view');
  if (host) return host;
  host = document.createElement('div');
  host.id = 'expand-view';
  host.className = 'expand';
  host.hidden = true;
  // Press-not-drag, same classifier as the image viewer: the click is judged by
  // its own coordinates against the gesture origin, so a swipe that scrolled a
  // long list can't be mistaken for the tap that closes. Only the FIRST pointer
  // of a gesture sets the origin — a second finger (or a palm on a wall panel)
  // must not move it under the click that is already on its way.
  let down = null;
  host.addEventListener('pointerdown', (e) => {
    down ??= { id: e.pointerId, x: e.clientX, y: e.clientY };
    resetIdle();
  });
  host.addEventListener('pointerup', (e) => {
    if (!down || e.pointerId === down.id) resetIdle();
  });
  host.addEventListener('pointercancel', () => { down = null; });
  host.addEventListener('click', (e) => {
    const gesture = down;
    down = null;
    if (gesture && swipeAction(e.clientX - gesture.x, e.clientY - gesture.y) !== 'tap') return;
    resetIdle();
    // Interactive rows keep the overlay open (a tapped headline stacks its
    // story view above); everything else is "tap anywhere to close".
    const row = e.target.closest?.('[data-expand-row]');
    if (row && rowTap) {
      rowTap(row);
      return;
    }
    closeExpand();
  });
  document.body.appendChild(host);
  return host;
}

export function isExpandOpen() {
  const host = document.querySelector('#expand-view');
  return Boolean(host) && !host.hidden;
}

// Every full-screen view that is dismissed by "tap anywhere": this overlay, the
// text/story reader, and the art viewer. All three toggle the `hidden`
// property, so the DOM is the live signal (same idiom as isEditing). One
// invariant to serve: a tap that CLOSES an overlay must never open another.
const OVERLAYS = '#expand-view, #text-viewer, #art-viewer';

export function isOverlayOpen(doc = document) {
  return [...doc.querySelectorAll(OVERLAYS)].some((el) => !el.hidden);
}

// Opens the overlay on a content SNAPSHOT: bodyHtml is built by the caller at
// open time and never re-read, so a widget refresh mid-view cannot yank the DOM
// out from under a reader (the idle cap bounds how stale it can get).
// bodyHtml is trusted markup — widgets escape their own values, as they do for
// the card body itself. Returns false when the overlay refuses to open.
export function openExpand({ title = '', note = '', stamp = '', bodyHtml = '', onRowTap = null } = {}) {
  if (isExpandOpen()) return false; // single instance: opening while open is a no-op
  if (isEditing()) return false;
  const host = overlayEl();
  rowTap = onRowTap;
  // A stale-stamped card hands its stamp through: the overlay must not read
  // fresher than the card it came from.
  host.classList.toggle('is-stale', Boolean(stamp));
  host.innerHTML = `
    <div class="expand__head">
      <span class="expand__title">${escapeHtml(title)}</span>
      ${note ? `<span class="expand__note">${escapeHtml(note)}</span>` : ''}
      ${stamp ? `<span class="expand__stamp">${escapeHtml(stamp)}</span>` : ''}
    </div>
    <div class="expand__body">${bodyHtml}</div>
    <p class="expand__hint">Tap anywhere to close</p>`;
  host.hidden = false;
  resetIdle();
  return true;
}

export function closeExpand() {
  const host = document.querySelector('#expand-view');
  if (host) {
    host.hidden = true;
    host.innerHTML = ''; // release the snapshot
    host.classList.remove('is-stale');
  }
  clearTimeout(idleTimer);
  idleTimer = null;
  rowTap = null;
}

// Registers (or clears) a card's expansion. `build` returns the view to open —
// it is called ONCE, at tap time, so the overlay shows the data the card was
// showing when it was tapped. Pass null/undefined when nothing is hidden: the
// card is then inert, matching the absent "+N" badge.
export function setExpandSource(el, build) {
  const card = el?.closest?.('.card');
  if (!card) return; // test fakes without closest(): no-op, like setMoreBadge
  if (typeof build === 'function') {
    sources.set(card, build);
    card.classList.add('is-expandable');
  } else {
    sources.delete(card);
    card.classList.remove('is-expandable');
  }
}

// The card's amber freshness stamp, when main.js has marked it stale.
function staleStamp(card) {
  const stamp = card.querySelector?.('.card__stamp');
  return stamp && !stamp.hidden ? stamp.textContent.trim() : '';
}

// The gesture a click is attributed to, recorded on the DOCUMENT rather than on
// the grid. It has to be document-wide: the tap that dismisses a full-screen
// overlay lands on a node OUTSIDE the grid, so a grid-only pointerdown never
// sees it — and once the overlay is hidden the browser hit-tests the trailing
// (touch-synthesised) click against the DOM that is left, retargeting it onto
// whatever card now sits under the finger. Knowing where the finger went DOWN,
// and what was on screen at that moment, is what tells a real card tap from
// that leaked one.
let press = null;

// A press only owns the clicks of its own gesture. Real hardware fires
// pointerdown → pointerup → click inside a few hundred ms; past this window we
// assume the record was orphaned (a pointerup lost to an element pulled out
// from under the finger, a gesture that produced no click at all) and let the
// next pointerdown take over. Deliberately generous-but-tight: expiring means
// the guards below are skipped, which is the pre-existing behaviour for
// synthesised clicks, never a board that refuses to open.
const PRESS_MS = 1200;

const fresh = (p) => Boolean(p) && Date.now() - p.t < PRESS_MS;

let pressWired = false;
function wirePress(doc) {
  if (pressWired) return;
  pressWired = true;
  doc.addEventListener('pointerdown', (e) => {
    // Only the FIRST pointer of a gesture sets the origin — a second finger (or
    // a palm on a wall panel) must not move it under a click already on its way.
    // A gesture whose pointer has already lifted is over, so the next tap always
    // gets its own origin even if it lands within the window.
    if (fresh(press) && !press.done) return;
    press = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      t: Date.now(),
      card: e.target?.closest?.('.card') ?? null,
      overlay: isOverlayOpen(doc),
    };
  }, true);
  // The gesture is over at pointerup, but the record outlives it: the click that
  // matters is dispatched afterwards and still needs the origin on hand.
  doc.addEventListener('pointerup', (e) => {
    if (press && e.pointerId === press.id) press.done = true;
  }, true);
  doc.addEventListener('pointercancel', () => { press = null; }, true);
  // Bubble phase, so the grid's handler below still sees the record: one press
  // answers for exactly one click, and a later synthesised click cannot reuse it.
  doc.addEventListener('click', () => { press = null; });
}

// Delegated: one listener on the grid covers every card and survives every
// widget re-render (same idiom as the text viewer).
export function initExpand(host) {
  wirePress(host.ownerDocument ?? document);
  press = null; // a freshly wired board has no gesture in flight
  host.addEventListener('click', (e) => {
    const card = e.target.closest?.('.card');
    const build = card && sources.get(card);
    if (!build) return; // nothing hidden on this card (or not an expandable one)
    // Never stack a second full-screen view on a live one. A widget's own
    // handler may have opened its viewer earlier in this very click (the art
    // and chart cards do), so this reads the DOM, not just the press record.
    if (isOverlayOpen()) return;
    const gesture = fresh(press) ? press : null;
    if (gesture) {
      // Both checks are about the tap's ORIGIN, which is the only thing a
      // retargeted click gets wrong: it keeps the coordinates but arrives with
      // a target it was never aimed at.
      if (gesture.overlay) return; // something was full screen when the finger went down: this tap was its dismissal
      if (gesture.card !== card) return; // the press began somewhere else entirely
      if (swipeAction(e.clientX - gesture.x, e.clientY - gesture.y) !== 'tap') return; // a drag, not a tap
    }
    const view = build();
    if (view) openExpand({ ...view, stamp: staleStamp(card) });
  });
}
