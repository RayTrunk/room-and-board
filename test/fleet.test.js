import { describe, it, expect } from 'vitest';
import { deviceId, beaconPayload, reportWidgetHealth, healthVector, resetWidgetHealth } from '../site/js/fleet.js';
import { normalizeConfig } from '../site/js/config.js';

const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), map: m };
};

describe('deviceId', () => {
  it('creates a uuid, persists it, and returns the same id next time', () => {
    const s = memStorage();
    const id = deviceId(s);
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
    expect(s.map.get('sgn.device')).toBe(id);
    expect(deviceId(s)).toBe(id);
  });
  it('regenerates when the stored value is junk', () => {
    const s = memStorage({ 'sgn.device': '<script>alert(1)</script>' });
    expect(deviceId(s)).toMatch(/^[a-f0-9-]{36}$/);
  });
  it('tags the id ephemeral when storage throws — sessions, not devices', () => {
    const broken = { getItem() { throw new Error('nope'); }, setItem() { throw new Error('nope'); } };
    expect(deviceId(broken)).toMatch(/^e-[a-f0-9-]{36}$/);
  });
  it('tags the id ephemeral when storage lies — accepts the write, keeps nothing', () => {
    // Private-mode behaviour: setItem does not throw, but nothing persists.
    const liar = { getItem() { return null; }, setItem() { /* swallowed */ } };
    expect(deviceId(liar)).toMatch(/^e-[a-f0-9-]{36}$/);
  });
  it('never persists the ephemeral prefix — a working store gets a plain uuid', () => {
    const s = memStorage();
    expect(deviceId(s)).not.toMatch(/^e-/);
    expect(s.map.get('sgn.device')).not.toMatch(/^e-/);
  });
});

describe('beaconPayload', () => {
  it('carries widget ids, mode, version, tz — and nothing personal', () => {
    const cfg = normalizeConfig({ name: 'Sean', mode: 'scheduled' });
    const p = beaconPayload(cfg, 'abc-123', '9d757c6ee919');
    expect(p.widgets).toEqual(cfg.layout.map((r) => r.id));
    expect(p.mode).toBe('scheduled');
    expect(p.version).toBe('9d757c6ee919');
    expect(typeof p.tz).toBe('string');
    expect(JSON.stringify(p)).not.toContain('Sean'); // no PII on the wire
  });
  it('falls back to unknown when the version fetch failed', () => {
    expect(beaconPayload(normalizeConfig({}), 'abc-123', null).version).toBe('unknown');
  });
});

describe('widget health vector (Tier 2, exceptions only — backlog item 9)', () => {
  it('collects only unhealthy widgets and clears them on recovery', () => {
    resetWidgetHealth();
    expect(healthVector()).toBe('');
    reportWidgetHealth('lirr', 'stale');
    reportWidgetHealth('njt', 'error');
    expect(healthVector()).toBe('lirr=stale,njt=error');
    reportWidgetHealth('lirr', null); // recovered: drops out entirely
    expect(healthVector()).toBe('njt=error');
    resetWidgetHealth();
    expect(healthVector()).toBe('');
  });
  it('caps a pathological vector with a truncation mark', () => {
    resetWidgetHealth();
    for (let i = 0; i < 40; i += 1) reportWidgetHealth(`w${String(i).padStart(2, '0')}xxxxxxxxxx`, 'error');
    const v = healthVector();
    expect(v.length).toBeLessThanOrEqual(200);
    expect(v.endsWith('…')).toBe(true);
    resetWidgetHealth();
  });
  it('rides the beacon payload as `health`', () => {
    resetWidgetHealth();
    reportWidgetHealth('markets', 'error');
    expect(beaconPayload(normalizeConfig({}), 'abc-123', 'v1').health).toBe('markets=error');
    resetWidgetHealth();
    expect(beaconPayload(normalizeConfig({}), 'abc-123', 'v1').health).toBe('');
  });
});
