/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  openExpand,
  closeExpand,
  isExpandOpen,
  isEditing,
  initExpand,
  setExpandSource,
  EXPAND_IDLE_MS,
} from '../site/js/expand.js';
import { render as renderMarkets, tileWall, tileCols, shelfCols } from '../site/js/widgets/markets.js';

const NAMES = {
  '^DJI': 'Dow Jones',
  '^IXIC': 'Nasdaq',
  '^GSPC': 'S&P 500',
  AAPL: 'Apple',
  MSFT: 'Microsoft',
  NVDA: 'NVIDIA',
  GOOGL: 'Alphabet',
  AMZN: 'Amazon.com',
  TSLA: 'Tesla',
  META: 'Meta Platforms',
};

// A view model in CONFIG ORDER, the way mapMarkets hands it over.
const vmOf = (symbols, price = 100) => ({
  updatedAt: 1783000500,
  stale: false,
  indices: symbols.map((symbol, i) => ({
    symbol,
    name: NAMES[symbol] ?? symbol,
    price: price + i,
    change: i % 2 ? -1.25 : 2.5,
    changePct: i % 2 ? -0.4 : 0.8,
    spark: [98, 99, 97, 100, 101, price + i],
    spark2: [95, 96, 94, 97, 98, 99, 97, 100, 101, price + i],
    split: 5,
  })),
});

// PointerEvent is not universally constructible under happy-dom; fall back to a
// MouseEvent carrying a pointerId, which is all the guards read.
function pointer(el, type, x = 0, y = 0, pointerId = 1) {
  const Ctor = globalThis.PointerEvent ?? globalThis.MouseEvent;
  const ev = new Ctor(type, { bubbles: true, clientX: x, clientY: y, pointerId });
  if (ev.pointerId === undefined) Object.defineProperty(ev, 'pointerId', { value: pointerId });
  el.dispatchEvent(ev);
}

// A one-card board with the delegated expand listener wired, as main.js does.
function board(vm, [w, h] = [3, 2]) {
  document.body.innerHTML = `
    <div id="grid">
      <article class="card card--markets" data-widget="markets" data-w="${w}" data-h="${h}">
        <h2 class="card__title">Markets</h2>
        <div class="card__body"></div>
        <div class="card__stamp" hidden></div>
      </article>
    </div>
    <div id="settings-root"></div>
    <div id="edit-root"></div>`;
  const grid = document.querySelector('#grid');
  initExpand(grid);
  const card = grid.querySelector('.card');
  renderMarkets(card.querySelector('.card__body'), vm, { clock24: false });
  return { grid, card };
}

const overlay = () => document.querySelector('#expand-view');

beforeEach(() => {
  closeExpand();
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('expand engine', () => {
  it('opens a full-screen snapshot and closes on a tap of empty space', () => {
    expect(openExpand({ title: 'Markets', note: 'as of 11:51 AM', bodyHtml: '<p class="x">hi</p>' })).toBe(true);
    expect(isExpandOpen()).toBe(true);
    expect(overlay().hidden).toBe(false);
    expect(overlay().textContent).toContain('Markets');
    expect(overlay().textContent).toContain('as of 11:51 AM');
    expect(overlay().querySelector('.x')).not.toBeNull();
    expect(overlay().textContent).toContain('Tap anywhere to close');

    overlay().click();
    expect(isExpandOpen()).toBe(false);
    expect(overlay().innerHTML).toBe(''); // snapshot released
  });

  it('is a single instance: opening while open is a no-op', () => {
    openExpand({ title: 'Markets', bodyHtml: '<p>first</p>' });
    expect(openExpand({ title: 'Other', bodyHtml: '<p>second</p>' })).toBe(false);
    expect(document.querySelectorAll('.expand').length).toBe(1);
    expect(overlay().textContent).toContain('first');
    expect(overlay().textContent).not.toContain('second');
  });

  it('auto-closes after the idle window, and any pointer activity resets it', () => {
    vi.useFakeTimers();
    openExpand({ title: 'Markets', bodyHtml: '<p>x</p>' });
    vi.advanceTimersByTime(EXPAND_IDLE_MS - 1);
    expect(isExpandOpen()).toBe(true);
    // A touch anywhere on the overlay restarts the full window.
    pointer(overlay(), 'pointerdown', 400, 400);
    vi.advanceTimersByTime(EXPAND_IDLE_MS - 1);
    expect(isExpandOpen()).toBe(true);
    vi.advanceTimersByTime(2);
    expect(isExpandOpen()).toBe(false);
  });

  it('stops the idle timer on close, so a reopened overlay is not cut short', () => {
    vi.useFakeTimers();
    openExpand({ title: 'Markets', bodyHtml: '<p>x</p>' });
    closeExpand();
    openExpand({ title: 'Markets', bodyHtml: '<p>x</p>' });
    vi.advanceTimersByTime(EXPAND_IDLE_MS - 1);
    expect(isExpandOpen()).toBe(true);
  });

  it('refuses to open while edit mode is active (taps belong to layout editing)', () => {
    board(vmOf(['^DJI', '^IXIC', '^GSPC', 'AAPL', 'MSFT', 'NVDA']));
    document.querySelector('#edit-root').innerHTML = '<div class="editor"></div>';
    expect(isEditing()).toBe(true);
    document.querySelector('.card').click();
    expect(isExpandOpen()).toBe(false);
    expect(openExpand({ title: 'Markets', bodyHtml: '<p>x</p>' })).toBe(false);

    document.querySelector('#edit-root').innerHTML = '';
    expect(isEditing()).toBe(false);
    document.querySelector('.card').click();
    expect(isExpandOpen()).toBe(true);
  });

  it('refuses to open behind the settings pane', () => {
    board(vmOf(['^DJI', '^IXIC', '^GSPC', 'AAPL', 'MSFT', 'NVDA']));
    document.querySelector('#settings-root').innerHTML = '<div class="settings"></div>';
    document.querySelector('.card').click();
    expect(isExpandOpen()).toBe(false);
  });

  it('carries the source card stale stamp through to the overlay', () => {
    const { card } = board(vmOf(['^DJI', '^IXIC', '^GSPC', 'AAPL', 'MSFT', 'NVDA']));
    const stamp = card.querySelector('.card__stamp');
    stamp.textContent = 'as of 9:12 AM';
    stamp.hidden = false;
    card.classList.add('is-stale');
    card.click();
    expect(overlay().classList.contains('is-stale')).toBe(true);
    expect(overlay().querySelector('.expand__stamp').textContent).toBe('as of 9:12 AM');
  });

  it('ignores a drag: only a press opens the card', () => {
    const { card } = board(vmOf(['^DJI', '^IXIC', '^GSPC', 'AAPL', 'MSFT', 'NVDA']));
    pointer(card, 'pointerdown', 100, 400);
    pointer(card, 'click', 400, 405); // travelled 300px — a swipe, not a tap
    expect(isExpandOpen()).toBe(false);
  });

  it('setExpandSource no-ops on an element with no card (test fakes)', () => {
    expect(() => setExpandSource({}, () => ({}))).not.toThrow();
    expect(() => setExpandSource(null, null)).not.toThrow();
  });
});

describe('markets card tap', () => {
  it('opens every configured ticker when the +N badge is showing', () => {
    const symbols = ['^DJI', '^IXIC', '^GSPC', 'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN'];
    const { card } = board(vmOf(symbols));
    expect(card.querySelector('.card__more')).not.toBeNull(); // badge = the signifier
    expect(card.classList.contains('is-expandable')).toBe(true);
    expect(card.querySelectorAll('.index').length).toBeLessThan(symbols.length); // card is capped

    card.click();
    expect(isExpandOpen()).toBe(true);
    expect(overlay().querySelectorAll('.tile').length).toBe(symbols.length);
    for (const s of symbols) {
      expect(overlay().textContent).toContain(NAMES[s]);
    }
    expect(overlay().querySelector('.expand__title').textContent).toBe('Markets');
    expect(overlay().querySelector('.expand__note').textContent).toMatch(/^as of /);
  });

  it('is inert when nothing is hidden: no badge, no expansion', () => {
    const { card } = board(vmOf(['^DJI', '^IXIC', '^GSPC']), [4, 8]);
    expect(card.querySelector('.card__more')).toBeNull();
    expect(card.classList.contains('is-expandable')).toBe(false);
    card.click();
    expect(isExpandOpen()).toBe(false);
  });

  it('drops the expansion when a refresh leaves nothing hidden', () => {
    const { card } = board(vmOf(['^DJI', '^IXIC', '^GSPC', 'AAPL', 'MSFT', 'NVDA']));
    expect(card.classList.contains('is-expandable')).toBe(true);
    renderMarkets(card.querySelector('.card__body'), vmOf(['^DJI']), { clock24: false });
    expect(card.classList.contains('is-expandable')).toBe(false);
    card.click();
    expect(isExpandOpen()).toBe(false);
  });

  it('keeps the snapshot when the source card re-renders underneath it', () => {
    const symbols = ['^DJI', '^IXIC', '^GSPC', 'AAPL', 'MSFT', 'NVDA'];
    const { card } = board(vmOf(symbols, 100));
    card.click();
    const before = overlay().innerHTML;
    expect(overlay().textContent).toContain('Apple');

    // The 5-minute refresh lands mid-read with different data.
    renderMarkets(card.querySelector('.card__body'), vmOf(['^DJI', 'TSLA', 'META'], 900), { clock24: false });
    expect(overlay().innerHTML).toBe(before);
    expect(overlay().textContent).toContain('Apple');
    expect(overlay().textContent).not.toContain('Tesla');
  });
});

describe('markets ticker wall', () => {
  const tilesOf = (html, sel) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return [...host.querySelectorAll(`${sel} .tile`)].map((t) => ({
      lead: t.querySelector('.tile__sym').textContent,
      sub: t.querySelector('.tile__name').textContent,
      index: t.classList.contains('tile--index'),
    }));
  };
  const wallOf = (html) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.querySelector('.wall');
  };

  it('shelves the indices above the stock grid, each in config order', () => {
    const html = tileWall(vmOf(['^DJI', '^IXIC', '^GSPC', 'AAPL', 'MSFT']).indices);
    expect(tilesOf(html, '.wall__shelf').map((t) => t.lead)).toEqual(['Dow Jones', 'Nasdaq', 'S&P 500']);
    expect(tilesOf(html, '.wall__grid').map((t) => t.lead)).toEqual(['AAPL', 'MSFT']);
    expect(wallOf(html).querySelector('.wall__rule')).not.toBeNull();
  });

  it('renders indices name-first and stocks symbol-first', () => {
    const html = tileWall(vmOf(['^DJI', 'AAPL']).indices);
    const [index] = tilesOf(html, '.wall__shelf');
    const [stock] = tilesOf(html, '.wall__grid');
    expect(index).toEqual({ lead: 'Dow Jones', sub: '^DJI', index: true });
    expect(stock).toEqual({ lead: 'AAPL', sub: 'Apple', index: false });
  });

  it('groups an interleaved config without reordering within a group', () => {
    const html = tileWall(vmOf(['AAPL', '^DJI', 'MSFT', '^GSPC', 'NVDA']).indices);
    expect(tilesOf(html, '.wall__shelf').map((t) => t.sub)).toEqual(['^DJI', '^GSPC']);
    expect(tilesOf(html, '.wall__grid').map((t) => t.lead)).toEqual(['AAPL', 'MSFT', 'NVDA']);
  });

  it('drops the shelf entirely when the indices are removed (full-canvas grid)', () => {
    const html = tileWall(vmOf(['AAPL', 'MSFT', 'NVDA']).indices);
    const wall = wallOf(html);
    expect(wall.querySelector('.wall__shelf')).toBeNull();
    expect(wall.querySelector('.wall__rule')).toBeNull();
    expect(wall.querySelectorAll('.wall__grid .tile').length).toBe(3);
    expect(wall.classList.contains('wall--shelf-only')).toBe(false);
  });

  it('renders the shelf alone when the config is indices only', () => {
    const html = tileWall(vmOf(['^DJI', '^IXIC', '^GSPC']).indices);
    const wall = wallOf(html);
    expect(wall.querySelector('.wall__grid')).toBeNull();
    expect(wall.querySelector('.wall__rule')).toBeNull();
    expect(wall.querySelectorAll('.wall__shelf .tile').length).toBe(3);
    expect(wall.classList.contains('wall--shelf-only')).toBe(true);
  });

  it('uses the compact single-session sparkline in tiles (no day divider)', () => {
    const wall = wallOf(tileWall(vmOf(['^DJI', 'AAPL']).indices));
    expect(wall.querySelectorAll('.tile__spark').length).toBe(2);
    expect(wall.querySelector('.spark__div')).toBeNull();
    expect(wall.querySelector('.spark__prev')).toBeNull();
  });

  it('escapes ticker names', () => {
    const wall = wallOf(tileWall([
      { symbol: 'X<Y', name: '<img src=x>', price: 1, change: 1, changePct: 1, spark: [1, 2] },
    ]));
    expect(wall.querySelector('img')).toBeNull();
    expect(wall.querySelector('.tile__sym').textContent).toBe('X<Y');
  });

  it('sizes the grid to the ticker count', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => tileCols(n))).toEqual([1, 2, 3, 2, 3, 3, 4, 4, 5, 5]);
  });

  it('keeps shelf tiles wide enough for their big price type', () => {
    // 5 across measures 340px, which overflows a 46px six-figure price.
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(shelfCols)).toEqual([1, 2, 3, 4, 3, 3, 4, 4, 4, 4]);
  });

  it('trades grid columns for rows when a tall shelf eats the canvas', () => {
    expect(tileCols(4, 1)).toBe(2); // one shelf row: 2x2 still fits
    expect(tileCols(4, 2)).toBe(4); // two shelf rows: one row of four, or the tiles clip
    const html = tileWall(vmOf(['^DJI', '^IXIC', '^GSPC', '^FTSE', '^N225', '^RUT', 'AAPL', 'MSFT', 'NVDA', 'GOOGL']).indices);
    const wall = wallOf(html);
    expect(wall.querySelector('.wall__shelf').getAttribute('style')).toContain('--cols:3'); // 6 indices, 2 rows
    expect(wall.querySelector('.wall__grid').getAttribute('style')).toContain('--cols:4');
  });
});
