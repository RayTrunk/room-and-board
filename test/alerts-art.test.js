import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { mapMtaAlerts } from '../worker/src/alerts.js';
import { mapNjtMessages } from '../worker/src/njt.js';
import { filterByCats } from '../site/js/widgets/art.js';

const fixture = async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

describe('mapMtaAlerts', () => {
  it('digests the recorded subway feed: active only, routes, clean headers', async () => {
    const json = await fixture('mta-alerts-subway.json');
    const nowSec = json.entity[0].alert.active_period[0].start + 60;
    const alerts = mapMtaAlerts(json, nowSec);
    expect(alerts.length).toBeGreaterThan(0);
    for (const a of alerts) {
      expect(Array.isArray(a.routes)).toBe(true);
      expect(a.header.length).toBeGreaterThan(10);
      expect(a.header.startsWith('[')).toBe(false); // route tokens stripped
    }
  });
  it('drops alerts whose active window has passed', () => {
    const json = { entity: [{ alert: { active_period: [{ start: 100, end: 200 }], informed_entity: [{ route_id: 'A' }], header_text: { translation: [{ text: 'old news here', language: 'en' }] } } }] };
    expect(mapMtaAlerts(json, 500)).toEqual([]);
    expect(mapMtaAlerts(json, 150)).toHaveLength(1);
  });
  it('dedupes repeated headers', () => {
    const entity = (route) => ({ alert: { informed_entity: [{ route_id: route }], header_text: { translation: [{ text: 'Same alert text for both.', language: 'en' }] } } });
    expect(mapMtaAlerts({ entity: [entity('A'), entity('C')] }, 0)).toHaveLength(1);
  });
  it('carries the informed stations so cards can judge relevance', () => {
    // Live LIRR shape: "first four cars to exit at Forest Hills" is tagged
    // route 12 (City Terminal) + stop 55 (Forest Hills).
    const json = { entity: [{ alert: {
      informed_entity: [{ route_id: '12' }, { stop_id: '55' }, { stop_id: '55' }, { route_id: '12', stop_id: '56' }],
      header_text: { translation: [{ text: 'You must be in the first four cars to exit at Forest Hills.', language: 'en' }] },
    } }] };
    const [row] = mapMtaAlerts(json, 0);
    expect(row.routes).toEqual(['12']);
    expect(row.stops).toEqual(['55', '56']);
  });
  it('classifies station-local notices by the Mercury alert type', () => {
    // Live MNR shape 2026-07-31: "Riverdale station north end access is
    // restricted" is alert_type "Station Notice", tagged route 1 + stop 16 —
    // branch-relevant by tag, station-local by nature.
    const mk = (alert_type) => ({ alert: {
      'transit_realtime.mercury_alert': { alert_type },
      informed_entity: [{ route_id: '1' }, { stop_id: '16' }],
      header_text: { translation: [{ text: 'Riverdale station north end access is restricted.', language: 'en' }] },
    } });
    expect(mapMtaAlerts({ entity: [mk('Station Notice')] }, 0)[0].kind).toBe('station');
    expect(mapMtaAlerts({ entity: [mk('Delays')] }, 0)[0].kind).toBe('service');
    // No Mercury extension at all: default to service, the show-by-branch side.
    const bare = { alert: { informed_entity: [{ route_id: '1' }], header_text: { translation: [{ text: 'Delays on the line here.', language: 'en' }] } } };
    expect(mapMtaAlerts({ entity: [bare] }, 0)[0].kind).toBe('service');
  });
  it('carries the long description so a tapped banner can show the whole story', () => {
    const json = { entity: [{ alert: {
      informed_entity: [{ route_id: '1' }],
      header_text: { translation: [{ text: 'Riverdale station north end access is restricted.', language: 'en' }] },
      description_text: { translation: [{ text: 'Use the main entrance at W 254 St &amp; allow extra time.', language: 'en' }] },
    } }] };
    const [row] = mapMtaAlerts(json, 0);
    expect(row.body).toBe('Use the main entrance at W 254 St & allow extra time.');
    // No description: body is an empty string, not undefined (stable shape).
    const bare = { entity: [{ alert: { informed_entity: [], header_text: { translation: [{ text: 'Delays everywhere today.', language: 'en' }] } } }] };
    expect(mapMtaAlerts(bare, 0)[0].body).toBe('');
  });
  it('unions stops for entities sharing a header, like routes', () => {
    const entity = (stop) => ({ alert: { informed_entity: [{ stop_id: stop }], header_text: { translation: [{ text: 'Elevator outage at this station.', language: 'en' }] } } });
    const out = mapMtaAlerts({ entity: [entity('55'), entity('89'), entity('55')] }, 0);
    expect(out).toHaveLength(1);
    expect(out[0].stops.sort()).toEqual(['55', '89']);
  });
});

describe('mapNjtMessages', () => {
  it('repairs NJT\'s mangled dashes: a floating question mark is never punctuation', () => {
    // NJT's CMS pushes em dashes through a legacy charset and substitutes '?'
    // ("BTS Concerts ? Saturday", live 2026-07-31). English never puts a space
    // BEFORE a question mark, so the spaced form is unambiguous damage; a real
    // question keeps its mark.
    const out = mapNjtMessages({ STATIONMSGS: [
      { MSG_TEXT: 'Rail Service for BTS Concerts ? Saturday, August 1, 2026' },
      { MSG_TEXT: 'Have questions? Visit njtransit.com for details.' },
    ] });
    expect(out[0].header).toBe('Rail Service for BTS Concerts – Saturday, August 1, 2026');
    expect(out[1].header).toBe('Have questions? Visit njtransit.com for details.');
  });
  it('strips html and empty messages', () => {
    const out = mapNjtMessages({ STATIONMSGS: [
      { MSG_TEXT: '<p>Track work <strong>this weekend</strong>.</p>' },
      { MSG_TEXT: '  ' },
    ]});
    expect(out).toHaveLength(1);
    expect(out[0].header).toBe('Track work this weekend .');
    expect(out[0].header).not.toContain('<');
  });
});

describe('filterByCats', () => {
  const manifest = [
    { title: 'a', cat: 'european' },
    { title: 'b', cat: 'american' },
    { title: 'c', cat: 'asian' },
    { title: 'd' }, // uncategorized always passes
  ];
  it('filters to selected categories, keeps uncategorized', () => {
    expect(filterByCats(manifest, ['asian']).map((a) => a.title)).toEqual(['c', 'd']);
    expect(filterByCats(manifest, [])).toHaveLength(4);
    expect(filterByCats(manifest, undefined)).toHaveLength(4);
  });
  it('never filters to an empty slideshow', () => {
    expect(filterByCats([{ title: 'x', cat: 'european' }], ['asian'])).toHaveLength(1);
  });
});
