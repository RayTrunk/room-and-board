import { describe, it, expect, vi } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../../worker/src/index.js';
import { parseBeacon, beaconDataPoint, deviceModel } from '../../worker/src/fleet.js';

const ctx = { waitUntil() {}, passThroughOnException() {} };
const call = (path, init, extraEnv = {}) =>
  worker.fetch(new Request(`https://api.test${path}`, init), { ...env, ...extraEnv }, ctx);

const VALID = {
  deviceId: 'a3f1c2d4-5678-4abc-9def-0123456789ab',
  widgets: ['weather', 'subway', 'markets'],
  mode: 'scheduled',
  version: '9d757c6ee919',
  tz: 'America/New_York',
};

// What an OLD board's payload normalizes to: every optional field empty or 0.
// Kept as one object because "absent means unknown, never a default" is the
// whole contract with the stats app, and it is easiest to see in one place.
const ABSENT = {
  health: '', channel: '', viewport: '', saver: '', units: '',
  bootMs: 0, bootRetries: 0, taps: 0, wkrMs: 0,
};

describe('parseBeacon', () => {
  it('accepts a valid payload and normalizes it', () => {
    const p = parseBeacon(JSON.stringify(VALID));
    expect(p).toEqual({ ...VALID, ...ABSENT }); // an old board omits every optional field
  });

  it('bounds the widget-health field: well-formed passes, junk and oversize empty out', () => {
    const with_ = (health) => parseBeacon(JSON.stringify({ ...VALID, health }));
    expect(with_('lirr=stale,njt=error').health).toBe('lirr=stale,njt=error');
    expect(with_('w00=error,…').health).toBe('w00=error,…'); // the site's truncation mark survives
    expect(with_('<b>markup</b>').health).toBe('');
    expect(with_('A=Loud').health).toBe(''); // lowercase-only, like widget ids
    expect(with_('x='.repeat(150)).health).toBe(''); // over the 200-char bound
    expect(with_(42).health).toBe('');
  });
  it('lowercases the device id and tolerates missing optional fields', () => {
    const p = parseBeacon(JSON.stringify({ deviceId: 'ABCDEF12-3456', widgets: [] }));
    expect(p.deviceId).toBe('abcdef12-3456');
    expect(p).toMatchObject({ widgets: [], mode: 'unknown', version: 'unknown', tz: '' });
  });
  it('filters junk widget ids, dedupes, caps at 32', () => {
    const widgets = ['weather', 'weather', '<svg>', 'x'.repeat(30), 42, ...Array.from({ length: 40 }, (_, i) => `w${'x'.repeat((i % 18) + 1)}`)];
    const p = parseBeacon(JSON.stringify({ ...VALID, widgets }));
    expect(p.widgets[0]).toBe('weather');
    expect(p.widgets).not.toContain('<svg>');
    expect(p.widgets.length).toBeLessThanOrEqual(32);
    expect(new Set(p.widgets).size).toBe(p.widgets.length);
  });
  it('keeps widget ids with digits (f1) but drops numeric-only ids', () => {
    const p = parseBeacon(JSON.stringify({ ...VALID, widgets: ['f1', 'worldclock', '42', 'a1b2'] }));
    expect(p.widgets).toContain('f1');
    expect(p.widgets).toContain('worldclock');
    expect(p.widgets).toContain('a1b2');
    expect(p.widgets).not.toContain('42'); // must start with a letter
  });
  // The filter is SHAPE-only on purpose, never WIDGET_IDS membership: a board
  // still carrying a card the site has since deleted (worldcup, removed
  // 2026-07-29) keeps reporting it, and the adoption history downstream depends
  // on those pings arriving rather than being dropped at the edge.
  it('still accepts ids the site no longer ships', () => {
    const p = parseBeacon(JSON.stringify({ ...VALID, widgets: ['worldcup', 'ambient'] }));
    expect(p.widgets).toEqual(['worldcup', 'ambient']);
  });
  it('rejects malformed bodies', () => {
    expect(parseBeacon('not json')).toBeNull();
    expect(parseBeacon(JSON.stringify({ widgets: [] }))).toBeNull(); // no deviceId
    expect(parseBeacon(JSON.stringify({ deviceId: 'nope!', widgets: [] }))).toBeNull();
    expect(parseBeacon(JSON.stringify({ ...VALID, widgets: 'weather' }))).toBeNull();
    expect(parseBeacon('x'.repeat(3000))).toBeNull(); // oversized
  });
  it('sanitizes hostile mode/version/tz to safe fallbacks', () => {
    const p = parseBeacon(JSON.stringify({ ...VALID, mode: 'evil', version: '<script>', tz: 'a'.repeat(99) }));
    expect(p).toMatchObject({ mode: 'unknown', version: 'unknown', tz: '' });
  });

  // -------------------------------------------------------------------------
  // Runtime fields (site fleet.js, 2026-08-10). Each is optional and bounded;
  // junk NEVER reaches Analytics Engine, where an unbounded double would poison
  // a fleet median permanently.
  // -------------------------------------------------------------------------
  const field = (name, value) => parseBeacon(JSON.stringify({ ...VALID, [name]: value }))[name];

  it('bounds the serving channel to the three real deployments', () => {
    expect(field('channel', 'prod')).toBe('prod');
    expect(field('channel', 'beta')).toBe('beta');
    expect(field('channel', 'dev')).toBe('dev');
    // '' and NOT 'prod': a default here would tell the stats app that every
    // old board is definitely production and switch off its lineage fallback.
    expect(field('channel', 'staging')).toBe('');
    expect(field('channel', 'PROD')).toBe('');
    expect(field('channel', '<b>prod</b>')).toBe('');
    expect(field('channel', 7)).toBe('');
    expect(parseBeacon(JSON.stringify(VALID)).channel).toBe('');
  });

  it('bounds the viewport to a plain WxH of plausible size', () => {
    expect(field('viewport', '1920x1040')).toBe('1920x1040'); // Board Pro
    expect(field('viewport', '1920x1200')).toBe('1920x1200'); // Navigator
    expect(field('viewport', '800x600')).toBe('800x600');
    expect(field('viewport', '19200x10400')).toBe('');        // 5 digits: out of bounds
    expect(field('viewport', '19x10')).toBe('');
    expect(field('viewport', '1920X1040')).toBe('');          // lowercase x only
    expect(field('viewport', '1920x1040; drop table')).toBe('');
    expect(field('viewport', 1920)).toBe('');
  });

  it('bounds the screensaver id exactly like a widget id, and takes none', () => {
    expect(field('saver', 'none')).toBe('none'); // "screensaver off" is data
    expect(field('saver', 'art')).toBe('art');
    expect(field('saver', 'gdrivephotos')).toBe('gdrivephotos');
    expect(field('saver', 'worldclocks')).toBe('worldclocks');
    expect(field('saver', 'Art')).toBe('');       // lowercase only
    expect(field('saver', '2clocks')).toBe('');   // must start with a letter
    expect(field('saver', 'x'.repeat(21))).toBe(''); // 20 chars max
    expect(field('saver', '<script>')).toBe('');
  });

  it('bounds the units code to the four real combinations', () => {
    for (const u of ['F12', 'F24', 'C12', 'C24']) expect(field('units', u)).toBe(u);
    expect(field('units', 'K12')).toBe('');
    expect(field('units', 'F13')).toBe('');
    expect(field('units', 'f12')).toBe('');
    expect(field('units', 'F1224')).toBe('');
  });

  it('bounds every counter, with 0 for absent, junk and out-of-range alike', () => {
    expect(field('bootMs', 2482)).toBe(2482);
    expect(field('bootMs', 2481.7)).toBe(2482);      // rounded to an integer
    expect(field('bootMs', 600000)).toBe(600000);    // the ceiling itself passes
    expect(field('bootMs', 600001)).toBe(0);
    expect(field('bootMs', -1)).toBe(0);
    expect(field('bootMs', 'soon')).toBe(0);         // Number() -> NaN -> 0
    expect(field('bootMs', Infinity)).toBe(0);       // JSON turns this into null
    expect(field('bootMs', null)).toBe(0);
    expect(field('bootMs', [])).toBe(0);

    expect(field('bootRetries', 3)).toBe(3);
    expect(field('bootRetries', 99)).toBe(99);
    expect(field('bootRetries', 100)).toBe(0);

    expect(field('taps', 42)).toBe(42);
    expect(field('taps', 10000)).toBe(10000);
    expect(field('taps', 10001)).toBe(0);

    expect(field('wkrMs', 180)).toBe(180);
    expect(field('wkrMs', 60000)).toBe(60000);
    expect(field('wkrMs', 60001)).toBe(0);
    expect(field('wkrMs', 9e99)).toBe(0);
  });

  it('accepts a full modern payload untouched', () => {
    const modern = {
      ...VALID, health: 'lirr=stale', channel: 'beta', viewport: '1920x1040',
      saver: 'art', units: 'C24', bootMs: 2482, bootRetries: 1, taps: 17, wkrMs: 180,
    };
    expect(parseBeacon(JSON.stringify(modern))).toEqual(modern);
  });

  it('still fits the body cap with every field populated', () => {
    const modern = JSON.stringify({
      ...VALID, widgets: Array.from({ length: 32 }, (_, i) => `widget${i}`),
      health: 'x'.repeat(200), channel: 'prod', viewport: '1920x1040',
      saver: 'gdrivephotos', units: 'F12', bootMs: 600000, bootRetries: 99, taps: 10000, wkrMs: 60000,
    });
    expect(modern.length).toBeLessThan(2048);
    expect(parseBeacon(modern)).not.toBeNull();
  });
});

describe('deviceModel', () => {
  it('parses ANY RoomOS model, not just boards (model-agnostic)', () => {
    const ua = (m) => `Mozilla/5.0 (Linux; RoomOS; ${m}) AppleWebKit/537.36 (KHTML, like Gecko) QtWebEngine/5.14.2 Chrome/77 Safari/537.36`;
    expect(deviceModel(ua('Cisco Board Pro'))).toBe('Cisco Board Pro');
    expect(deviceModel(ua('Cisco Webex Desk Pro'))).toBe('Cisco Webex Desk Pro');
    expect(deviceModel(ua('Cisco Room Bar'))).toBe('Cisco Room Bar');
    expect(deviceModel(ua('Cisco Room Navigator'))).toBe('Cisco Room Navigator');
    expect(deviceModel(ua('Cisco Board Pro G2'))).toBe('Cisco Board Pro G2');
  });
  it('handles a malformed model paren and defaults non-RoomOS traffic to other', () => {
    // Legacy Board 70 UA has an unbalanced paren before AppleWebKit.
    expect(deviceModel('Mozilla/5.0 (Linux; RoomOS; Cisco Webex Board (70) AppleWebKit/537.36')).toBe('Cisco Webex Board');
    expect(deviceModel('Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/149 Safari/537.36')).toBe('other');
    expect(deviceModel(null)).toBe('other');
  });
});

describe('beaconDataPoint', () => {
  it('maps to the Analytics Engine shape indexed by device, country then model last', () => {
    const p = { ...parseBeacon(JSON.stringify(VALID)), country: 'US', model: 'Cisco Board Pro' };
    expect(beaconDataPoint(p)).toEqual({
      indexes: [VALID.deviceId],
      // An old board's row: the dimensions it does report, then empty runtime
      // slots. blob8 (index 7) is the channel — reserved-and-empty until
      // 2026-08-10, and widget health has stayed on blob9 (index 8) throughout.
      blobs: [VALID.deviceId, VALID.version, VALID.mode, VALID.tz, 'weather,subway,markets', 'US', 'Cisco Board Pro', '', '', '', '', ''],
      doubles: [3, 0, 0, 0, 0],
    });
  });

  // -------------------------------------------------------------------------
  // POSITIONS ARE THE SCHEMA. Analytics Engine columns have no names — the
  // stats app reads blob8/blob10/double4 by position — so a reshuffle silently
  // rewrites every row already stored. These assertions exist to fail loudly if
  // anyone inserts a field in the middle.
  // -------------------------------------------------------------------------
  it('pins every column position for a fully-populated payload', () => {
    const modern = {
      ...VALID, health: 'lirr=stale', channel: 'beta', viewport: '1920x1040',
      saver: 'art', units: 'C24', bootMs: 2482, bootRetries: 1, taps: 17, wkrMs: 180,
    };
    const dp = beaconDataPoint({ ...parseBeacon(JSON.stringify(modern)), country: 'US', model: 'Cisco Board Pro' });
    expect(dp.blobs[0]).toBe(VALID.deviceId);            // blob1
    expect(dp.blobs[1]).toBe(VALID.version);             // blob2
    expect(dp.blobs[2]).toBe(VALID.mode);                // blob3
    expect(dp.blobs[3]).toBe(VALID.tz);                  // blob4
    expect(dp.blobs[4]).toBe('weather,subway,markets');  // blob5
    expect(dp.blobs[5]).toBe('US');                      // blob6
    expect(dp.blobs[6]).toBe('Cisco Board Pro');         // blob7
    expect(dp.blobs[7]).toBe('beta');                    // blob8  channel
    expect(dp.blobs[8]).toBe('lirr=stale');              // blob9  health
    expect(dp.blobs[9]).toBe('1920x1040');               // blob10 viewport
    expect(dp.blobs[10]).toBe('art');                    // blob11 saver
    expect(dp.blobs[11]).toBe('C24');                    // blob12 units
    expect(dp.blobs).toHaveLength(12);
    expect(dp.doubles).toEqual([3, 2482, 1, 17, 180]);   // count, bootMs, retries, taps, wkrMs
  });

  it('carries the widget-health vector in blob9, with the channel now live in blob8', () => {
    const p = { ...parseBeacon(JSON.stringify({ ...VALID, health: 'lirr=stale', channel: 'prod' })), country: 'US', model: 'x' };
    const dp = beaconDataPoint(p);
    expect(dp.blobs[7]).toBe('prod');
    expect(dp.blobs[8]).toBe('lirr=stale');
  });

  it('leaves the runtime slots empty for a board that reports none of them', () => {
    // Old builds must produce columns that read as UNKNOWN, not as a value: ''
    // for the enums and 0 for the counters, in their own positions.
    const dp = beaconDataPoint({ ...parseBeacon(JSON.stringify(VALID)), country: 'US', model: 'x' });
    expect([dp.blobs[7], dp.blobs[9], dp.blobs[10], dp.blobs[11]]).toEqual(['', '', '', '']);
    expect(dp.doubles.slice(1)).toEqual([0, 0, 0, 0]);
  });

  it('never mints an undefined column from a raw payload that predates the fields', () => {
    // The route hands over parseBeacon output, but a caller (and the test just
    // below) may pass a raw body; undefined in a blob is an AE write error.
    const dp = beaconDataPoint({ ...VALID, country: 'US', model: 'x' });
    expect(dp.blobs.every((b) => typeof b === 'string')).toBe(true);
    expect(dp.doubles.every((n) => Number.isFinite(n))).toBe(true);
  });
  it('defaults country to XX and model to other when absent (never trusts the payload)', () => {
    const base = parseBeacon(JSON.stringify(VALID));
    expect(beaconDataPoint(base).blobs[5]).toBe('XX');
    expect(beaconDataPoint(base).blobs[6]).toBe('other');
    expect(beaconDataPoint({ ...base, country: 'usa' }).blobs[5]).toBe('XX'); // not alpha-2
    expect(beaconDataPoint({ ...base, country: '<b>' }).blobs[5]).toBe('XX');
  });
});

describe('POST /fleet', () => {
  it('writes a data point and returns 204', async () => {
    const writeDataPoint = vi.fn();
    const res = await call('/fleet', { method: 'POST', body: JSON.stringify(VALID) }, { ANALYTICS: { writeDataPoint } });
    expect(res.status).toBe(204);
    expect(writeDataPoint).toHaveBeenCalledWith(beaconDataPoint(VALID));
  });
  it('rejects malformed payloads with 400', async () => {
    const writeDataPoint = vi.fn();
    const res = await call('/fleet', { method: 'POST', body: 'junk' }, { ANALYTICS: { writeDataPoint } });
    expect(res.status).toBe(400);
    expect(writeDataPoint).not.toHaveBeenCalled();
  });
  it('accepts quietly when the ANALYTICS binding is absent (self-host without metrics)', async () => {
    const res = await call('/fleet', { method: 'POST', body: JSON.stringify(VALID) }, { ANALYTICS: undefined });
    expect(res.status).toBe(204);
  });
  it('stamps the edge country and the RoomOS model from request headers', async () => {
    const writeDataPoint = vi.fn();
    const res = await call('/fleet', {
      method: 'POST', body: JSON.stringify(VALID),
      headers: { 'CF-IPCountry': 'GB', 'User-Agent': 'Mozilla/5.0 (Linux; RoomOS; Cisco Board Pro G2) AppleWebKit/537.36' },
    }, { ANALYTICS: { writeDataPoint } });
    expect(res.status).toBe(204);
    expect(writeDataPoint.mock.calls[0][0].blobs[5]).toBe('GB');
    expect(writeDataPoint.mock.calls[0][0].blobs[6]).toBe('Cisco Board Pro G2');
  });
  it('refuses oversized bodies', async () => {
    const writeDataPoint = vi.fn();
    const res = await call('/fleet', {
      method: 'POST', body: 'x'.repeat(99999),
    }, { ANALYTICS: { writeDataPoint } });
    expect(res.status).toBe(400);
    expect(writeDataPoint).not.toHaveBeenCalled();
  });
});
