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

// Delegated: one listener on the grid covers every card and survives every
// widget re-render (same idiom as the text viewer).
export function initExpand(host) {
  let down = null;
  host.addEventListener('pointerdown', (e) => {
    down ??= { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  host.addEventListener('pointercancel', () => { down = null; });
  host.addEventListener('click', (e) => {
    const gesture = down;
    down = null;
    const card = e.target.closest?.('.card');
    const build = card && sources.get(card);
    if (!build) return; // nothing hidden on this card (or not an expandable one)
    if (gesture && swipeAction(e.clientX - gesture.x, e.clientY - gesture.y) !== 'tap') return;
    const view = build();
    if (view) openExpand({ ...view, stamp: staleStamp(card) });
  });
}
