/**
 * @vitest-environment happy-dom
 *
 * One tap, one destination. Two delegated click listeners share the grid — the
 * text reader's and the expand engine's — and a card that expands can also hold
 * text the reader would claim. These are the guards that keep a single tap from
 * reaching two destinations, and keep the tap that DISMISSES a full-screen view
 * from opening the next one.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { initTextViewer, openTextViewer, closeTextViewer } from '../site/js/textviewer.js';
import {
  initExpand,
  setExpandSource,
  isExpandOpen,
  isOverlayOpen,
  closeExpand,
} from '../site/js/expand.js';

// PointerEvent is not universally constructible under happy-dom; fall back to a
// MouseEvent carrying a pointerId, which is all the guards read.
function pointer(el, type, x = 0, y = 0, pointerId = 1) {
  const Ctor = globalThis.PointerEvent ?? globalThis.MouseEvent;
  const ev = new Ctor(type, { bubbles: true, clientX: x, clientY: y, pointerId });
  if (ev.pointerId === undefined) Object.defineProperty(ev, 'pointerId', { value: pointerId });
  el.dispatchEvent(ev);
}

const LINESTATUS =
  '<div class="linestatus"><span class="linestatus__text">Downtown [1][2][3] trains are running with delays after severe weather</span></div>';
const TALERT =
  '<div class="talert"><span class="talert__text">There are some delays on the Montauk branch east of Babylon</span></div>';
const HEADLINE =
  '<div class="headline"><span class="headline__title">A headline long enough that the card has to clamp it</span><span class="headline__src">Reuters</span></div>';
const WC_ROW = '<div class="wc-row"><span class="wc-row__city">Kuala Lumpur</span></div>';
const HISTORY_ROW =
  '<div class="history"><div class="history__item"><span class="history__year">1776</span><span class="history__text">The Continental Congress adopts a resolution long enough that the card clamps it</span></div></div>';

// One card, wired exactly as main.js wires the board: the text viewer first,
// then the expand engine, both delegated on #grid. `truncated: () => true`
// stands in for CSS clamping, which happy-dom has no layout to produce.
function board(bodyHtml, { expandable = true } = {}) {
  document.body.innerHTML = `
    <div id="grid">
      <article class="card card--subway" data-widget="subway">
        <h2 class="card__title">Subway Status</h2>
        <div class="card__body">${bodyHtml}</div>
      </article>
    </div>`;
  const grid = document.querySelector('#grid');
  initTextViewer(grid, { truncated: () => true });
  initExpand(grid);
  const card = grid.querySelector('.card');
  if (expandable) {
    setExpandSource(card, () => ({ title: 'Subway Status', bodyHtml: '<p class="statusboard">every line</p>' }));
  }
  return { grid, card };
}

const readerOpen = () => document.querySelector('#text-viewer')?.hidden === false;

beforeEach(() => {
  closeExpand();
  closeTextViewer();
  document.body.innerHTML = '';
});

describe('status text defers to the card it sits on', () => {
  it('sends a truncated subway line straight to the status board, with no reader in between', () => {
    const { card } = board(LINESTATUS);
    expect(card.classList.contains('is-expandable')).toBe(true);
    card.querySelector('.linestatus__text').click();
    expect(readerOpen()).toBe(false); // the redundant intermediate is gone
    expect(isExpandOpen()).toBe(true);
    expect(document.querySelector('#expand-view .statusboard')).not.toBeNull();
  });

  it('leaves the reader in place on a card that does not expand (TfL status rows)', () => {
    const { card } = board(LINESTATUS, { expandable: false });
    expect(card.classList.contains('is-expandable')).toBe(false);
    card.querySelector('.linestatus__text').click();
    expect(readerOpen()).toBe(true);
    expect(document.querySelector('#text-viewer').textContent).toContain('severe weather');
    expect(isExpandOpen()).toBe(false);
  });

  it('defers a rail alert banner too, but only on an expandable card', () => {
    board(TALERT);
    document.querySelector('.talert__text').click();
    expect(readerOpen()).toBe(false);
    expect(isExpandOpen()).toBe(true);

    closeExpand();
    board(TALERT, { expandable: false });
    document.querySelector('.talert__text').click();
    expect(readerOpen()).toBe(true);
    expect(isExpandOpen()).toBe(false);
  });

  it('keeps a headline tap a story tap on an expandable card — and only that', () => {
    board(HEADLINE);
    document.querySelector('.headline__title').click();
    expect(readerOpen()).toBe(true);
    expect(document.querySelector('#text-viewer').textContent).toContain('has to clamp it');
    expect(isExpandOpen()).toBe(false); // no board opening behind the story
  });

  it('keeps a world-clock city tap on its reader on an expandable card', () => {
    board(WC_ROW);
    document.querySelector('.wc-row__city').click();
    expect(readerOpen()).toBe(true);
    expect(isExpandOpen()).toBe(false);
  });

  it('gives history rows no reader at all: the rows ARE the card, so they open the day', () => {
    // History rows cover nearly the whole card, so a per-row reader swallowed
    // the taps meant for the day view. The rows left the reader entirely
    // rather than deferring, which would have restored them on a card that
    // happens not to expand.
    board(HISTORY_ROW);
    document.querySelector('.history__text').click();
    expect(readerOpen()).toBe(false);
    expect(isExpandOpen()).toBe(true);

    closeExpand();
    board(HISTORY_ROW, { expandable: false });
    document.querySelector('.history__text').click();
    expect(readerOpen()).toBe(false);
    expect(isExpandOpen()).toBe(false);
  });
});

describe('a tap that closes an overlay never opens another', () => {
  it('opens on a clean press of the card', () => {
    const { card } = board(LINESTATUS);
    pointer(card, 'pointerdown', 300, 200);
    pointer(card, 'pointerup', 300, 200);
    pointer(card, 'click', 302, 201);
    expect(isExpandOpen()).toBe(true);
  });

  it('refuses a click retargeted off the reader onto the card underneath', () => {
    const { card } = board(LINESTATUS);
    openTextViewer('Subway Status', 'Downtown trains are running with delays');
    expect(isOverlayOpen()).toBe(true);
    // The finger goes down on the reader; the reader closes; the trailing click
    // is hit-tested against the DOM that is left and lands on the card.
    pointer(document.querySelector('#text-viewer'), 'pointerdown', 300, 200);
    closeTextViewer();
    pointer(card, 'click', 300, 200);
    expect(isExpandOpen()).toBe(false);
  });

  it('refuses a click retargeted off the status board itself (no reopen loop)', () => {
    const { card } = board(LINESTATUS);
    card.click();
    expect(isExpandOpen()).toBe(true);
    pointer(document.querySelector('#expand-view'), 'pointerdown', 400, 400);
    closeExpand();
    pointer(card, 'click', 400, 400);
    expect(isExpandOpen()).toBe(false);
  });

  it('refuses a press that began on a different card', () => {
    const { grid, card } = board(LINESTATUS);
    const other = document.createElement('article');
    other.className = 'card';
    grid.appendChild(other);
    pointer(other, 'pointerdown', 100, 100);
    pointer(card, 'click', 100, 100);
    expect(isExpandOpen()).toBe(false);
  });

  it('refuses to stack under any live full-screen view, including the art viewer', () => {
    const { card } = board(LINESTATUS);
    const art = document.createElement('div');
    art.id = 'art-viewer';
    document.body.appendChild(art); // visible: the art card was tapped
    expect(isOverlayOpen()).toBe(true);
    card.click();
    expect(isExpandOpen()).toBe(false);

    art.hidden = true;
    expect(isOverlayOpen()).toBe(false);
    card.click();
    expect(isExpandOpen()).toBe(true);
  });

  it('still opens for a synthesised click with no pointer gesture at all', () => {
    // RoomOS injects taps and the settings pane drives cards programmatically;
    // an unattributable click keeps its pre-existing behaviour rather than
    // leaving a board that will not open.
    const { card } = board(LINESTATUS);
    card.click();
    expect(isExpandOpen()).toBe(true);
  });
});
