// Tap-to-expand: one shared full-screen overlay that shows everything a capped
// list card ALREADY fetched — the contents of its quiet "+N" badge — and then
// closes itself. The resting board never moves and never scrolls; expansion is
// a transient view, and the idle timer guarantees the board returns to its
// canonical state on its own (no residue left by a passer-by).
//
// Expansion reveals only what is already in hand: no fetch, no worker load.
// Cards register a builder via setExpandSource; a card with nothing hidden
// registers nothing and its taps stay inert.

import { escapeHtml, markExpandable, isOverlayOpen } from './util.js';
import { swipeAction } from './imageshow.js';
import { reportTap } from './fleet.js';

// Mandatory auto-close. Long enough to read a full ticker wall, short enough
// that an abandoned board is canonical again before anyone else walks up.
export const EXPAND_IDLE_MS = 60 * 1000;

// The viewport the SMALLEST supported device hands the page, measured on-device
// 2026-07-28: a Cisco Board Pro lays out at 1920x1040 CSS px and RoomOS paints
// its "Tap here to start" bar in the 40 physical px BELOW that box, not over it.
// A Room Navigator gives 1920x1200 and a desktop preview 1920x1080, so 1040 is
// the floor and anything modelled against it fits all three.
//
// This is NOT the height of the dashboard: main.css pins html/body to a fixed
// 1920x1080 page, so the grid, the editor and the settings overlay all live in
// that 1080 box at every viewport (its last 40px fall outside a board's screen,
// which the 84px --safe-bottom reserve already clears). Only the position:fixed
// full-screen overlays are sized by the viewport, and this constant is for them.
export const BOARD_VIEWPORT_H = 1040;

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
// H is the BOARD's 1040, not the 1080 of the headless harness the widgets were
// originally measured in — that harness over-reported the canvas by 40px, and a
// wall that packed to 854 lost its tail off the bottom of a real board. The
// models get the smallest canvas any supported device gives them and leave the
// spare 40 (Board) / 160 (Navigator) px as slack.
//
// DECIDED 2026-07-29, not deferred: that slack stays unspent, and this stays a
// constant rather than a per-open measurement. A measured canvas is arithmetically
// safe on a board (viewportH - 226 is exactly 814 at 1040), but it would hand a
// Navigator a 974px canvas that no model has ever been checked at — and of the
// two overlays that model their own fit, only subway has a measured backstop
// (its onFit/fitStatusBoard); markets' ticker wall ships whatever wallHeight()
// believes. So a taller canvas would mean every future change to that wall needs
// verifying on a live Room Navigator as well as on a board, which is the ongoing
// per-device test burden this project will not take on to win one more row on a
// corner-case device. One canvas, verified once, everywhere.
export const OVERLAY_BODY_H = BOARD_VIEWPORT_H - 56 - 34 - 36 - 100; // 814

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

// "Is any full-screen view up?" moved to util.js so the image surface can ask
// it too (imageshow.js cannot import this module — this module imports it).
// Re-exported here because this is where every caller already looks for it.
export { isOverlayOpen };

// Opens the overlay on a content SNAPSHOT: bodyHtml is built by the caller at
// open time and never re-read, so a widget refresh mid-view cannot yank the DOM
// out from under a reader (the idle cap bounds how stale it can get).
// bodyHtml is trusted markup — widgets escape their own values, as they do for
// the card body itself. Returns false when the overlay refuses to open.
//
// `onFit` is handed the live .expand__body once it is on screen and may rewrite
// it. It is the same contract the CARDS have had all along — an optimistic
// static estimate, then a measured trim (fitTrainRows, subway's own row loop,
// services') — extended to the overlays, which had no way to check their work
// and so shipped whatever their model believed. Fit, not content: it runs once,
// before the reader sees anything, and must converge.
//
// `hint` is the closing line. It defaults to the board-wide "Tap anywhere to
// close" and every view that IS just a canvas keeps that default; a view whose
// rows are themselves tappable (the news reading list) overrides it, because
// "tap anywhere" is a lie once one region does something else.
export function openExpand({ title = '', note = '', stamp = '', bodyHtml = '', hint = 'Tap anywhere to close', onRowTap = null, onFit = null } = {}) {
  if (isExpandOpen()) return false; // single instance: opening while open is a no-op
  if (isEditing()) return false;
  // Counted here, past the guards: an expansion that actually opened is a tap
  // that DID something, which is the number worth having. A refused open (a
  // second tap while a view is up, a tap in the editor) is not usage. The
  // counter is anonymous and content-free — how many, never of what.
  reportTap();
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
    <p class="expand__hint">${escapeHtml(hint)}</p>`;
  host.hidden = false;
  // After `hidden` clears, so the body has a real clientHeight to measure.
  if (onFit) onFit(host.querySelector('.expand__body'));
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
//
// `trigger` narrows the tap target to a selector INSIDE the card. Without it
// the whole card is the target, which is right for cards whose rows are not
// tappable (markets, weather, the rail boards).
//
// `except` is the inverse of `trigger`: a tap landing inside it is NOT the
// card's. It exists because the news family's rows already own their taps (a
// headline opens its story) while the card around them owes the reader the
// whole list, and `trigger` cannot express that — closest() walks UP, so a
// ":not(.headline)" trigger still matches the row's parent and fires anyway.
// The two compose: `trigger` narrows to a region, `except` punches the live
// rows back out of it. Without this the news wave double-fires by
// construction, since initExpand's listener is registered BEFORE the text
// viewer's and would open the list underneath every story view.
//
// `subviews` are element-scoped views layered OVER the card target: a tap
// landing on a subview's selector opens that build instead of the card's (the
// rail alert banners read full screen; the schedule is everything else). The
// matched element is passed to the subview build so one selector can serve
// several banners. A card with subviews but no card build is legal — the
// banner still reads on a card with nothing hidden — and only a card build
// earns the is-expandable affordance.
export function setExpandSource(el, build, { trigger = null, except = null, subviews = null } = {}) {
  const card = el?.closest?.('.card');
  if (!card) return; // test fakes without closest(): no-op, like setMoreBadge
  const hasBuild = typeof build === 'function';
  if (hasBuild || subviews?.length) {
    sources.set(card, { build: hasBuild ? build : null, trigger, except, subviews });
  } else {
    sources.delete(card);
  }
  // The single place a card is marked tappable: the class, the button
  // semantics, and the wording of any corner count all follow from this one
  // call, so a widget that registers an expansion never has to know the
  // affordance exists.
  markExpandable(card, hasBuild);
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
    const source = card && sources.get(card);
    if (!source) return; // nothing hidden on this card (or not an expandable one)
    // A subview tap outranks the card view and ignores the trigger narrowing:
    // the banner IS its own trigger.
    const sub = source.subviews?.find((s) => e.target.closest?.(s.selector));
    if (!sub && source.trigger && !e.target.closest?.(source.trigger)) return; // tap missed the trigger
    if (!sub && source.except && e.target.closest?.(source.except)) return; // the row owns this tap, not the card
    if (!sub && !source.build) return; // subviews only: the card surface stays inert
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
    const view = sub ? sub.build(e.target.closest(sub.selector)) : source.build();
    if (view) openExpand({ ...view, stamp: staleStamp(card) });
  });
  // An expandable card carries role="button" + tabindex, and a non-<button>
  // never gets a synthesised click from the keyboard — so Enter/Space become
  // one here. Cheap because it hands off to the click path above rather than
  // duplicating any of its guards: the press record is cleared first, since a
  // keypress has no gesture and must not inherit the last finger's.
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const card = e.target?.closest?.('.card.is-expandable');
    const source = card && sources.get(card);
    if (!source?.build) return;
    e.preventDefault(); // Space must not scroll the page under the board
    press = null;
    (source.trigger ? card.querySelector(source.trigger) ?? card : card).click();
  });
}
