// The ordered ticker list — ONE implementation shared by the board's
// Settings › Markets pane and the phone's /setup page. Markup, the fold band,
// and the drag-to-reorder gesture all live here; the two surfaces differ only
// in CSS (main.css skins .tk-* for the board, setup.css for the phone) and in
// which element scrolls under the drag.
//
// Why a drag and not ▲/▼ steppers: promoting a ticker from 7th to 3rd is four
// taps with steppers and the row moves under the finger every time. The drag is
// initiated ONLY from the chevron handle — never the row body — which is what
// keeps it from fighting the list's own scroll on the board and the PAGE scroll
// on the phone (the classic touch-list failure).

import { moveWidget } from './pickers.js';
import { escapeHtml } from '../util.js';

// The three starter indexes read as words, not symbols. Anything else falls
// back to whatever the last markets payload called it (see marketNames), and
// then to the symbol itself.
export const INDEX_NAMES = { '^DJI': 'Dow Jones', '^IXIC': 'Nasdaq', '^GSPC': 'S&P 500' };

// A stacked chevron pair: "move this up or down". Presentation attributes
// rather than CSS so it draws identically under both stylesheets (and on the
// board's gen1 engine, which is unreliable with SVG it has to inherit style
// for); size comes from CSS on .tk-grip svg.
const CHEVRONS =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
  '<path d="M5.5 9 12 2.5 18.5 9"/><path d="M5.5 15 12 21.5 18.5 15"/></svg>';

// An index leads with its friendly name and subs the symbol ("Dow Jones /
// ^DJI"); a stock does the reverse ("AAPL / Apple"). Exactly what the expand
// wall's tile() does, so the ^-prefix distinction is visible without inventing
// a badge — and without a settings list that groups differently from the card.
export function rowLabels(symbol, names = {}) {
  const name = INDEX_NAMES[symbol] ?? names[symbol] ?? '';
  if (symbol.startsWith('^')) return name ? { lead: name, sub: symbol } : { lead: symbol, sub: '' };
  return { lead: symbol, sub: name };
}

// The fold band's two halves. `cap` is the card's real capacity or null; the
// caller gets null back whenever there is no line to draw, so "draw the fold"
// is one truthy check rather than a rule repeated on two surfaces.
export function foldCounts(cap, total) {
  if (cap == null || !(cap < total)) return null;
  return { on: cap, behind: total - cap };
}

const band = (label, dim) =>
  `<div class="tk-fold${dim ? ' tk-fold--below' : ''}"${dim ? ' data-tk-fold' : ''}>` +
  '<span class="tk-fold__rule"></span>' +
  `<span class="tk-fold__label">${label}</span>` +
  '<span class="tk-fold__rule"></span></div>';

// The band that sits ABOVE the list, naming what reaches the card.
export function foldHeadHtml(cap, total) {
  const f = foldCounts(cap, total);
  return f ? band(`On the card now · ${f.on}`, false) : '';
}

// One row. `lone` (a list of exactly one) drops the handle: a handle that
// cannot reorder anything is a lie. The ✕ and the hint stay.
function rowHtml(symbol, pos, { below, lone, names }) {
  const { lead, sub } = rowLabels(symbol, names);
  const label = escapeHtml(lead);
  return (
    `<div class="tk-row${below ? ' tk-row--below' : ''}" data-sym="${escapeHtml(symbol)}">` +
    (lone
      ? ''
      : `<button type="button" class="tk-grip" data-reorder aria-label="Reorder ${label}">${CHEVRONS}</button>`) +
    `<span class="tk-pos">${pos}</span>` +
    `<span class="tk-txt"><span class="tk-lead">${label}</span>` +
    (sub ? `<span class="tk-sub">${escapeHtml(sub)}</span>` : '') +
    '</span>' +
    `<button type="button" class="iconbtn tk-rm" data-remove-sym="${escapeHtml(symbol)}" aria-label="Remove ${label}">✕</button>` +
    '</div>'
  );
}

// The list's children: rows in config order, with the "behind a tap" band cut
// in after the card's capacity. The band draws only when capacity < length —
// with three tickers on a 4×4 card everything is on the card and a line saying
// so would be noise.
export function tickerRowsHtml(symbols, { cap = null, names = {} } = {}) {
  const f = foldCounts(cap, symbols.length);
  const lone = symbols.length <= 1;
  return symbols
    .map((s, i) => (f && i === f.on ? band(`Behind a tap · ${f.behind}`, true) : '') +
      rowHtml(s, i + 1, { below: Boolean(f) && i >= f.on, lone, names }))
    .join('');
}

/* ---------------- the drag ---------------- */

// How close to the scroller's edge the finger has to get before the list
// starts moving under it, and the ceiling on how fast (px per frame ≈ 1080px/s
// at 60fps). With no "↑ Top" shortcut the drag is the ONLY reorder path, so
// edge auto-scroll is load-bearing at the 20-ticker cap: ~790px of scroll,
// crossed in about three quarters of a second of holding at the edge.
const EDGE = 80;
const MAX_RATE = 18;
// Press-not-drag: nothing lifts until the finger has actually travelled. A tap
// on the handle is therefore a no-op rather than a 1px reorder.
const THRESHOLD = 6;

const viewport = (sc) =>
  sc === document.scrollingElement || sc === document.documentElement || sc === document.body
    ? { top: 0, bottom: window.innerHeight }
    : (({ top, bottom }) => ({ top, bottom }))(sc.getBoundingClientRect());

// Wire a rendered .tk-list for reordering.
//   order()   -> the live symbol array (read fresh: the caller owns it)
//   cap       -> the fold's capacity, or null when no band is drawn; a number
//                or a getter (the phone binds once and outlives its redraws)
//   commit(next, symbol) -> called with the reordered array; also called with
//                the UNCHANGED array on abort, so the caller just re-renders
//   scroller  -> what auto-scrolls under the drag (the list column on the
//                board, the page on the phone)
export function attachReorder(list, { order, cap = null, commit, scroller = list }) {
  const capOf = () => (typeof cap === 'function' ? cap() : cap);
  list.addEventListener('pointerdown', (down) => {
    const handle = down.target.closest?.('[data-reorder]');
    if (!handle || !list.contains(handle)) return;
    const row = handle.closest('[data-sym]');
    if (row) startDrag({ list, row, handle, down, order, cap: capOf(), commit, scroller });
  });
  // Keyboard path for /setup on a laptop: the handle is a real button, so it
  // takes focus, and ↑/↓ move by one. Costs four lines and stops the handle
  // being mouse-only.
  list.addEventListener('keydown', (e) => {
    const handle = e.target.closest?.('[data-reorder]');
    if (!handle) return;
    const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!delta) return;
    e.preventDefault();
    const sym = handle.closest('[data-sym]').dataset.sym;
    commit(moveWidget(order(), sym, delta), sym);
  });
}

function startDrag({ list, row, handle, down, order, cap, commit, scroller }) {
  const pid = down.pointerId;
  const sym = row.dataset.sym;
  const from = order().indexOf(sym);
  if (from < 0) return;
  const startY = down.clientY;
  const startScroll = scroller.scrollTop;
  let live = [...order()];
  let lifted = false;
  let slot = null;
  let baseTop = 0;
  let lastY = startY;
  let raf = 0;

  handle.setPointerCapture?.(pid);

  const lift = () => {
    lifted = true;
    const h = row.offsetHeight;
    baseTop = row.offsetTop;
    slot = document.createElement('div');
    slot.className = 'tk-row tk-slot';
    slot.style.height = `${h}px`;
    row.parentNode.insertBefore(slot, row);
    // Out of flow, in the list's CONTENT coordinates, so it keeps tracking the
    // finger while the column scrolls underneath it.
    row.style.top = `${baseTop}px`;
    row.style.height = `${h}px`;
    row.classList.add('tk-row--drag');
    list.classList.add('is-reordering');
  };

  // Re-seat the rows (and the fold band, and every position number) for the
  // order the drop would produce. The lifted row stays absolutely positioned,
  // so DOM order costs it nothing.
  const reflow = () => {
    const byId = new Map([...list.querySelectorAll('[data-sym]')].map((r) => [r.dataset.sym, r]));
    const fold = list.querySelector('[data-tk-fold]');
    const frag = document.createDocumentFragment();
    live.forEach((s, i) => {
      if (fold && i === cap) frag.appendChild(fold);
      const node = s === sym ? slot : byId.get(s);
      if (node) frag.appendChild(node);
      const target = s === sym ? row : byId.get(s);
      if (!target) return;
      target.classList.toggle('tk-row--below', cap != null && i >= cap);
      const pos = target.querySelector('.tk-pos');
      if (pos) pos.textContent = String(i + 1);
    });
    list.appendChild(frag);
  };

  const track = () => {
    const dy = lastY - startY + (scroller.scrollTop - startScroll);
    row.style.transform = `translateY(${dy}px)`;
    const center = baseTop + dy + row.offsetHeight / 2;
    // Insertion index = how many OTHER rows have their midpoint above the
    // lifted row's midpoint. The placeholder holds the gap, so the comparison
    // stays stable while the list re-seats under it.
    let to = 0;
    for (const r of list.querySelectorAll('[data-sym]')) {
      if (r === row) continue;
      if (r.offsetTop + r.offsetHeight / 2 < center) to++;
      else break;
    }
    if (to !== live.indexOf(sym)) {
      live = moveWidget(live, sym, to - live.indexOf(sym));
      reflow();
    }
  };

  const step = () => {
    raf = 0;
    if (!lifted) return;
    const { top, bottom } = viewport(scroller);
    let v = 0;
    if (lastY < top + EDGE) v = -MAX_RATE * Math.min(1, (top + EDGE - lastY) / EDGE);
    else if (lastY > bottom - EDGE) v = MAX_RATE * Math.min(1, (lastY - (bottom - EDGE)) / EDGE);
    if (!v) return;
    const before = scroller.scrollTop;
    scroller.scrollTop = before + v;
    // Nothing moved (short list, or already at an end): stop the loop rather
    // than spin a frame callback for as long as the finger rests there. A
    // later pointermove restarts it.
    if (scroller.scrollTop === before) return;
    track();
    raf = requestAnimationFrame(step);
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    handle.releasePointerCapture?.(pid);
    slot?.remove();
    row.classList.remove('tk-row--drag');
    row.style.top = row.style.height = row.style.transform = '';
    list.classList.remove('is-reordering');
  };

  // Only the initiating pointer drives the gesture: a palm or a second finger
  // fires window pointermove/up with a DIFFERENT pointerId, and without this
  // guard its pointerup would commit an order the user never chose (the same
  // guard edit.js's block drag carries).
  const onMove = (e) => {
    if (e.pointerId !== pid) return;
    lastY = e.clientY;
    if (!lifted) {
      if (Math.abs(e.clientY - startY) < THRESHOLD) return;
      lift();
    }
    e.preventDefault();
    track();
    if (!raf) raf = requestAnimationFrame(step);
  };
  const onUp = (e) => {
    if (e.pointerId !== pid) return;
    const dropped = lifted;
    const to = live.indexOf(sym);
    cleanup();
    if (dropped) commit(moveWidget(order(), sym, to - from), sym);
  };
  // pointercancel (system gesture / palm): drop the listeners and re-render
  // with the ORIGINAL order, or the next stray pointerup would commit it.
  const onCancel = (e) => {
    if (e.pointerId !== pid) return;
    const dropped = lifted;
    cleanup();
    if (dropped) commit(order(), sym);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}
