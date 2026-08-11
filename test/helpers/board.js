// The one-card board every expand test mounts, built on the REAL card.
//
// Six near-identical copies of this scaffold had drifted apart across the
// expand family, and all six forged the card markup by hand: data-w/data-h set,
// tier classes never, and that is exactly the attribute main.css branches on, so
// every one of them ran the renderer against a card no board would ever
// produce. The card here comes from site/js/card.js, the same module the
// running board and the audit harness mount through, so a test that passes is a
// test about the widget rather than about the forgery.

import { buildCard, applyCardRect } from '../../site/js/card.js';
import { initExpand } from '../../site/js/expand.js';
import { initTextViewer } from '../../site/js/textviewer.js';

// Widgets carry their own `meta`; a test that invents a card (the badge's input
// driven directly, with no widget behind it) passes a bare { id, title }.
const metaOf = (mod) => (mod?.meta ? mod : { meta: mod });

// One card, mounted wherever the caller wants it. Omit the rect for a card
// whose SIZE is not part of the test: no rect means no data-w/data-h, the way a
// board's card looks for the instant before it is placed. `parent: null` leaves
// the card out of the document entirely, for a renderer that needs nothing from
// it but the closest('.card') walk.
export function mountCard(mod, rect = null, { parent = document.body } = {}) {
  const card = buildCard(metaOf(mod));
  parent?.appendChild(card);
  return applyCardRect(card, rect);
}

// A one-card board with the delegated listeners wired, as main.js does, plus
// the #settings-root and #edit-root nodes, because the expand engine reads both
// to decide whether a tap belongs to it at all.
//
// `render` defaults to the module's own; pass one to drive a card with a
// renderer it does not export as `render` (the news family's shared newscore
// path). `textviewer: true` wires the reader as well, and an object is handed
// to initTextViewer as its options (`truncated` stands in for CSS clamping,
// which happy-dom has no layout to produce).
export function board(mod, { rect = null, vm = null, cfg = {}, render = null, textviewer = false } = {}) {
  document.body.innerHTML = `
    <div id="grid"></div>
    <div id="settings-root"></div>
    <div id="edit-root"></div>`;
  const grid = document.querySelector('#grid');
  const card = mountCard(mod, rect, { parent: grid });
  const body = card.querySelector('.card__body');
  // main.js's ORDER, not a convenient one: the expand engine registers first
  // and the reader second, which is the whole reason textviewer.js needs its
  // row exception. A scaffold that reversed them would test a board nobody has.
  initExpand(grid);
  if (textviewer) initTextViewer(grid, textviewer === true ? undefined : textviewer);
  const draw = render ?? mod?.render ?? null;
  const paint = (nextVm = vm, nextCfg = cfg) => {
    draw(body, nextVm, nextCfg);
    return card;
  };
  if (draw) paint();
  return { grid, card, body, render: paint };
}

// PointerEvent is not universally constructible under happy-dom; fall back to a
// MouseEvent carrying a pointerId, which is all the guards read.
export function tap(el, type, x = 0, y = 0, pointerId = 1) {
  const Ctor = globalThis.PointerEvent ?? globalThis.MouseEvent;
  const ev = new Ctor(type, { bubbles: true, clientX: x, clientY: y, pointerId });
  if (ev.pointerId === undefined) Object.defineProperty(ev, 'pointerId', { value: pointerId });
  el.dispatchEvent(ev);
}
