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
import {
  render as renderSubway,
  statusBoard,
  alertStep,
  alertGap,
  bandRows,
  alertsAvail,
  wellHeight,
  ALERT_STEPS,
} from '../site/js/widgets/subway.js';
import { render as renderWeather } from '../site/js/widgets/weather.js';
import { DEMO_VMS } from '../site/demo/fixtures.js';

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

  // ---- the 20-ticker cap: browser-measured on the 1920x1080 overlay ----

  const symbols = (n, prefix = 'TK') => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(2, '0')}`);
  const indexSymbols = (n) => Array.from({ length: n }, (_, i) => `^IX${i}`);

  it('takes a sixth column only under a shelf, and marks it dense', () => {
    // 16 stocks under a one-row shelf get 576px of canvas: three rows of tiles,
    // so six across. Six-across tiles are 279px and need the denser type.
    expect(tileCols(16, 1)).toBe(6);
    expect(tileCols(20)).toBe(5); // no shelf: 4 rows of 5 keeps the wider tile
    expect(tileCols(30, 1)).toBe(6); // six is the ceiling; seven ellipses GOOGL
    const wall = wallOf(tileWall(vmOf([...indexSymbols(4), ...symbols(16)]).indices));
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
    for (const nIdx of [2, 3, 4]) {
      const wall = wallOf(tileWall(vmOf([...indexSymbols(nIdx), ...symbols(20 - nIdx)]).indices));
      expect(wall.querySelectorAll('.wall__shelf .tile').length).toBe(nIdx);
      expect(wall.querySelectorAll('.wall__grid .tile').length).toBe(20 - nIdx);
      expect(wall.querySelector('.wall__rule')).not.toBeNull();
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
  updatedAt: 1783000500,
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
    expect(overlay().querySelector('.expand__note').textContent).toBe('2 of 12 lines with alerts · as of 9:55 AM');
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
    expect(overlay().querySelector('.expand__note').textContent).toBe('as of 9:55 AM');
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
    expect(paras.map((p) => p.textContent)).toEqual([LONG, SECOND]);
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
    expect(wall.querySelector('.sbalert__text p').textContent).toBe('<img src=x onerror=1>');
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
    // No band at all (every line alerting) buys back its 113px: six fit.
    expect(stepOf(6, 0).cols).toBe(1);
    expect(stepOf(7, 0).cols).toBe(2);
    // A band that wraps to a second row (18+ healthy lines) costs a well: four.
    expect(bandRows(18)).toBe(2);
    expect(stepOf(4, 18).cols).toBe(1);
    expect(stepOf(5, 18).cols).toBe(2);
  });

  it('measures the canvas the band and its hairline take', () => {
    expect(alertsAvail(0)).toBe(854); // no band: the whole body
    expect(alertsAvail(1)).toBe(741); // 60px band + 53px hairline block
    expect(alertsAvail(2)).toBe(665);
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

  it('lays two columns out in config order down the first, then the second', () => {
    // --rows drives the grid template; auto-flow:column then fills row 0..n of
    // column one before column two, which is what keeps config order readable.
    expect(alertsEl(subwayVm(6, 6).lines).style.getPropertyValue('--rows')).toBe('3');
    expect(alertsEl(subwayVm(7, 5).lines).style.getPropertyValue('--rows')).toBe('4');
    expect(alertsEl(subwayVm(5, 7).lines).style.getPropertyValue('--rows')).toBe('5'); // one column
  });

  it('caps the elastic well gap so three alerts read as one group', () => {
    const step = ALERT_STEPS[0];
    expect(alertGap(alerting(3), step, 3, 1)).toBe(36); // 261px of slack, capped
    expect(alertGap(alerting(5), step, 5, 1)).toBe(35); // 69px over four gaps
    expect(alertGap(alerting(6), step, 6, 0)).toBe(27); // a fuller canvas, tighter
    expect(alertGap(alerting(1), step, 1, 1)).toBe(18); // one well has no gap
    // Past the canvas (the scroll backstop) the gap sits on its floor.
    expect(alertGap(alerting(12, [LONG, SECOND]), ALERT_STEPS[4], 6, 1)).toBe(18);
    expect(alertsEl(subwayVm(3, 9).lines).style.getPropertyValue('--well-space')).toBe('36px');
  });

  it('measures a well from its bullet, its padding and every line of its text', () => {
    const [roomy] = ALERT_STEPS;
    expect(wellHeight([SHORT], roomy)).toBe(120); // one line: the bullet governs
    expect(wellHeight([LONG], roomy)).toBe(122); // two lines of 41 + 40 of padding
    expect(wellHeight([LONG, SECOND], roomy)).toBe(172); // 2 lines + 1 + the paragraph gap
    expect(wellHeight([], roomy)).toBe(120); // no header at all still frames the bullet
    // The same text costs less on a lower rung, which is the point of the ladder.
    expect(wellHeight([LONG, SECOND], ALERT_STEPS[4])).toBeLessThan(wellHeight([LONG, SECOND], roomy));
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
