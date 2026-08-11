// PGA Tour leaderboard from ESPN's public scoreboard (CORS-open, keyless,
// browser-direct — same source family as My Teams/Tennis). Config-less:
// the feed's current event IS the card. Majors (Masters/PGA/US Open/The
// Open) ride the pga scoreboard, so they appear automatically.

import { escapeHtml } from '../util.js';
import { setCardNote, setMoreBadge } from '../card.js';
import { fitList } from '../capacity.js';
import { WORKER_URL } from '../env.js';
import { setExpandSource } from '../expand.js';
import { dealColumns, gridStyle } from '../columns.js';
import { mapGolf } from '../espn-scores.js';

export { mapGolf }; // single shared mapper (site fallback + worker digest + tests)

export const meta = { id: 'golf', title: 'Golf', refreshMs: 5 * 60 * 1000 };

const FEED_URL = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

// The full-screen leaderboard: the same four fields as the card row, dealt
// into two centered columns so a deep leaderboard reads down-then-across. Two
// columns of twelve is the canvas: on the pinned line-height in main.css a row
// is 60px including its hairline, so twelve are 720px inside the 814px body,
// and a third column would push the player names under the 20px floor.
export const BOARD_ROWS = 12;
export const BOARD_PLAYERS = BOARD_ROWS * 2;

function golfBoard(players) {
  const shown = players.slice(0, BOARD_PLAYERS);
  // Rows PER COLUMN: a field that fits one column stays one column, and a
  // longer one balances (ceil, so the left column is the fuller of the two).
  // BOARD_ROWS is this view's own row cost; the split is the shared one.
  const { columns, rows } = dealColumns(shown.length, { fitsOneColumn: BOARD_ROWS });
  const split = columns > 1;
  const one = (p) => `<div class="golf-board__row">
      <span class="golf-row__pos">${p.pos ?? ''}</span>
      <span class="golf-row__name">${escapeHtml(p.name)}</span>
      <span class="golf-row__today">${escapeHtml(p.today || '')}</span>
      <span class="golf-row__score ${p.score.startsWith('-') ? 'golf-row__score--under' : ''}">${escapeHtml(p.score)}</span>
    </div>`;
  return `<div class="golf-board ${split ? 'golf-board--split' : ''}"${gridStyle('--board-rows', rows)}>${shown
    .map(one)
    .join('')}</div>`;
}

export function render(el, vm, _cfg) {
  const note = vm.name ? `${vm.name}${vm.round ? ` · Rd ${vm.round}` : ''}` : null;
  setCardNote(el, note);
  if (!vm.players.length) {
    const when = vm.startsAt
      ? ` Starts ${new Date(vm.startsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.`
      : '';
    el.innerHTML = `<div class="empty">${vm.name ? `${escapeHtml(vm.name)}.${when}` : 'No tournament this week'}</div>`;
    // An off week has no leaderboard to open. Clearing both is the point: the
    // card would otherwise keep the previous tournament's count in its corner
    // and its promise on the glass.
    setMoreBadge(el, 0);
    setExpandSource(el, null);
    return;
  }
  fitList(el, {
    id: meta.id,
    items: vm.players,
    defaultSize: [3, 4],
    badge: true,
    draw: (n) => {
      const shown = vm.players.slice(0, n);
      el.style.setProperty('--n', String(shown.length)); // elastic row-gap divisor
      el.innerHTML = shown
        .map(
          (p) => `<div class="golf-row">
        <span class="golf-row__pos">${p.pos ?? ''}</span>
        ${p.flag ? `<img class="golf-row__flag" src="${escapeHtml(p.flag)}" alt="">` : ''}
        <span class="golf-row__name">${escapeHtml(p.name)}</span>
        ${p.today ? `<span class="golf-row__today">${escapeHtml(p.today)}</span>` : ''}
        <span class="golf-row__score ${p.score.startsWith('-') ? 'golf-row__score--under' : ''}">${escapeHtml(p.score)}</span>
      </div>`,
        )
        .join('');
    },
  });
  // Unconditional, the history precedent: one card, one destination. The note
  // carries the event and round into the overlay's small text, the same words
  // the card title wears.
  setExpandSource(el, () => ({
    title: meta.title,
    note: note ?? '',
    bodyHtml: golfBoard(vm.players),
  }));
}

export async function fetchData(_cfg, net) {
  // Worker digest first: ~2 KB (plus the 24h stale fallback) vs the 2.3 MB
  // raw scoreboard. Browser-direct remains as the fallback while the route
  // rolls out (worker deploys only on main pushes) and if the worker is down.
  try {
    return await net.fetchJSON(`${WORKER_URL}/golf`);
  } catch {
    return mapGolf(await net.fetchJSON(FEED_URL));
  }
}
