// "My Teams" sports scores (per large-format scoreboard convention: one row
// per followed team — no league browsing on a glanceable display). Rows come
// from the Worker, which combines ESPN's team endpoint with a digest of the
// heavyweight schedule payload (recent result) that boards must never fetch.

import { escapeHtml, setupPrompt } from '../util.js';
import { setMoreBadge } from '../card.js';
import { WORKER_URL } from '../env.js';
import { fitList } from '../capacity.js';
import { setExpandSource } from '../expand.js';

// ESPN's image combiner serves right-sized logos for 4K panels.
export const logoUrl = (href, px = 80) =>
  href ? `https://a.espncdn.com/combiner/i?img=${encodeURIComponent(new URL(href).pathname)}&h=${px}&w=${px}` : null;

export const meta = { id: 'sports', title: 'My Teams', refreshMs: 2 * 60 * 1000 };

export const LEAGUE_PATHS = {
  mlb: 'baseball/mlb',
  nfl: 'football/nfl',
  nba: 'basketball/nba',
  nhl: 'hockey/nhl',
  mls: 'soccer/usa.1',
  epl: 'soccer/eng.1',
};

// One line of the two the board shows under a name, under the CARD's own
// rules: a result the team has already played is "Last", and only a team whose
// current game is over, unscheduled or postponed gets a "Next".
const lastLine = (r) => (r.lastLine && r.state !== 'post' ? `Last: ${r.lastLine}` : '');
const nextLine = (r) =>
  r.nextLine && (r.state === 'post' || r.state === 'none' || /postpone/i.test(r.line))
    ? `Next: ${r.nextLine}`
    : '';

// The full-screen view: one grand centered column, everything the card row
// carries at reading size. The cap is six because the config's is six
// (DEFAULT_CONFIG.sports), so the column always fills the canvas and never
// overruns it.
export const BOARD_TEAMS = 6;

function teamBoard(rows) {
  return `<div class="team-board">${rows
    .slice(0, BOARD_TEAMS)
    .map((r) => {
      const under = [lastLine(r), nextLine(r)].filter(Boolean);
      return `<div class="team team--board ${r.state === 'in' ? 'team--live' : ''}">
        ${r.logo ? `<span class="team__crest"><img class="team__logo" src="${escapeHtml(logoUrl(r.logo, 120))}" alt=""></span>` : `<span class="team__abbr">${escapeHtml(r.abbr)}</span>`}
        <div class="team__info">
          <span class="team__name">${escapeHtml(r.name)}${r.record ? ` <small>${escapeHtml(r.record)}</small>` : ''}</span>
          ${under.map((t) => `<span class="team__last">${escapeHtml(t)}</span>`).join('')}
        </div>
        <span class="team__line">${r.state === 'in' ? '<b class="team__livedot">●</b> ' : ''}${escapeHtml(r.line)}</span>
      </div>`;
    })
    .join('')}</div>`;
}

export function render(el, vm, _cfg) {
  if (!vm.rows?.length) {
    el.innerHTML = setupPrompt('sports', 'pick your teams', 'My Teams');
    setMoreBadge(el, 0);
    setExpandSource(el, null); // the prompt's tap belongs to Settings, not the overlay
    return;
  }
  fitList(el, {
    id: meta.id,
    items: vm.rows,
    badge: true,
    draw: (n) => {
      const shown = vm.rows.slice(0, n);
      el.style.setProperty('--n', String(shown.length)); // elastic row-gap divisor
      el.innerHTML =
        shown
          .map(
            (r) => `<div class="team ${r.state === 'in' ? 'team--live' : ''}">
          ${r.logo ? `<span class="team__crest"><img class="team__logo" src="${escapeHtml(logoUrl(r.logo))}" alt=""></span>` : `<span class="team__abbr">${escapeHtml(r.abbr)}</span>`}
          <div class="team__info">
            <span class="team__name">${escapeHtml(r.name)}${r.record ? ` <small>${escapeHtml(r.record)}</small>` : ''}</span>
            <span class="team__line">${r.state === 'in' ? '<b class="team__livedot">●</b> ' : ''}${escapeHtml(r.line)}</span>
            ${[lastLine(r), nextLine(r)].filter(Boolean).map((t) => `<span class="team__last">${escapeHtml(t)}</span>`).join('')}
          </div>
        </div>`,
          )
          .join('');
    },
  });
  // Unconditional, the history precedent: the rows cover the card, so one card
  // means one destination and a card showing all its teams still owes a tap the
  // grand column. Only the badge tracks what the card is not showing. The
  // closure captures THIS render's rows, so the view is the snapshot the card
  // was showing when it was tapped.
  setExpandSource(el, () => ({ title: meta.title, bodyHtml: teamBoard(vm.rows) }));
}

export async function fetchData(cfg, net) {
  const teams = cfg.sports?.teams ?? [];
  const settled = await Promise.allSettled(
    teams.map(({ lg, id }) =>
      net.fetchJSON(`${WORKER_URL}/sports/team?lg=${encodeURIComponent(lg)}&id=${encodeURIComponent(id)}`),
    ),
  );
  const list = settled
    .filter((s) => s.status === 'fulfilled')
    .map((s) => s.value?.row)
    .filter(Boolean);
  // Total upstream failure (every team fetch rejected): throw so the scheduler
  // backs off and the last good cache keeps rendering, instead of overwriting
  // it with an empty payload and a false "pick your teams" state.
  if (teams.length && !list.length && settled.some((s) => s.status === 'rejected')) {
    throw new Error('sports: all team fetches failed');
  }
  // Live games float to the top; otherwise keep the user's order.
  list.sort((a, b) => Number(b.state === 'in') - Number(a.state === 'in'));
  return { rows: list };
}
