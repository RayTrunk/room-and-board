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
      return rs.some((r) => routes.has(r)) || ss.some((s) => stops.has(s));
    })
    .slice(0, 2);
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
