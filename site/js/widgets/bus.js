// MTA Bus arrivals for route-first legs (stop + lineRef pair), via the
// Worker's Bus Time proxy. Shows minutes when a prediction exists, otherwise
// Bus Time's distance ("approaching", "2 stops away").

import { WORKER_URL } from '../env.js';
import { escapeHtml, fmtMin, setupPrompt } from '../util.js';
import { setMoreBadge } from '../card.js';
import { fitList } from '../capacity.js';
import { setExpandSource } from '../expand.js';

export const meta = { id: 'bus', title: 'Express Bus', refreshMs: 60 * 1000 };

// Minutes from now, derived at RENDER time rather than at fetch time.
//
// The view-model used to carry only `min`, a number that was true at the
// instant mapBus ran. A card re-renders on its own 60s refresh so the drift
// there is bounded, but a full-screen view is a snapshot built at tap time out
// of whatever vm is in hand — including a cached one — so a stored `min` would
// hang a frozen countdown on the wall. `at` (the absolute arrival instant the
// worker already sends) is the durable fact; `min` survives as the fallback
// for vms cached before this change, which age out within one refresh.
export function busMin(arrival, nowSec) {
  if (!arrival) return null;
  if (Number.isFinite(arrival.at)) return Math.max(1, Math.round((arrival.at - nowSec) / 60));
  return arrival.min ?? null;
}

// The countdown cell, shared by the card row and the full-screen board: real
// minutes when Bus Time predicted an arrival, otherwise its own words for how
// far off the bus is ("approaching", "2 stops away").
const minCell = (a, nowSec) => {
  const min = busMin(a, nowSec);
  return `<div class="train__min">${
    min !== null
      ? `<span>${fmtMin(min)}</span><small>min</small>`
      : `<small class="train__dist">${escapeHtml(a.distance || 'due')}</small>`
  }</div>`;
};

export function mapBus(payload, nowSec, legs) {
  if (!payload || payload.error || !Array.isArray(payload.stops)) {
    return { configured: !payload || payload.error !== 'bus_not_configured', stops: [] };
  }
  const legsArr = legs ?? [];
  return {
    configured: true,
    stops: payload.stops.map((stop, i) => {
      // Match each returned stop to its configured leg by (stopId, lineRef), NOT
      // by array position: the worker caches these under an order-insensitive
      // (sorted) key, so a board whose legs are ordered differently from the one
      // that populated the entry would otherwise take the wrong leg's route
      // label and stop name. Two legs can also be different routes at the same
      // stop, which is why the pair is the key rather than the id alone.
      // A payload without `lineRef` predates that worker change (the site and
      // worker deploy independently), so fall back to the old positional join.
      const leg = stop.lineRef === undefined
        ? legsArr[i]
        : legsArr.find((l) => l.stopId === stop.id && l.lineRef === stop.lineRef) ?? legsArr[i];
      return {
        id: stop.id,
        route: leg?.route ?? '',
        name: leg?.stopName || stop.name,
        arrivals: (stop.arrivals ?? [])
          .filter((a) => a.time === null || a.time > nowSec)
          .slice(0, 3)
          // `at` is the arrival instant; `min` is what it looked like at fetch
          // time and is kept only so a cached vm still renders (see busMin).
          .map((a) => ({
            dest: a.dest,
            at: a.time ?? null,
            min: a.time ? Math.max(1, Math.round((a.time - nowSec) / 60)) : null,
            distance: a.distance,
          })),
      };
    }),
  };
}

const stopLabel = (stop) => stop.name || `Stop ${stop.id}`;

// The full-screen departure board: every stop the card knows, every arrival it
// holds, in the rail overlay's grammar — uppercase quiet stop headers over big
// tabular countdowns, route then destination.
//
// Bespoke rather than train-expand's `.trains--board`, and the reason is the
// grouping. That board is one flat centered list on a single 40px rhythm, with
// no place to put a header: dropped in as another flex child, a stop name would
// sit exactly as far from its own arrivals as from the next stop's, and the
// grouping the whole view exists to show would stop reading. So the SHAPE is
// this file's (stop groups, tight inside and loose between) while the ROWS are
// the shared `.train` markup at the split board's type scale, which keeps
// tabular minutes, the "approaching" fallback and the ellipsis behaviour in one
// place for the card and the overlay alike.
function busBoard(vm, nowSec) {
  return `<div class="bus-board">${vm.stops
    .map(
      (stop) => `<div class="bus-board__group">
        <div class="bus-board__stop">${escapeHtml(stopLabel(stop))}</div>
        <div class="bus-board__rows">${
          stop.arrivals.length
            ? stop.arrivals
                .map(
                  (a) => `<div class="train">
                    ${minCell(a, nowSec)}
                    <div class="train__info">
                      <span class="train__dest">${escapeHtml(stop.route)}</span>
                      <span class="train__line">to ${escapeHtml(a.dest)}</span>
                    </div>
                  </div>`,
                )
                .join('')
            : '<div class="bus-board__none">No buses en route</div>'
        }</div>
      </div>`,
    )
    .join('')}</div>`;
}

export function render(el, vm, _cfg) {
  if (!vm.configured) {
    el.innerHTML = '<div class="empty">Bus Time key not configured on the server</div>';
    setMoreBadge(el, 0);
    setExpandSource(el, null); // nothing to open, and no stale count promising there is
    return;
  }
  if (!vm.stops.length) {
    el.innerHTML = setupPrompt('bus', 'add an express route', 'Express Bus');
    setMoreBadge(el, 0);
    setExpandSource(el, null); // the prompt's tap belongs to Settings, not the overlay
    return;
  }
  // Slice to the card, don't clip: each stop costs one header row plus its
  // arrival rows. Fit as many stops as have room for a header + one arrival,
  // sharing the remaining budget across their arrivals. The count here is a
  // ROW budget rather than a list slice, which is why no items are handed over
  // and why the corner count is stamped below: it counts STOPS, and the fit is
  // counting rows.
  const nowSec = Math.floor(Date.now() / 1000);
  let hiddenStops = 0;
  fitList(el, {
    id: meta.id,
    fallback: 4,
    draw: (rows) => {
      let left = rows;
      const groups = [];
      for (const stop of vm.stops) {
        if (left < 2) break; // no room for a header + at least one row
        const shown = stop.arrivals.slice(0, Math.max(1, Math.min(stop.arrivals.length || 1, left - 1)));
        left -= 1 + shown.length;
        groups.push({ ...stop, arrivals: shown });
      }
      hiddenStops = vm.stops.length - groups.length;
      el.innerHTML = groups
        .map(
          (stop) => `<div class="stop-group">
        <div class="stop-group__head"><span class="stop-group__name"><b class="buspill">${escapeHtml(stop.route)}</b> ${escapeHtml(stopLabel(stop))}</span></div>
        <div class="trains">${
          stop.arrivals.length
            ? stop.arrivals
                .map(
                  (a) => `<div class="train">
                    ${minCell(a, nowSec)}
                    <div class="train__info">
                      <span class="train__dest">${escapeHtml(a.dest)}</span>
                    </div>
                  </div>`,
                )
                .join('')
            : '<div class="empty">No buses en route</div>'
        }</div>
      </div>`,
        )
        .join('');
    },
  });
  setMoreBadge(el, hiddenStops);
  // Unconditional, the history precedent: the rows cover the card, so one card
  // means one destination and a card that fits its two stops still owes a tap
  // the bigger board. Only the badge tracks what is hidden. Minutes are derived
  // inside the builder, at TAP time, so a view opened late in a refresh cycle
  // counts down from now rather than from the last fetch.
  setExpandSource(el, () => ({
    title: meta.title,
    bodyHtml: busBoard(vm, Math.floor(Date.now() / 1000)),
  }));
}

export async function fetchData(cfg, net) {
  const legs = cfg.bus.legs ?? [];
  if (!legs.length) return { configured: true, stops: [] };
  // Each leg carries its agency-prefixed lineRef (stored at pick time).
  const param = legs.map((l) => `${encodeURIComponent(l.stopId)}:${encodeURIComponent(l.lineRef)}`).join(',');
  const payload = await net
    .fetchJSON(`${WORKER_URL}/bus/stops?legs=${param}`)
    .catch((err) => (String(err).includes('503') ? { error: 'bus_not_configured' } : Promise.reject(err)));
  return mapBus(payload, Math.floor(Date.now() / 1000), legs);
}
