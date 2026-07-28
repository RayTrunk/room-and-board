// Markets widget: Dow / Nasdaq / S&P 500 via the Worker (upstream is the
// unofficial Yahoo Finance chart API — Worker-side only, cached, and this
// widget hides itself when the payload is unusable).

import { WORKER_URL } from '../env.js';
import { escapeHtml, fmtClock, setCardNote, setMoreBadge, chaikin } from '../util.js';
import { itemCapacity, cardSize } from '../capacity.js';
import { setExpandSource } from '../expand.js';

export const meta = { id: 'markets', title: 'Markets', refreshMs: 5 * 60 * 1000 };

// Normalizes a series into [x, y] points spanning w×h (padding baked in).
function sparkPts(values, w, h) {
  if (!Array.isArray(values) || values.length < 2) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 2;
  return values.map((v, i) => [
    pad + (i * (w - 2 * pad)) / (values.length - 1),
    pad + (1 - (v - min) / span) * (h - 2 * pad),
  ]);
}
const toPath = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');

// Normalizes a series into an SVG path spanning w×h.
export function sparkPath(values, w, h) {
  return toPath(sparkPts(values, w, h));
}

// X (in a w-wide viewBox) of the yesterday|today divider: the midpoint of the
// gap between the last prior-session point (split-1) and the first today point
// (split), matching sparkPath's index→x mapping.
export function sparkDividerX(len, split, w = 90, pad = 2) {
  const step = (w - 2 * pad) / (len - 1);
  return pad + (split - 0.5) * step;
}

// Y (in the 28-tall viewBox) of a value, using a series' own min/max — matches
// sparkPts' value→y mapping, so a value in `values` lands on its plotted point.
export function yForValue(val, values, h = 28, pad = 2) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return pad + (1 - (val - min) / span) * (h - 2 * pad);
}

// Splits a polyline into GREEN (at/above the baseline) and RED (below) subpaths,
// cutting each segment exactly where it crosses the baseline y. Pure geometry
// with plain <path> data — deliberately NO SVG clip-paths, which the board's
// gen1 WebEngine renders unreliably (a crossing line dropped out entirely).
export function colorSplit(pts, yBase) {
  let up = '';
  let down = '';
  const push = (above, x1, y1, x2, y2) => {
    const s = `M${x1.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}`;
    if (above) up += s; else down += s;
  };
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1];
    const [x2, y2] = pts[i];
    const a1 = y1 <= yBase; // smaller y = higher price = above the baseline (green)
    const a2 = y2 <= yBase;
    if (a1 === a2) {
      push(a1, x1, y1, x2, y2);
    } else {
      const xc = x1 + ((yBase - y1) / (y2 - y1)) * (x2 - x1); // x where it crosses
      push(a1, x1, y1, xc, yBase);
      push(a2, xc, yBase, x2, y2);
    }
  }
  return { up, down };
}

// Splits a monotonic-x polyline at x = xc, interpolating the point on the line
// there so the two halves join EXACTLY at xc (the day divider). Returns
// { left, right }, both including the join point, so the white prior session and
// the coloured today meet with no gap or kink.
export function splitAtX(pts, xc) {
  const k = pts.findIndex(([x]) => x >= xc);
  if (k <= 0) return { left: [], right: pts };
  if (pts[k][0] === xc) return { left: pts.slice(0, k + 1), right: pts.slice(k) };
  const [x1, y1] = pts[k - 1];
  const [x2, y2] = pts[k];
  const cross = [xc, y1 + ((xc - x1) / (x2 - x1)) * (y2 - y1)];
  return { left: [...pts.slice(0, k), cross], right: [cross, ...pts.slice(k)] };
}

// Sparkline SVG. The CURRENT session is coloured against the prior close: green
// where the price sits above it, red where below, cut cleanly at the crossing
// so an intraday move that dips through the baseline shows BOTH colours. Wide
// cards (twoDay) draw the prior session in WHITE ahead of a dashed day-boundary
// rule; compact cards draw today alone, coloured the same way.
function sparkSvg(ix, cls = 'spark') {
  const two =
    ix.twoDay &&
    Array.isArray(ix.spark2) &&
    ix.spark2.length > 2 &&
    ix.split > 0 &&
    ix.split < ix.spark2.length;
  const series = two ? ix.spark2 : ix.spark;
  const pts = sparkPts(series, 90, 28);
  if (pts.length < 2) return `<svg class="${cls}" viewBox="0 0 90 28" preserveAspectRatio="none"></svg>`;
  // Colour baseline = the prior close. Two-day: yesterday's last bar (the split
  // point); compact: price − change. The current segment starts there, so the
  // overnight move reads as part of today.
  const baseVal = two ? series[ix.split - 1] : ix.price - ix.change;
  const yBase = yForValue(baseVal, series);
  // Smooth the WHOLE line once (Chaikin), then split at the day divider — so the
  // white prior session flows seamlessly into today's colour. Smoothing the two
  // halves separately left a visible kink at the boundary.
  const sm = chaikin(pts);
  let extras = '';
  let todayPts = sm;
  if (two) {
    const dx = sparkDividerX(series.length, ix.split);
    const { left, right } = splitAtX(sm, dx);
    todayPts = right;
    extras = `<path class="spark__prev" d="${toPath(left)}" fill="none" stroke-width="1.5" vector-effect="non-scaling-stroke"/>` +
      `<line class="spark__div" x1="${dx.toFixed(1)}" y1="-5" x2="${dx.toFixed(1)}" y2="33" vector-effect="non-scaling-stroke"/>`;
  }
  const { up, down } = colorSplit(todayPts, yBase);
  const today =
    (up ? `<path class="spark__up" d="${up}" fill="none" stroke-width="1.5" vector-effect="non-scaling-stroke"/>` : '') +
    (down ? `<path class="spark__down" d="${down}" fill="none" stroke-width="1.5" vector-effect="non-scaling-stroke"/>` : '');
  return `<svg class="${cls}" viewBox="0 0 90 28" preserveAspectRatio="none">${extras}${today}</svg>`;
}

const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- tap-to-expand: the full ticker wall ----------

// Indices (^-prefixed symbols) lead the wall on their own shelf; everything
// else falls to the grid below. Both keep their relative config order, so a
// user who interleaves ^GSPC among their stocks still gets a clean two-band
// wall in the order they wrote.
export const isIndexSymbol = (symbol) => String(symbol ?? '').startsWith('^');

// Overlay geometry, browser-measured on the fixed 1920x1080 board (the same
// fixed-pixel reasoning capacity.js uses for card rows — the canvas never
// changes size): the wall's content box, a shelf row, the shelf's hairline
// block, and the floor a grid tile needs to hold its four lines.
const WALL_H = 854;
const SHELF_ROW = 225;
const RULE_BLOCK = 53;
// A grid tile's four lines with the sparkline at its 36px minimum measure 163px
// (browser-measured at the 20-ticker cap); 175 is that floor plus enough slack
// that the chart still shows some curve rather than a flat 36px sliver.
const TILE_MIN = 175;
const TILE_GAP = 20;
// Six columns is the width ceiling. Measured: 6 across gives a 279px tile,
// which holds a five-character ticker (GOOGL, SAP.DE) only in the denser type
// below; 7 across gives 237px and ellipses those symbols however the type is
// trimmed, and a symbol nobody can read whole defeats the wall.
// At that width the tile switches to .wall__grid--dense in main.css.
const MAX_COLS = 6;

// Grid rows that clear the tile floor once the shelf has taken its share.
function maxRows(shelfRows) {
  const avail = WALL_H - (shelfRows ? shelfRows * SHELF_ROW + (shelfRows - 1) * TILE_GAP + RULE_BLOCK : 0);
  return Math.max(1, Math.floor((avail + TILE_GAP) / (TILE_MIN + TILE_GAP)));
}

// Columns for n tiles in the stock grid on the 1920-wide overlay. Config caps
// the list at 20, so the grid runs to four rows of generous tiles. A tall shelf
// eats the canvas, so the grid then trades columns for rows rather than
// squeezing tiles below the height their four lines need.
export function tileCols(n, shelfRows = 0) {
  let cols = n <= 3 ? Math.max(n, 1) : n <= 4 ? 2 : n <= 6 ? 3 : n <= 8 ? 4 : 5;
  const rows = maxRows(shelfRows);
  while (Math.ceil(n / cols) > rows && cols < MAX_COLS) cols++;
  return cols;
}

// Whether the watchlist grid still clears the tile floor with the shelf in place.
const gridFits = (n, shelfRows) => Math.ceil(n / tileCols(n, shelfRows)) <= maxRows(shelfRows);

// The shelf earns its place only when the whole wall still fits around it: its
// own rows must clear the canvas, and the watchlist below must still clear the
// tile floor. A twenty-long list behind one or two indices cannot afford the
// shelf's 278px band, so the indices fold back into the grid as ordinary tiles
// — they ARE ordinary entries, and the shelf is the luxury, not the list.
export function shelfFits(nShelf, nRest) {
  if (!nShelf) return false;
  const rows = Math.ceil(nShelf / shelfCols(nShelf));
  const block = rows * SHELF_ROW + (rows - 1) * TILE_GAP + (nRest ? RULE_BLOCK : 0);
  return block <= WALL_H && (!nRest || gridFits(nRest, rows));
}

// Shelf columns. Index tiles carry the big lead type (a 46px six-figure price
// beside its change), which needs ~400px of tile: measured, 5 across (340px)
// overflows the price row. Four is the hard ceiling, so a long index list wraps
// to a second shelf row instead of squeezing.
export function shelfCols(n) {
  return n <= 4 ? Math.max(n, 1) : Math.min(4, tileCols(n));
}

// One tile per configured symbol. An index leads with its friendly name (a
// symbol nobody reads aloud) and carries ^SYM underneath; a stock leads with
// its symbol and carries the company name. Sparklines take the compact
// single-session form: a tile is small, and the two-day shape needs the card's
// full width to read.
function tile(ix) {
  const up = ix.change >= 0;
  const index = isIndexSymbol(ix.symbol);
  const lead = index ? ix.name : ix.symbol;
  const sub = index ? ix.symbol : ix.name;
  const dir = up ? 'up' : 'down';
  return `<div class="tile${index ? ' tile--index' : ''}">
    <div class="tile__head">
      <span class="tile__sym">${escapeHtml(lead)}</span>
      <span class="tile__pct delta--${dir}">${up ? '▲' : '▼'} ${Math.abs(ix.changePct).toFixed(2)}%</span>
    </div>
    <div class="tile__row">
      <span class="tile__price">${fmt.format(ix.price)}</span>
      <span class="tile__chg delta--${dir}">${up ? '+' : '−'}${fmt.format(Math.abs(ix.change))}</span>
    </div>
    ${sparkSvg({ ...ix, twoDay: false }, 'spark tile__spark')}
    <span class="tile__name">${escapeHtml(sub)}</span>
  </div>`;
}

// The overlay body: every ticker the card fetched. Each band renders only if it
// has tiles — the indices are removable entries like any other symbol, so a
// config without them yields a plain stock grid on the full canvas (no shelf,
// no reserved space, no hairline), and an indices-only config yields the shelf
// alone with no empty grid below it. When the shelf cannot be afforded at all
// (see shelfFits), the wall drops it and shows one grid of everything.
export function tileWall(indices) {
  const leads = indices.filter((ix) => isIndexSymbol(ix.symbol));
  const banded = shelfFits(leads.length, indices.length - leads.length);
  const shelf = banded ? leads : [];
  const rest = banded ? indices.filter((ix) => !isIndexSymbol(ix.symbol)) : indices;
  const bands = [];
  const sCols = shelfCols(shelf.length);
  const shelfRows = shelf.length ? Math.ceil(shelf.length / sCols) : 0;
  if (shelf.length) {
    bands.push(`<div class="wall__shelf" style="--cols:${sCols}">${shelf.map(tile).join('')}</div>`);
  }
  if (shelf.length && rest.length) bands.push('<div class="wall__rule"></div>');
  if (rest.length) {
    const gCols = tileCols(rest.length, shelfRows);
    // A six-across grid drops to the denser tile type (see main.css): the extra
    // column is only legible if the tile buys the width back.
    bands.push(
      `<div class="wall__grid${gCols >= MAX_COLS ? ' wall__grid--dense' : ''}" style="--cols:${gCols}">${rest.map(tile).join('')}</div>`,
    );
  }
  // A lone shelf centers instead of stranding itself at the top edge.
  const solo = shelf.length && !rest.length ? ' wall--shelf-only' : '';
  return `<div class="wall${solo}">${bands.join('')}</div>`;
}

export function render(el, vm, cfg) {
  // Freshness note in the card header (worker fetch time, not render time) —
  // a clock reading, so it honors cfg.clock24.
  if (vm.updatedAt) setCardNote(el, `as of ${fmtClock(vm.updatedAt, cfg?.clock24)}`);
  const [w, h] = cardSize(el, [4, 4]);
  const cap = itemCapacity('markets', w, h);
  const shown = vm.indices.slice(0, cap);
  const hidden = vm.indices.length - shown.length;
  // At full width (4 cols — markets caps there, see MAX_SIZE) show the
  // two-session sparkline; the 3-wide min keeps the compact last-session shape.
  const twoDay = w >= 4;
  // Rows render display:contents inside one .indexes grid so every row shares
  // the same column tracks — otherwise the auto-sized delta column would shift
  // each row's sparkline independently (594.83 vs 0.01 wide deltas).
  el.innerHTML = shown.length
    ? `<div class="indexes" style="--n:${shown.length}">` + shown
        .map((ix) => {
          const up = ix.change >= 0;
          return `<div class="index">
            <div class="index__info">
              <span class="index__name">${escapeHtml(ix.name)}</span>
              <span class="index__price">${fmt.format(ix.price)}</span>
            </div>
            ${sparkSvg({ ...ix, twoDay })}
            <span class="delta delta__chg ${up ? 'delta--up' : 'delta--down'}">${up ? '▲' : '▼'} ${fmt.format(Math.abs(ix.change))}</span>
            <span class="delta delta__pct ${up ? 'delta--up' : 'delta--down'}">(${Math.abs(ix.changePct).toFixed(2)}%)</span>
          </div>`;
        })
        .join('') + '</div>'
    : '<div class="empty">Market data unavailable</div>';
  setMoreBadge(el, shown.length ? hidden : 0);
  // Rows here are not tappable, so the whole card is the target and the +N badge
  // is a passive signifier — the two must agree exactly: no badge, no expansion.
  // The closure captures THIS render's vm, so the overlay always shows what the
  // card was showing when it was tapped.
  const note = vm.updatedAt ? `as of ${fmtClock(vm.updatedAt, cfg?.clock24)}` : '';
  setExpandSource(
    el,
    shown.length && hidden > 0
      ? () => ({ title: meta.title, note, bodyHtml: tileWall(vm.indices) })
      : null,
  );
}

export function mapMarkets(payload) {
  if (!payload || payload.error || !Array.isArray(payload.indices)) {
    // Throw rather than return an empty sentinel: startWidget's catch then
    // preserves the last-good cache + stale mark, instead of a blank payload
    // overwriting good data (and leaving a stale "as of" note in the header).
    throw new Error('markets: unusable payload');
  }
  const indices = payload.indices.filter(
    (ix) =>
      typeof ix?.symbol === 'string' &&
      typeof ix?.name === 'string' &&
      Number.isFinite(ix?.price) &&
      Number.isFinite(ix?.change) &&
      Number.isFinite(ix?.changePct) &&
      Array.isArray(ix?.spark),
  );
  return { updatedAt: payload.updatedAt ?? null, stale: Boolean(payload.stale), indices };
}

// True when the quote source recognizes the symbol. Both settings surfaces
// validate adds with this — a syntactically-valid unknown ticker otherwise
// saves fine and then silently never appears on the card.
// User notation -> Yahoo symbol. Strips a $ prefix ($AAPL); maps a £ prefix to
// the London Stock Exchange suffix (£CBG -> CBG.L — Yahoo keys LSE listings
// with .L, and UK users write their tickers with a leading £).
export function normalizeSymbol(raw) {
  let t = String(raw ?? '').trim().toUpperCase();
  if (t.startsWith('$')) t = t.slice(1);
  if (t.startsWith('£')) {
    t = t.slice(1);
    if (!t.endsWith('.L')) t += '.L';
  }
  return t;
}

export async function symbolKnown(symbol, fetchFn = fetch) {
  try {
    const res = await fetchFn(`${WORKER_URL}/markets?symbols=${encodeURIComponent(symbol)}`);
    if (!res.ok) return false;
    const payload = await res.json();
    return Array.isArray(payload.indices) && payload.indices.some((ix) => ix.symbol === symbol);
  } catch {
    return false;
  }
}

export async function fetchData(cfg, net) {
  const symbols = cfg.markets?.symbols ?? [];
  const query = symbols.length ? `?symbols=${symbols.map(encodeURIComponent).join(',')}` : '';
  return mapMarkets(await net.fetchJSON(`${WORKER_URL}/markets${query}`));
}
