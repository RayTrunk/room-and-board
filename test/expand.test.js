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
import {
  render as renderMarkets, tileWall, tileCols, shelfCols, shelfFits, wallHeight, WALL_H,
} from '../site/js/widgets/markets.js';
import {
  render as renderSubway,
  statusBoard,
  alertStep,
  alertColumns,
  alertColHeights,
  bandRows,
  alertsAvail,
  wellHeight,
  statusLabel,
  STATUS_RULES,
  STATUS_FALLBACK,
  ALERT_STEPS,
  fitStatusBoard,
} from '../site/js/widgets/subway.js';
import { render as renderWeather } from '../site/js/widgets/weather.js';
import { fmtClock } from '../site/js/util.js';
import { DEMO_VMS } from '../site/demo/fixtures.js';

// The freshness stamp every card writes is an EPOCH rendered in the runner's
// local timezone, so a literal ("as of 9:55 AM") only holds on a New York
// machine: CI runs UTC and reads the same instant as 1:55 PM. Derive the
// expected string through fmtClock, the one formatter the widgets use, so the
// assertion tests the wiring rather than the runner's clock. (Pinning
// process.env.TZ instead would hide real timezone bugs everywhere else.)
const STAMP_EPOCH = 1783000500;
const AS_OF = `as of ${fmtClock(STAMP_EPOCH)}`;

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
  updatedAt: STAMP_EPOCH,
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
    expect(overlay().querySelector('.expand__note').textContent).toBe(AS_OF);
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

  // ---- the 20-ticker cap: browser-measured on the 1920x1080 overlay ----

  const symbols = (n, prefix = 'TK') => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(2, '0')}`);
  const indexSymbols = (n) => Array.from({ length: n }, (_, i) => `^IX${i}`);

  it('takes a sixth column only under a shelf, and marks it dense', () => {
    // A one-row shelf leaves 536px of the board's 814px canvas: TWO rows of
    // tiles, so twelve stocks go six across. (On the 854px canvas the harness
    // used to report, the same shelf left room for three rows — and those rows
    // were 165px tiles against a 163px floor, which is what cropped the company
    // name off every tile on a real board.)
    expect(tileCols(12, 1)).toBe(6);
    expect(tileCols(20)).toBe(5); // no shelf: 4 rows of 5 keeps the wider tile
    expect(tileCols(30, 1)).toBe(6); // six is the ceiling; seven ellipses GOOGL
    const wall = wallOf(tileWall(vmOf([...indexSymbols(4), ...symbols(12)]).indices));
    expect(wall.querySelector('.wall__grid').classList.contains('wall__grid--dense')).toBe(true);
    expect(wallOf(tileWall(vmOf(symbols(20)).indices))
      .querySelector('.wall__grid').classList.contains('wall__grid--dense')).toBe(false);
  });

  it('gives the shelf up when reserving it would squeeze the watchlist', () => {
    // 1 index + 19 stocks: the shelf's 278px band leaves room for three grid
    // rows, and 19 tiles need four. The indices fold back in as ordinary tiles.
    const wall = wallOf(tileWall(vmOf(['^DJI', ...symbols(19)]).indices));
    expect(wall.querySelector('.wall__shelf')).toBeNull();
    expect(wall.querySelector('.wall__rule')).toBeNull();
    expect(wall.querySelectorAll('.wall__grid .tile').length).toBe(20);
    expect(wall.querySelector('.wall__grid').getAttribute('style')).toContain('--cols:5');
    // Config order survives the fold: the index keeps its place in the list.
    expect(tilesOf(wall.outerHTML, '.wall__grid')[0].sub).toBe('^DJI');
  });

  it('keeps the shelf whenever the watchlist below it still fits', () => {
    // Twelve stocks are two rows of six under a one-row shelf: 648px of the
    // board's 814px canvas, so the shelf is affordable at any index count.
    for (const nIdx of [1, 2, 3, 4]) {
      const wall = wallOf(tileWall(vmOf([...indexSymbols(nIdx), ...symbols(12)]).indices));
      expect(wall.querySelectorAll('.wall__shelf .tile').length).toBe(nIdx);
      expect(wall.querySelectorAll('.wall__grid .tile').length).toBe(12);
      expect(wall.querySelector('.wall__rule')).not.toBeNull();
    }
  });

  it('folds the shelf once the watchlist needs a third row it cannot have', () => {
    // Thirteen and up: the grid wants three rows behind the shelf and the
    // corrected canvas holds two, so the indices give up the shelf and rejoin
    // the grid as ordinary tiles — the wall's designed degradation. On the
    // over-reported 854px canvas this kept the shelf and squeezed the grid to
    // 165px rows, where the browser cropped 13px off every company name.
    for (const nIdx of [1, 2, 3, 4]) {
      const n = 13;
      const wall = wallOf(tileWall(vmOf([...indexSymbols(nIdx), ...symbols(n)]).indices));
      expect(wall.querySelector('.wall__shelf')).toBeNull();
      expect(wall.querySelectorAll('.wall__grid .tile').length).toBe(nIdx + n);
      expect(wallHeight(0, nIdx + n)).toBeLessThanOrEqual(WALL_H);
    }
  });

  it('shows only what the Worker actually sent, with honest badge math', () => {
    // The site half of the cap raise ships before the Worker's. Until the
    // Worker promote, a board configured with 20 tickers is answered with the
    // first 10, so the card and the wall are built from the PAYLOAD, never from
    // the config: 10 tiles, and a +N badge that counts the 10 it has.
    const { card } = board(vmOf(symbols(10)), [3, 2]);
    const badge = Number(card.querySelector('.card__more').textContent.replace(/\D/g, ''));
    const rows = card.querySelectorAll('.index').length;
    expect(rows + badge).toBe(10); // never 20: nothing is invented for the missing ten
    card.querySelector('.card__body').click();
    expect(document.querySelectorAll('#expand-view .tile').length).toBe(10);
  });

  it('folds the shelf when its rows leave no room for a grid row', () => {
    // Nine indices wrap to three 225px shelf rows: 768px with the hairline, so
    // 86px of canvas is left and a grid tile's floor is 175. maxRows used to
    // clamp that to "one row fits" and the wall approved a 943px layout on an
    // 854px canvas — the indices overflowed the overlay instead of folding.
    expect(shelfFits(9, 3)).toBe(false);
    const wall = wallOf(tileWall(vmOf([...indexSymbols(9), ...symbols(3)]).indices));
    expect(wall.querySelector('.wall__shelf')).toBeNull();
    expect(wall.querySelector('.wall__rule')).toBeNull();
    expect(wall.querySelectorAll('.wall__grid .tile').length).toBe(12);
    expect(wallHeight(0, 12)).toBeLessThanOrEqual(WALL_H);
  });

  it('models no wall taller than the canvas, at any split of the 20-ticker cap', () => {
    for (let nShelf = 0; nShelf <= 20; nShelf += 1) {
      for (let nRest = 0; nShelf + nRest <= 20; nRest += 1) {
        if (!nShelf && !nRest) continue;
        // What tileWall would actually build for this split: shelf + grid, or
        // one folded grid of everything.
        const h = shelfFits(nShelf, nRest)
          ? wallHeight(nShelf, nRest)
          : wallHeight(0, nShelf + nRest);
        expect(h, `${nShelf} indices + ${nRest} stocks`).toBeLessThanOrEqual(WALL_H);
      }
    }
  });

  it('folds an indices-only wall into a grid past three shelf rows', () => {
    // 12 indices are three 225px shelf rows (715px) — the last that fits.
    const twelve = wallOf(tileWall(vmOf(indexSymbols(12)).indices));
    expect(twelve.querySelectorAll('.wall__shelf .tile').length).toBe(12);
    expect(twelve.classList.contains('wall--shelf-only')).toBe(true);
    const twenty = wallOf(tileWall(vmOf(indexSymbols(20)).indices));
    expect(twenty.querySelector('.wall__shelf')).toBeNull();
    expect(twenty.querySelectorAll('.wall__grid .tile').length).toBe(20);
    expect(twenty.classList.contains('wall--shelf-only')).toBe(false);
  });
});

// ---------------------------------------------------------------- subway ----

// Real MTA copy: the digest hands over the header verbatim. SHORT is one line at
// every rung of the ladder; LONG is the longest alert the feed realistically
// carries, and takes two lines even full width.
const SHORT = '[E] trains are running with delays in both directions.';
const LONG =
  'Southbound [Q] trains are stopping along the [R] line from Canal St to DeKalb Av while we perform track maintenance at the Manhattan Bridge.';
const SECOND = '[F] trains are rerouted via the [E] line between 21 St-Queensbridge and 47-50 Sts.';

const LINE_IDS = ['1', '2', '3', '4', '5', '6', '7', 'A', 'C', 'E', 'B', 'D', 'F', 'M', 'G', 'J', 'Z', 'L', 'N', 'Q', 'R', 'W', 'S', 'SI'];

// `alerts` alerting lines first (config order is preserved as written), then
// `good` healthy ones — the shape mapSubwayStatus produces.
const subwayVm = (alerts, good, headers = [SHORT]) => ({
  updatedAt: STAMP_EPOCH,
  stale: false,
  lines: [
    ...LINE_IDS.slice(0, alerts).map((line) => ({ line, ok: false, headers })),
    ...LINE_IDS.slice(alerts, alerts + good).map((line) => ({ line, ok: true, headers: [] })),
  ],
});

const alerting = (n, headers = [SHORT]) => subwayVm(n, 0, headers).lines;

function subwayBoard(vm, [w, h] = [3, 4]) {
  document.body.innerHTML = `
    <div id="grid">
      <article class="card card--subway" data-widget="subway" data-w="${w}" data-h="${h}">
        <h2 class="card__title">Subway Status</h2>
        <div class="card__body"></div>
        <div class="card__stamp" hidden></div>
      </article>
    </div>
    <div id="settings-root"></div>
    <div id="edit-root"></div>`;
  const grid = document.querySelector('#grid');
  initExpand(grid);
  const card = grid.querySelector('.card');
  renderSubway(card.querySelector('.card__body'), vm, { clock24: false });
  return { grid, card };
}

const wallOf = (html) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.querySelector('.wall');
};
const textOf = (el) => el.textContent.replace(/\s+/g, ' ').trim();

describe('subway card tap', () => {
  it('opens every configured line when the +N badge is showing', () => {
    const vm = subwayVm(2, 10); // 12 lines, a 3x4 card holds 6
    const { card } = subwayBoard(vm);
    expect(card.querySelector('.card__more')).not.toBeNull(); // badge = the signifier
    expect(card.classList.contains('is-expandable')).toBe(true);
    expect(card.querySelectorAll('.linestatus').length).toBeLessThan(vm.lines.length);

    card.click();
    expect(isExpandOpen()).toBe(true);
    expect(overlay().querySelector('.expand__title').textContent).toBe('Subway Status');
    expect(overlay().querySelector('.expand__note').textContent).toBe(`2 of 12 lines with alerts · ${AS_OF}`);
    // Every line is present: 10 in the band, 2 as wells.
    expect(overlay().querySelectorAll('.wall__bullets .bullet').length).toBe(10);
    expect(overlay().querySelectorAll('.sbalert').length).toBe(2);
  });

  it('is inert when nothing is hidden: no badge, no expansion', () => {
    // A 4x8 card holds 15 rows, so a 5-line config hides nothing.
    const { card } = subwayBoard(subwayVm(1, 4), [4, 8]);
    expect(card.querySelector('.card__more')).toBeNull();
    expect(card.classList.contains('is-expandable')).toBe(false);
    card.click();
    expect(isExpandOpen()).toBe(false);
  });

  it('stays inert for an all-healthy card that fits (the badge and the tap agree)', () => {
    const { card } = subwayBoard(subwayVm(0, 6), [3, 4]); // cap 6, six lines
    expect(card.querySelector('.card__more')).toBeNull();
    expect(card.classList.contains('is-expandable')).toBe(false);
    card.click();
    expect(isExpandOpen()).toBe(false);
  });

  it('drops its title-line note and the alert count when every line is good', () => {
    const { card } = subwayBoard(subwayVm(0, 12));
    card.click();
    expect(overlay().querySelector('.expand__note').textContent).toBe(AS_OF);
    expect(overlay().querySelector('.wall__alerts')).toBeNull();
  });

  it('drops the expansion when a refresh leaves nothing hidden', () => {
    const { card } = subwayBoard(subwayVm(2, 10));
    expect(card.classList.contains('is-expandable')).toBe(true);
    renderSubway(card.querySelector('.card__body'), subwayVm(1, 2), { clock24: false });
    expect(card.classList.contains('is-expandable')).toBe(false);
    card.click();
    expect(isExpandOpen()).toBe(false);
  });

  it('drops the expansion when the lines are unconfigured (setup prompt)', () => {
    const { card } = subwayBoard(subwayVm(2, 10));
    expect(card.classList.contains('is-expandable')).toBe(true);
    renderSubway(card.querySelector('.card__body'), { lines: [] }, { clock24: false });
    expect(card.classList.contains('is-expandable')).toBe(false);
    card.click();
    expect(isExpandOpen()).toBe(false);
  });

  it('keeps the snapshot when the source card re-renders underneath it', () => {
    const { card } = subwayBoard(subwayVm(2, 10, [LONG]));
    card.click();
    const before = overlay().innerHTML;
    expect(overlay().textContent).toContain('DeKalb Av');
    renderSubway(card.querySelector('.card__body'), subwayVm(3, 9, [SHORT]), { clock24: false });
    expect(overlay().innerHTML).toBe(before);
  });

  it('carries the card stale stamp through', () => {
    const { card } = subwayBoard(subwayVm(2, 10));
    const stamp = card.querySelector('.card__stamp');
    stamp.textContent = 'as of 8:12 AM';
    stamp.hidden = false;
    card.click();
    expect(overlay().classList.contains('is-stale')).toBe(true);
    expect(overlay().querySelector('.expand__stamp').textContent).toBe('as of 8:12 AM');
  });
});

describe('subway status board', () => {
  it('splits the lines into one bullet band and a well per problem line', () => {
    const wall = wallOf(statusBoard(subwayVm(2, 5).lines));
    expect([...wall.querySelectorAll('.wall__bullets .bullet')].map((b) => b.textContent))
      .toEqual(['3', '4', '5', '6', '7']);
    expect([...wall.querySelectorAll('.sbalert .bullet')].map((b) => b.textContent)).toEqual(['1', '2']);
    expect(textOf(wall.querySelector('.wall__count'))).toBe('5 of 7 lines');
    expect(wall.querySelector('.wall__rule')).not.toBeNull();
  });

  it('keeps config order in both bands, however the lines interleave', () => {
    const lines = [
      { line: 'Q', ok: true, headers: [] },
      { line: 'F', ok: false, headers: [SHORT] },
      { line: '7', ok: true, headers: [] },
      { line: 'A', ok: false, headers: [SHORT] },
      { line: '1', ok: true, headers: [] },
    ];
    const wall = wallOf(statusBoard(lines));
    expect([...wall.querySelectorAll('.wall__bullets .bullet')].map((b) => b.textContent)).toEqual(['Q', '7', '1']);
    expect([...wall.querySelectorAll('.sbalert .bullet')].map((b) => b.textContent)).toEqual(['F', 'A']);
  });

  it('suppresses the band entirely when no line is healthy (no empty band, no reserved space)', () => {
    const wall = wallOf(statusBoard(alerting(4)));
    expect(wall.querySelector('.wall__good')).toBeNull();
    expect(wall.querySelector('.wall__rule')).toBeNull();
    expect(wall.querySelectorAll('.sbalert').length).toBe(4);
    expect(wall.classList.contains('wall--good-only')).toBe(false);
  });

  it('renders the band alone, centered, when every line is good', () => {
    const wall = wallOf(statusBoard(subwayVm(0, 24).lines));
    expect(wall.querySelectorAll('.wall__bullets .bullet').length).toBe(24);
    expect(wall.querySelector('.wall__alerts')).toBeNull();
    expect(wall.querySelector('.wall__rule')).toBeNull();
    expect(wall.classList.contains('wall--good-only')).toBe(true);
  });

  it('renders EVERY header a line carries, stacked — including the one the card drops', () => {
    const wall = wallOf(statusBoard(subwayVm(1, 3, [LONG, SECOND]).lines));
    const paras = [...wall.querySelectorAll('.sbalert__text p')];
    // The header copy is the paragraph's last node — the lead one leads with a pill.
    expect(paras.map((p) => p.lastChild.textContent)).toEqual([LONG, SECOND]);
    // Grouped under the one line: two headers, one bullet, one well.
    expect(wall.querySelectorAll('.sbalert').length).toBe(1);
    expect(wall.querySelectorAll('.sbalert .bullet').length).toBe(1);
  });

  it('escapes line ids and alert copy', () => {
    const wall = wallOf(statusBoard([
      { line: '<b>', ok: false, headers: ['<img src=x onerror=1>'] },
      { line: 'Q"', ok: true, headers: [] },
    ]));
    expect(wall.querySelector('img')).toBeNull();
    expect(wall.querySelector('b')).toBeNull();
    expect(wall.querySelector('.sbalert__text p').lastChild.textContent).toBe('<img src=x onerror=1>');
    // The pill is derived from that same copy, so it is escaped on the same path.
    expect(wall.querySelector('.sbstatus').textContent).toBe('Service alert');
  });
});

describe('subway adaptive columns', () => {
  const stepOf = (n, good = 0, headers = [SHORT]) =>
    alertStep(subwayVm(n, good, headers).lines.filter((l) => !l.ok), bandRows(good));
  const alertsEl = (lines) => wallOf(statusBoard(lines)).querySelector('.wall__alerts');
  const split = (el) => el.classList.contains('wall__alerts--split');

  // Browser-measured on the 1920x1080 overlay: a one-line alert well is 120px
  // and the gap floor is 18, so 741px of canvas under a one-row band holds five
  // (672px) and not six (810px).
  it('holds five wells in one full-width column and flows the sixth into two', () => {
    expect(stepOf(5, 7).cols).toBe(1);
    expect(stepOf(6, 6).cols).toBe(2);
    expect(split(alertsEl(subwayVm(5, 7).lines))).toBe(false);
    expect(split(alertsEl(subwayVm(6, 6).lines))).toBe(true);
  });

  it('moves the boundary with the canvas the band leaves behind', () => {
    // Five is the one-column ceiling with a band (680px of 701) and WITHOUT one
    // too: six wells want 820px and the whole corrected canvas is 814. Dropping
    // the canvas from the harness's 854 to the board's real 814 cost the wall
    // exactly this — a bandless morning used to buy back the sixth well, and on
    // a board it never could.
    expect(stepOf(5, 0).cols).toBe(1);
    expect(stepOf(6, 0).cols).toBe(2);
    // A band that wraps to a second row (18+ healthy lines) costs a well: four.
    expect(bandRows(18)).toBe(2);
    expect(stepOf(4, 18).cols).toBe(1);
    expect(stepOf(5, 18).cols).toBe(2);
  });

  it('measures the canvas the band and its hairline take', () => {
    // The BOARD's canvas (1040 − the chrome), not the 1080 headless harness's.
    expect(alertsAvail(0)).toBe(814); // no band: the whole body
    expect(alertsAvail(1)).toBe(701); // 60px band + 53px hairline block
    expect(alertsAvail(2)).toBe(625);
    expect(bandRows(0)).toBe(0);
    expect([1, 17, 18, 24].map(bandRows)).toEqual([1, 1, 2, 2]);
  });

  it('spends its slack on size first: two columns keep the big type before it steps down', () => {
    expect(ALERT_STEPS[0]).toMatchObject({ cols: 1, css: '' });
    expect(ALERT_STEPS[1]).toMatchObject({ cols: 2, css: '' }); // same type, two columns
    expect(stepOf(6, 6).css).toBe(''); // six short alerts: two columns, full size
    // Twelve lines each carrying two alerts cannot hold it — the type steps down,
    // and the bottom rung is the card's own 20px alert type.
    expect(stepOf(12, 12, [LONG, SECOND]).css).toContain('--well-fs:20px');
    expect(ALERT_STEPS[ALERT_STEPS.length - 1].css).toContain('--well-fs:20px');
  });

  it('deals the wells into two real columns, config order down the first', () => {
    // Each column is its own wrapper — the split is structural now, not a grid
    // auto-flow, so the DOM says outright which well sits where.
    const cols = (lines) => [...alertsEl(lines).querySelectorAll('.wall__col')]
      .map((c) => [...c.querySelectorAll('.sbalert .bullet')].map((b) => b.textContent).join(','));
    expect(cols(subwayVm(6, 6).lines)).toEqual(['1,2,3', '4,5,6']);
    expect(cols(subwayVm(7, 5).lines)).toEqual(['1,2,3,4', '5,6,7']); // 4 + 3, never 6 + 1
    expect(cols(subwayVm(5, 7).lines)).toEqual([]); // one column wraps nothing
    expect(alertsEl(subwayVm(5, 7).lines).querySelectorAll('.sbalert').length).toBe(5);
  });

  it('packs every column at one uniform 20px pitch', () => {
    for (const n of [1, 3, 5, 6, 8, 12]) {
      expect(alertsEl(subwayVm(n, 24 - n).lines).style.getPropertyValue('--well-space')).toBe('20px');
    }
  });

  it('sizes the region by its TALLEST COLUMN, not by the tallest well per row', () => {
    // Six wells, and only the first is tall. Two columns of three: column one
    // pays for that well, column two does not — under the old shared row tracks
    // row 0 charged BOTH columns for it and the short well floated in dead air.
    const lines = [
      { line: '1', ok: false, headers: [LONG, SECOND] },
      ...['2', '3', '4', '5', '6'].map((line) => ({ line, ok: false, headers: [SHORT] })),
    ];
    const step = ALERT_STEPS[1];
    const [tall, short] = alertColHeights(lines, step, 3);
    expect(tall).toBeGreaterThan(short);
    expect(short).toBe(2 * 20 + 3 * wellHeight([SHORT], step)); // its own wells, its own gaps
    expect(tall).toBe(2 * 20 + wellHeight([LONG, SECOND], step) + 2 * wellHeight([SHORT], step));
    // And the columns hold what the model says they hold.
    expect(alertColumns(lines, step, 3).map((c) => c.length)).toEqual([3, 3]);
  });

  it('measures a well from its bullet, its padding and every line of its text', () => {
    const [roomy] = ALERT_STEPS;
    expect(wellHeight([SHORT], roomy)).toBe(120); // one line: the bullet governs
    expect(wellHeight([LONG], roomy)).toBe(122); // 132 chars + the pill's 9 wrap to two 41px lines, on 40 of padding
    expect(wellHeight([LONG, SECOND], roomy)).toBe(172); // those two lines + the second header's one + the paragraph gap
    expect(wellHeight([], roomy)).toBe(120); // no header at all still frames the bullet
    // The same text costs less on a lower rung, which is the point of the ladder.
    expect(wellHeight([LONG, SECOND], ALERT_STEPS[4])).toBeLessThan(wellHeight([LONG, SECOND], roomy));
  });

  it('spends the pill where it sits — inside the lead line, not as a fraction after it', () => {
    // The pill's characters are on the lead's FIRST LINE, so they wrap with it.
    // Charging them as a fraction of a line added afterwards was the ladder's one
    // real modelling error: a 113-character header is 1.98 lines of a 57-char
    // rung, so the pill IS what pushes it to three, and the wall read 2.175 where
    // the browser drew 3 — 102px of a nine-alert morning off the bottom of a
    // board, at a rung the model believed had room to spare.
    const step = { cols: 2, chars: 60, line: 40, para: 8, pad: 0, bullet: 0, css: '' };
    const pad = (lead, n) => lead + 'A'.repeat(n - lead.length);
    // Nowhere near a boundary: the pill is free, exactly as the old model claimed.
    expect(wellHeight([pad('delays ', 40)], step)).toBe(40);
    expect(wellHeight([pad('', 40)], step)).toBe(40); // and the long fallback label is free too
    // At the boundary it costs a whole line, and WHICH label decides: 51 chars
    // plus DELAYS+3 is exactly 60 and holds; plus SERVICE ALERT+3 is 67 and wraps.
    expect(statusLabel(pad('delays ', 51))).toBe('Delays');
    expect(statusLabel(pad('', 51))).toBe(STATUS_FALLBACK);
    expect(wellHeight([pad('delays ', 51)], step)).toBe(40);
    expect(wellHeight([pad('', 51)], step)).toBe(80);
    // A second header carries no pill, so it pays for its own characters alone.
    expect(wellHeight([pad('delays ', 51), pad('', 60)], step)).toBe(88); // two lines + the gap
    expect(wellHeight([pad('delays ', 51), pad('', 61)], step)).toBe(128); // 61 chars is two lines
  });

  // ---- the measured backstop ----
  // happy-dom has no layout engine, so the wall is faked: `heights` is the spill
  // (scrollHeight − clientHeight) each rung would render at, and the fake reads
  // the data-rung statusBoard() stamped to know which one it is being asked for.
  const fakeBody = (heights) => {
    const seen = [];
    const el = {
      innerHTML: '',
      querySelector(sel) {
        if (sel !== '.wall__alerts') return null;
        const m = /data-rung="(\d+)"/.exec(el.innerHTML);
        if (!m) return null;
        const rung = Number(m[1]);
        seen.push(rung);
        return { clientHeight: 700, scrollHeight: 700 + heights[rung], dataset: { rung: String(rung) } };
      },
    };
    return { el, seen, rung: () => Number(/data-rung="(\d+)"/.exec(el.innerHTML)?.[1] ?? -1) };
  };
  const twelve = () => subwayVm(12, 11, [LONG, SECOND]).lines;

  it('leaves the wall alone when the estimate was right', () => {
    const f = fakeBody([0, 0, 0, 0, 0, 0]);
    f.el.innerHTML = statusBoard(twelve());
    const before = f.el.innerHTML;
    fitStatusBoard(f.el, twelve());
    expect(f.el.innerHTML).toBe(before); // not one re-render on a normal morning
  });

  it('walks the ladder with a tape measure when it was wrong', () => {
    // Only rung 4 actually holds it. The model picked the floor (5), which
    // spills — so the wall stops guessing, tries the rungs in order and takes
    // the first that genuinely fits, biggest type first.
    const f = fakeBody([900, 700, 500, 300, 0, 40]);
    f.el.innerHTML = statusBoard(twelve());
    fitStatusBoard(f.el, twelve());
    expect(f.rung()).toBe(4);
  });

  it('keeps the rung that loses least when no rung holds it at all', () => {
    // Down the ladder is NOT monotonically better: a narrower column wraps a
    // well taller, so the three-column floor can spill more than the rung above
    // it. On a morning nothing fits, the wall keeps the best of them.
    const f = fakeBody([900, 700, 500, 300, 60, 190]);
    f.el.innerHTML = statusBoard(twelve());
    fitStatusBoard(f.el, twelve());
    expect(f.rung()).toBe(4);
    // Bounded, and it terminates: every rung is rendered at most once.
    expect(new Set(f.seen).size).toBeLessThanOrEqual(ALERT_STEPS.length);
  });

  it('does nothing at all without a layout engine', () => {
    // Unit tests and the server-side render path have no clientHeight; the
    // static estimate has to stand on its own there.
    const el = { innerHTML: statusBoard(twelve()), querySelector: () => ({ clientHeight: 0, scrollHeight: 0, dataset: {} }) };
    const before = el.innerHTML;
    fitStatusBoard(el, twelve());
    expect(el.innerHTML).toBe(before);
    expect(() => fitStatusBoard(null, twelve())).not.toThrow();
  });

  it('hands the fitter through to the overlay that opened it', () => {
    // The card registers onFit alongside its bodyHtml, and openExpand runs it on
    // the LIVE body — after `hidden` clears, so there is something to measure.
    const seen = [];
    openExpand({ title: 'x', bodyHtml: '<div class="wall"></div>', onFit: (b) => seen.push(b?.className) });
    expect(seen).toEqual(['expand__body']);
    closeExpand();
  });

  it('ends the ladder on a third column, not on smaller type', () => {
    // The floor is the card's own 20px alert copy and never less, so the last
    // rung the wall can spend is a COLUMN: same scale as the rung above it, one
    // more column, and a char budget measured for the narrower line (47 of the
    // 470px three-column line, against 80 of the 770px two-column one).
    const [, ...rest] = ALERT_STEPS;
    expect(ALERT_STEPS.map((s) => s.cols)).toEqual([1, 2, 2, 2, 2, 3]);
    expect(rest.map((s) => s.cols).every((c) => c >= 2)).toBe(true);
    const [floor, above] = [ALERT_STEPS[5], ALERT_STEPS[4]];
    expect(floor.css).toBe(above.css); // identical type: the step is the column
    expect(floor.chars).toBeLessThan(above.chars); // on a narrower line
    // Twelve two-alert lines used to fall off the floor; three columns hold them.
    expect(stepOf(12, 11, [LONG, SECOND]).cols).toBe(3);
  });
});

describe('subway status pill', () => {
  const label = (header) => statusLabel(header);

  it('names a reroute', () => {
    expect(label('[3] trains are rerouted via the [2] line after 34 St-Penn Station.')).toBe('Reroute');
    expect(label('Coney Island-bound [D] trains are rerouted via the [N] line after 36 St.')).toBe('Reroute');
  });

  it('names a local-stops pattern change', () => {
    expect(label('Downtown [4] trains are making local stops in Manhattan.')).toBe('Local stops');
    expect(label('[A] trains are running local service between 168 St and Canal St.')).toBe('Local stops');
  });

  it('names a skipped-stops pattern change', () => {
    expect(label('Manhattan-bound [J] trains skip Marcy Av and Hewes St.')).toBe('Skipped stops');
    expect(label('[6] trains are skipping 68 St-Hunter College.')).toBe('Skipped stops');
    expect(label('Southbound [2] trains stop at 145 St.')).toBe('Skipped stops');
  });

  it('names a headway, carrying the interval through', () => {
    expect(label('42 St Shuttle trains are running every 12 minutes.')).toBe('Every 12 min');
    expect(label('[7] trains are running every 10 minutes while we perform signal work.')).toBe('Every 10 min');
    expect(label('[G] trains are running every 1 minute.')).toBe('Every 1 min');
  });

  it('names delays', () => {
    expect(label('Downtown [2] trains are running with delays in both directions.')).toBe('Delays');
    expect(label('[L] service is delayed while we conduct track maintenance.')).toBe('Delays');
  });

  it('names a suspension', () => {
    expect(label('[M] service is suspended between Myrtle Av and Metropolitan Av.')).toBe('Suspended');
  });

  it('falls back to a label that is never wrong', () => {
    expect(label('Elevator service at 42 St-Bryant Pk is out of service.')).toBe('Service alert');
    expect(label(LONG)).toBe('Service alert'); // "stopping along the [R] line" is none of the patterns
    expect(label('')).toBe('Service alert');
    expect(label(undefined)).toBe('Service alert');
    expect(STATUS_FALLBACK).toBe('Service alert');
  });

  it('takes the FIRST match when the prose carries two patterns', () => {
    // A reroute that also changes the stop pattern is a reroute — that is the
    // bigger fact, and the rule table's order is what decides it.
    expect(label('[D] trains are rerouted via the [N] line and are making local stops.')).toBe('Reroute');
    // A headway outranks the delay it is phrased alongside: it says how long.
    expect(label('[7] trains are running with delays and running every 20 minutes.')).toBe('Every 20 min');
    // Suspended-plus-delays reads as delays, because delays comes first in the
    // table — the pair only occurs as "delays on the rest of the line".
    expect(label('[M] service is suspended in Queens with delays elsewhere.')).toBe('Delays');
    expect(STATUS_RULES.map((r) => r.label)).toEqual([
      'Reroute', 'Local stops', 'Skipped stops', 'Every $1 min', 'Delays', 'Suspended',
    ]);
  });

  it('renders exactly one pill per well, on the lead alert, escaped', () => {
    const wall = wallOf(statusBoard(subwayVm(3, 6, [LONG, SECOND]).lines));
    expect(wall.querySelectorAll('.sbalert').length).toBe(3);
    expect(wall.querySelectorAll('.sbstatus').length).toBe(3); // one each, not one per header
    // It leads the first paragraph and the alert copy follows it intact.
    const lead = wall.querySelector('.sbalert__text p');
    expect(lead.firstElementChild.className).toBe('sbstatus');
    expect(lead.textContent).toBe(`Service alert${LONG}`);
    expect([...wall.querySelectorAll('.sbalert__text p')][1].querySelector('.sbstatus')).toBeNull();
  });

  it('keeps the wells neutral: the pill is the only amber in the markup', () => {
    const wall = wallOf(statusBoard(subwayVm(2, 6).lines));
    expect([...wall.querySelectorAll('.sbstatus')].map((p) => p.textContent)).toEqual(['Delays', 'Delays']);
    expect(wall.querySelector('.sbalert').getAttribute('style')).toBeNull(); // no inline amber
  });
});

// --------------------------------------------------------------- weather ----

// Weather is the OTHER class of expansion: nothing on its card is capped away,
// so there is no "+N" badge and no hidden-row condition — the tap always has
// something richer to open, and the press tint is the whole signifier.
function weatherBoard(vm, cfg = { loc: { label: 'New York 10001', units: 'F' } }, [w, h] = [3, 5]) {
  document.body.innerHTML = `
    <div id="grid">
      <article class="card card--weather t-l t-narrow" data-widget="weather" data-w="${w}" data-h="${h}">
        <h2 class="card__title">Weather</h2>
        <span class="card__note"></span>
        <div class="card__body"></div>
        <div class="card__stamp" hidden></div>
      </article>
    </div>
    <div id="settings-root"></div>
    <div id="edit-root"></div>`;
  const grid = document.querySelector('#grid');
  initExpand(grid);
  const card = grid.querySelector('.card');
  renderWeather(card.querySelector('.card__body'), vm, cfg);
  return { grid, card };
}

describe('weather card tap', () => {
  it('always expands, with no badge to signify it', () => {
    const { card } = weatherBoard(DEMO_VMS.weather);
    expect(card.querySelector('.card__more')).toBeNull(); // nothing is hidden to count
    expect(card.classList.contains('is-expandable')).toBe(true);

    card.click();
    expect(isExpandOpen()).toBe(true);
    expect(overlay().querySelector('.expand__title').textContent).toBe('Weather');
    expect(overlay().querySelector('.expand__note').textContent).toBe('New York 10001');
    // 24 hourly columns and 7 day cards, from the same payload the card drew 8
    // hours and 5 days out of.
    expect(overlay().querySelectorAll('.wxf__row--hours > span').length).toBe(24);
    expect(overlay().querySelectorAll('.wxf__day').length).toBe(7);
    expect(overlay().querySelectorAll('.wxf__stat').length).toBe(6);
    expect(overlay().textContent).toContain('Sunrise');
    expect(overlay().textContent).toContain('Tap anywhere to close');
  });

  it('never registers a source for a vm it cannot render', () => {
    const { card } = weatherBoard(DEMO_VMS.weather);
    expect(card.classList.contains('is-expandable')).toBe(true);
    // An error/empty vm throws partway through render (main.js catches and logs
    // it); the card must not be left expandable on the PREVIOUS render's data.
    expect(() => renderWeather(card.querySelector('.card__body'), {}, { loc: {} })).toThrow();
    expect(card.classList.contains('is-expandable')).toBe(false);
    card.click();
    expect(isExpandOpen()).toBe(false);
  });

  it('is inert in edit mode, like every other expandable card', () => {
    const { card } = weatherBoard(DEMO_VMS.weather);
    document.querySelector('#edit-root').innerHTML = '<div class="editor"></div>';
    card.click();
    expect(isExpandOpen()).toBe(false);
  });

  it('keeps the snapshot when the card refreshes underneath it', () => {
    const { card } = weatherBoard(DEMO_VMS.weather);
    card.click();
    const before = overlay().innerHTML;
    expect(overlay().textContent).toContain('84°');
    renderWeather(card.querySelector('.card__body'),
      { ...DEMO_VMS.weather, now: { ...DEMO_VMS.weather.now, temp: 91 } },
      { loc: { label: 'New York 10001', units: 'F' } });
    expect(overlay().innerHTML).toBe(before);
  });

  it('carries the card stale stamp through', () => {
    const { card } = weatherBoard(DEMO_VMS.weather);
    const stamp = card.querySelector('.card__stamp');
    stamp.textContent = 'as of 8:12 AM';
    stamp.hidden = false;
    card.click();
    expect(overlay().classList.contains('is-stale')).toBe(true);
    expect(overlay().querySelector('.expand__stamp').textContent).toBe('as of 8:12 AM');
  });

  it('extends cfg.clock24 to the CARD hour labels as well as the overlay', () => {
    const cfg12 = { loc: { label: 'New York 10001', units: 'F' } };
    const cfg24 = { loc: { label: 'London, England (GB)', units: 'C' }, clock24: true };
    const { card } = weatherBoard(DEMO_VMS.weather, cfg12);
    const hours = () => [...card.querySelectorAll('.wx-trend__row--hours > span')].map((s) => s.textContent);
    expect(hours().slice(0, 3)).toEqual(['9 AM', '10 AM', '11 AM']);

    renderWeather(card.querySelector('.card__body'), DEMO_VMS.weather, cfg24);
    expect(hours().slice(0, 3)).toEqual(['09:00', '10:00', '11:00']);
    card.click();
    expect([...overlay().querySelectorAll('.wxf__row--hours > span')]
      .map((s) => s.textContent).filter(Boolean).slice(0, 3)).toEqual(['09:00', '11:00', '13:00']);
  });
});
