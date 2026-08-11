// @vitest-environment happy-dom
// Storage resilience: the board runs unattended, so a quota or security throw
// from localStorage must never kill boot or silently eat a Save.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { saveConfig, loadConfig } from '../site/js/store.js';
import { normalizeConfig, decodeConfig } from '../site/js/config.js';

function fakeStorage({ failFirstSet = false } = {}) {
  const map = new Map([
    ['sgn.cache.weather', 'x'],
    ['sgn.cache.golf', 'y'],
    ['unrelated-key', 'z'],
  ]);
  let failed = false;
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      if (failFirstSet && !failed) {
        failed = true;
        const e = new Error('quota');
        e.name = 'QuotaExceededError';
        throw e;
      }
      map.set(k, v);
    },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

const realDesc = Object.getOwnPropertyDescriptor(window, 'localStorage');
function stubStorage(st) {
  Object.defineProperty(window, 'localStorage', { value: st, configurable: true });
}

// applyConfig asks the page whether this is a demo session, so the tests have
// to be able to answer. Same defineProperty trick as localStorage, and it also
// keeps the real `reload` out of reach even though every test injects its own.
const realLoc = Object.getOwnPropertyDescriptor(window, 'location');
function stubLocation(search) {
  Object.defineProperty(window, 'location', {
    value: { search, reload: () => { throw new Error('a test navigated for real'); } },
    configurable: true,
  });
}

afterEach(() => {
  if (realDesc) Object.defineProperty(window, 'localStorage', realDesc);
  if (realLoc) Object.defineProperty(window, 'location', realLoc);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('store quota/availability resilience', () => {
  it('clears widget caches and retries when the config write hits quota', async () => {
    const st = fakeStorage({ failFirstSet: true });
    stubStorage(st);
    await saveConfig(normalizeConfig({}));
    expect(st._map.has('sgn.cfg')).toBe(true); // config won
    expect(st._map.has('sgn.cache.weather')).toBe(false); // caches sacrificed
    expect(st._map.has('sgn.cache.golf')).toBe(false);
    expect(st._map.has('unrelated-key')).toBe(true); // only our prefix
  });

  it('loadConfig returns null instead of throwing when storage is unavailable', async () => {
    stubStorage({ getItem: () => { throw new Error('SecurityError'); } });
    await expect(loadConfig()).resolves.toBeNull();
  });
});

/* ---------- applying a config to the board ---------- */

// The ritual edit mode's Done and Settings' Save both perform: stamp, persist,
// mirror to the macro vault, reload. It was copied prose in two files and
// therefore untestable, since half of it reached through a global and the other
// half ended in a real navigation. It is one function now, so this is the first
// time any of it has been pinned.

// The bridge and the vault status are module state, so each test takes a fresh
// copy of store.js rather than inheriting whatever the previous one connected.
async function freshStore() {
  vi.resetModules();
  return import('../site/js/store.js');
}

function fakeBridge({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    async sendConfig(encoded) {
      sent.push(encoded);
      if (fail) throw new Error('bridge: send timeout');
    },
  };
}

describe('applyConfig: one operation applies a config to the board', () => {
  it('round-trips the bridge, and null is how a failed connect is reported', async () => {
    const store = await freshStore();
    // Never attempted is NOT offline: most boards carry no auth fragment at all
    // and Diagnostics must not accuse the network of something that never
    // happened. This is the distinction the old `window.__signage.vault`
    // undefined-vs-'offline' encoded by accident; it is deliberate here.
    expect(store.getBridge()).toBeNull();
    expect(store.vaultStatus()).toBeNull();

    const bridge = fakeBridge();
    store.setBridge(bridge);
    expect(store.getBridge()).toBe(bridge);
    expect(store.vaultStatus()).toBe('connected');

    store.setBridge(null);
    expect(store.getBridge()).toBeNull();
    expect(store.vaultStatus()).toBe('offline');
  });

  it('stamps once, persists, mirrors to the vault and reloads', async () => {
    const store = await freshStore();
    const st = fakeStorage();
    stubStorage(st);
    stubLocation('');
    const bridge = fakeBridge();
    store.setBridge(bridge);
    const reload = vi.fn();

    const applied = await store.applyConfig(normalizeConfig({ name: 'Studio' }), { reload });

    expect(st._map.has('sgn.cfg')).toBe(true);
    expect(bridge.sent).toHaveLength(1);
    expect(store.vaultStatus()).toBe('synced');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(applied.name).toBe('Studio');
  });

  it('bumps the stamp exactly once per apply', async () => {
    const store = await freshStore();
    const st = fakeStorage();
    stubStorage(st);
    stubLocation('');
    const bridge = fakeBridge();
    store.setBridge(bridge);

    // Every reading of the clock lands in a different second, so a second stamp
    // taken anywhere inside one apply would leave storage and the vault
    // disagreeing about when this config was made. They must not.
    let clock = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1000));

    const caller = normalizeConfig({ t: 1 });
    const applied = await store.applyConfig(caller, { reload: vi.fn() });

    const stored = await decodeConfig(st._map.get('sgn.cfg'));
    const mirrored = await decodeConfig(bridge.sent[0]);
    expect(stored.t).toBe(applied.t);
    expect(mirrored.t).toBe(applied.t);
    expect(applied.t).toBeGreaterThan(1);
    // ...and the caller's own object is left alone, so the stamp cannot be
    // half-applied to a config someone still holds a reference to.
    expect(caller.t).toBe(1);

    const again = await store.applyConfig(caller, { reload: vi.fn() });
    expect(again.t).toBeGreaterThan(applied.t);
  });

  it('a vault failure still persists locally, still reloads, and records offline', async () => {
    const store = await freshStore();
    const st = fakeStorage();
    stubStorage(st);
    stubLocation('');
    const bridge = fakeBridge({ fail: true });
    store.setBridge(bridge);
    const reload = vi.fn();

    await store.applyConfig(normalizeConfig({ name: 'Vault down' }), { reload });

    // The vault is the recovery layer, not the store: the config is safe in
    // localStorage and the board still restarts onto it.
    expect(st._map.has('sgn.cfg')).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.vaultStatus()).toBe('offline');
  });

  it('persists and reloads with no bridge at all, leaving the vault unreported', async () => {
    const store = await freshStore();
    const st = fakeStorage();
    stubStorage(st);
    stubLocation('');
    const reload = vi.fn();

    await store.applyConfig(normalizeConfig({}), { reload });

    expect(st._map.has('sgn.cfg')).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.vaultStatus()).toBeNull();
  });

  it('a demo session never persists, and still reloads', async () => {
    const store = await freshStore();
    const st = fakeStorage();
    stubStorage(st);
    stubLocation('?demo=1');
    const bridge = fakeBridge();
    store.setBridge(bridge);
    const reload = vi.fn();

    const applied = await store.applyConfig(normalizeConfig({ name: 'Showroom' }), { reload });

    // Nothing left behind in the browser somebody opened the demo in: not in
    // storage, and not on the device either.
    expect(st._map.has('sgn.cfg')).toBe(false);
    expect(bridge.sent).toHaveLength(0);
    expect(store.vaultStatus()).toBe('connected'); // no mirror attempted, nothing to report
    // The reload is still the point: it is how the demo returns to its fixtures.
    expect(reload).toHaveBeenCalledTimes(1);
    expect(applied.name).toBe('Showroom');
  });

  it('lets a save that could not be written through, rather than reloading onto the old config', async () => {
    const store = await freshStore();
    // Both writes throw: the quota retry inside saveConfig is exhausted, so the
    // config genuinely did not land.
    stubStorage({ length: 0, key: () => null, setItem: () => { throw new Error('quota'); } });
    stubLocation('');
    const reload = vi.fn();

    await expect(store.applyConfig(normalizeConfig({}), { reload })).rejects.toThrow();
    expect(reload).not.toHaveBeenCalled();
  });
});
