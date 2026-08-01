// Shared rendering for transit service-alert rows (subway, LIRR, NJT cards).

import { escapeHtml } from './util.js';

// The digest is fleet-shared; relevance is per card. Keep an alert when it
// names a branch this card is showing (departure routeIds) or a station this
// rider touches (terminal + stops-at pick), or when it's untargeted
// (systemwide). OR, not AND: a branch-tagged delay about an intermediate
// station still affects the rider's train. An empty board skips the filter —
// a suspension notice is exactly what explains the missing trains. Cap of 2
// applies after filtering, so irrelevant rows never spend a banner slot.
export function cardAlerts(alerts, departures, stopIds) {
  const all = alerts ?? [];
  if (!departures?.length) return all.slice(0, 2);
  const routes = new Set(departures.map((d) => d.routeId).filter(Boolean));
  const stops = new Set(stopIds);
  return all
    .filter((a) => {
      const rs = a.routes ?? [];
      const ss = a.stops ?? [];
      if (!rs.length && !ss.length) return true;
      // Station-local notices (elevator out, access restricted — the digest's
      // Mercury-derived kind) follow their STATION: a branch tag alone showed
      // a Poughkeepsie rider Riverdale's stair closure. Service alerts keep
      // the branch match, so a line-wide delay tagged with its incident
      // station still reaches every rider on the line.
      if (a.kind === 'station') return ss.some((s) => stops.has(s));
      return rs.some((r) => routes.has(r)) || ss.some((s) => stops.has(s));
    })
    .slice(0, 2);
}

// ---------- route tokens inside alert prose ----------

// The MTA writes its alerts with bracketed route tokens mid-sentence: "In
// Manhattan, no [1] between 14 St and South Ferry". The worker strips the
// LEADING run of them (the routes array carries that), but the ones inside the
// sentence are part of the sentence, and a bracketed numeral is not a signal at
// six feet. Swap them for the bullet the line already wears everywhere else on
// the board — the same substitution the card row and the expanded status board
// both need, which is why it lives here rather than in either of them.
//
// Escape FIRST and substitute after: the brackets survive escaping, so the
// tokens are still there to find, and nothing the feed writes can reach the DOM
// as markup. Only ids the bullet palette actually knows are swapped; anything
// else (a system tag, a stray bracket) is left exactly as written, which is the
// raw text we print today.
const ROUTE_TOKEN = /\[([A-Z0-9]{1,3})\]/g;
// Feed ids that ride another line's bullet: express variants and the shuttles
// (subway.js LINE_ALIASES, read from the other side).
const BULLET_ALIAS = { '6X': '6', '7X': '7', FX: 'F', GS: 'S', FS: 'S', H: 'S', SIR: 'SI' };
const BULLET_ROUTES = new Set([
  '1', '2', '3', '4', '5', '6', '7', 'A', 'C', 'E', 'B', 'D', 'F', 'M',
  'G', 'J', 'Z', 'L', 'N', 'Q', 'R', 'W', 'S', 'SI',
]);

export function routeBullets(text) {
  return escapeHtml(String(text ?? '')).replace(ROUTE_TOKEN, (raw, id) => {
    const route = BULLET_ALIAS[id] ?? id;
    return BULLET_ROUTES.has(route)
      ? `<span class="bullet bullet--${route} bullet--inline">${route}</span>`
      : raw;
  });
}

export function renderAlertRows(alerts) {
  if (!alerts?.length) return '';
  return alerts
    .slice(0, 2)
    .map(
      (a) => `<div class="talert">
        <span class="talert__icon" aria-hidden="true">⚠</span>
        ${a.routes?.length ? a.routes.slice(0, 4).map((r) => `<span class="bullet bullet--${escapeHtml(r)} bullet--sm">${escapeHtml(r)}</span>`).join('') : ''}
        <span class="talert__text">${escapeHtml(a.header)}</span>
      </div>`,
    )
    .join('');
}
