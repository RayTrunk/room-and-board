// MTA service-alert digestion. The raw camsys feeds are large (the subway one
// runs ~800 KB), so the Worker reduces them to compact rows and the whole
// fleet shares one cached digest.

const FEEDS = {
  subway: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json',
  lirr: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Flirr-alerts.json',
  mnr: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fmnr-alerts.json',
};

// GTFS-RT ServiceAlerts (JSON flavor) -> [{routes, header}], active now only.
export function mapMtaAlerts(json, nowSec) {
  const out = [];
  const byKey = new Map();
  for (const entity of json.entity ?? []) {
    const alert = entity.alert;
    if (!alert) continue;
    const periods = alert.active_period ?? [];
    const active =
      periods.length === 0 ||
      periods.some((p) => (p.start ?? 0) <= nowSec && (p.end === undefined || p.end >= nowSec));
    if (!active) continue;
    const routes = [
      ...new Set((alert.informed_entity ?? []).map((ie) => ie.route_id).filter(Boolean)),
    ];
    // Stations too: cards filter to the rider's own stops (uncapped — a
    // truncated list could silently suppress someone's station alert).
    const stops = [
      ...new Set((alert.informed_entity ?? []).map((ie) => ie.stop_id).filter(Boolean)),
    ];
    const en =
      alert.header_text?.translation?.find((t) => t.language === 'en') ??
      alert.header_text?.translation?.[0];
    if (!en?.text) continue;
    // Headers lead with "[A][C]" route tokens; the routes array carries that.
    const header = en.text.replace(/^(\s*\[[A-Z0-9]+\])+\s*/, '').trim();
    const key = header.slice(0, 80);
    // Same header for different routes: union the routes into the existing row
    // instead of dropping the second entity (else a filtered route loses its alert).
    const existing = byKey.get(key);
    if (existing) {
      for (const r of routes) if (!existing.routes.includes(r)) existing.routes.push(r);
      for (const s of stops) if (!existing.stops.includes(s)) existing.stops.push(s);
      continue;
    }
    // The MTA's Mercury extension names each alert's nature. "Station Notice"
    // (elevator outages, access restrictions, temporary platforms) is local to
    // its tagged stations even though it also carries a route tag — the cards
    // filter those by station, not branch. Anything else, or a feed without
    // the extension, is service news and stays branch-matched.
    const kind =
      alert['transit_realtime.mercury_alert']?.alert_type === 'Station Notice' ? 'station' : 'service';
    const row = { routes: [...routes], stops: [...stops], kind, header };
    byKey.set(key, row);
    out.push(row);
  }
  return out.slice(0, 30);
}

export async function fetchMtaAlerts(system) {
  const res = await fetch(FEEDS[system], { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`mta alerts ${res.status}`);
  const nowSec = Math.floor(Date.now() / 1000);
  return { updatedAt: nowSec, stale: false, alerts: mapMtaAlerts(await res.json(), nowSec) };
}
