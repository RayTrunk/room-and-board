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
  closeExpand,
} from '../site/js/expand.js';
import { isOverlayOpen, registeredSurfaces } from '../site/js/surfaces.js';
// A surface signs the register when its module loads, so the inventory is only
// the whole inventory if every owner has been imported. These four own the
// surfaces this file does not otherwise touch. (expand.js and textviewer.js
// are imported above for their own sake.)
import '../site/js/imageshow.js';
import '../site/js/screensaver.js';
import '../site/js/widgets/iptv.js';
import '../site/js/settings/settings.js';
import { tap as pointer } from './helpers/board.js';

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

  it('still opens for a synthesised click with no pointer gesture at all', () => {
    // RoomOS injects taps and the settings pane drives cards programmatically;
    // an unattributable click keeps its pre-existing behaviour rather than
    // leaving a board that will not open.
    const { card } = board(LINESTATUS);
    card.click();
    expect(isExpandOpen()).toBe(true);
  });
});

describe('the surfaces register is what the guards read', () => {
  // No hand-built #art-viewer here any more. This block used to fabricate the
  // one surface it happened to know about, which is the same mistake the
  // allow-list in util.js made: it could only ever test what someone had
  // remembered to type. It now enumerates the register, so every surface that
  // signs is covered by these two guards on the day it signs.

  // A registered selector, made real. The register holds exactly two shapes,
  // an id and a class chain, because those are the two ways these seven are
  // addressed in the DOM.
  const raise = (selector) => {
    const el = document.createElement('div');
    if (selector.startsWith('#')) el.id = selector.slice(1);
    else el.className = selector.slice(1).replaceAll('.', ' ');
    document.body.appendChild(el);
    return el;
  };

  it('knows all seven full-screen surfaces, and this is the whole list', () => {
    // The inventory, pinned. An eighth surface has to appear here to be
    // guarded, which is the moment to notice it: the point of the register is
    // that the list is somewhere a person reads, not scattered across the six
    // files that put things on the glass.
    expect(registeredSurfaces()).toEqual([
      { name: 'ambient', selector: '#ambient' },
      { name: 'art viewer', selector: '#art-viewer' },
      { name: 'display test', selector: '.displaytest' },
      { name: 'expand view', selector: '#expand-view' },
      { name: 'iptv full screen', selector: '.iptv--full' },
      { name: 'screensaver preview', selector: '.ss-preview' },
      { name: 'text viewer', selector: '#text-viewer' },
    ]);
  });

  // A card whose view records every time it is BUILT. That is the assertion
  // these two want rather than isExpandOpen(), because one registered surface
  // is the expand overlay itself and "did the engine build a view for this
  // card" is the question in every case, including that one.
  const countingBoard = () => {
    const built = [];
    const { card } = board(LINESTATUS, { expandable: false });
    setExpandSource(card, () => {
      built.push(1);
      return { title: 'Subway Status', bodyHtml: '<p class="statusboard">every line</p>' };
    });
    return { card, built };
  };

  it.each(registeredSurfaces())('sees $name, so no card opens under it', ({ selector }) => {
    const { card, built } = countingBoard();
    const surface = raise(selector); // this surface has taken the screen
    expect(isOverlayOpen()).toBe(true);
    card.click();
    expect(built).toHaveLength(0);

    surface.remove(); // and has stood down again
    expect(isOverlayOpen()).toBe(false);
    card.click();
    expect(built).toHaveLength(1);
  });

  it.each(registeredSurfaces())('attributes the tap that dismisses $name to $name', ({ selector }) => {
    // The retargeting case, which is the one that bites on a real panel: the
    // finger goes down on the surface, the surface closes, and the browser
    // hit-tests the trailing touch-synthesised click against the DOM that is
    // left, landing it on whatever card is now under the finger. Knowing what
    // was on screen when the finger went DOWN is the whole defence, and it is
    // only as good as the register.
    const { card, built } = countingBoard();
    const surface = raise(selector);
    pointer(surface, 'pointerdown', 300, 200);
    surface.remove();
    pointer(card, 'click', 300, 200);
    expect(built).toHaveLength(0);
  });

  // The reader ran unguarded for as long as the probe was an allow-list: the
  // text viewer's delegated listener never asked whether anything was full
  // screen, so a tap while live TV covered the board could open a reader on
  // whatever truncated row sat under the finger. These two hold it to the same
  // two guards the expand engine answers to, through the same register.
  // Same trap countingBoard sidesteps, reader edition: one raised selector IS
  // '#text-viewer', and a fabricated div with no hidden attribute satisfies
  // `hidden === false` by existing. So the probe here ignores the fabricated
  // surface and asks whether any OTHER #text-viewer is showing, which is the
  // only honest reading of "did a reader open".
  const readerShown = (except = null) =>
    [...document.querySelectorAll('#text-viewer')].some((el) => el !== except && el.hidden === false);

  it.each(registeredSurfaces())('opens no reader under $name', ({ selector }) => {
    const { grid } = board(LINESTATUS, { expandable: false });
    const row = grid.querySelector('.linestatus__text');
    const surface = raise(selector);
    row.click();
    expect(readerShown(surface)).toBe(false);

    surface.remove();
    row.click();
    expect(readerShown()).toBe(true);
  });

  it.each(registeredSurfaces())('attributes the reader tap that dismisses $name to $name', ({ selector }) => {
    const { grid } = board(LINESTATUS, { expandable: false });
    const row = grid.querySelector('.linestatus__text');
    const surface = raise(selector);
    pointer(surface, 'pointerdown', 300, 200);
    surface.remove();
    pointer(row, 'click', 300, 200);
    expect(readerShown()).toBe(false);
  });
});
