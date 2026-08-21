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
// reload. It was copied prose in two files and therefore untestable, since half
// of it reached through a global and the other half ended in a real navigation.
// It is one function now, so this is the first time any of it has been pinned.
//
// It used to mirror the config to a macro-side vault over the device bridge as
// well; that back-channel was removed on 2026-08-21, and the coverage with it.
// localStorage was always the primary write, so what is left below is the whole
// operation rather than the surviving half of one.

// A fresh copy of store.js per test, so no module state can carry across.
async function freshStore() {
  vi.resetModules();
  return import('../site/js/store.js');
}

describe('applyConfig: one operation applies a config to the board', () => {
  it('stamps once, persists and reloads', async () => {
    const store = await freshStore();
    const st = fakeStorage();
    stubStorage(st);
    stubLocation('');
    const reload = vi.fn();

    const applied = await store.applyConfig(normalizeConfig({ name: 'Studio' }), { reload });

    expect(st._map.has('sgn.cfg')).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(applied.name).toBe('Studio');
  });

  it('bumps the stamp exactly once per apply', async () => {
    const store = await freshStore();
    const st = fakeStorage();
    stubStorage(st);
    stubLocation('');

    // Every reading of the clock lands in a different second, and the stamp is
    // what boot.js compares to pick the newest config, so the value the caller
    // is handed back must be the value that landed in storage.
    let clock = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1000));

    const caller = normalizeConfig({ t: 1 });
    const applied = await store.applyConfig(caller, { reload: vi.fn() });

    const stored = await decodeConfig(st._map.get('sgn.cfg'));
    expect(stored.t).toBe(applied.t);
    expect(applied.t).toBeGreaterThan(1);
    // ...and the caller's own object is left alone, so the stamp cannot be
    // half-applied to a config someone still holds a reference to.
    expect(caller.t).toBe(1);

    const again = await store.applyConfig(caller, { reload: vi.fn() });
    expect(again.t).toBeGreaterThan(applied.t);
  });

  it('a demo session never persists, and still reloads', async () => {
    const store = await freshStore();
    const st = fakeStorage();
    stubStorage(st);
    stubLocation('?demo=1');
    const reload = vi.fn();

    const applied = await store.applyConfig(normalizeConfig({ name: 'Showroom' }), { reload });

    // Nothing left behind in the browser somebody opened the demo in.
    expect(st._map.has('sgn.cfg')).toBe(false);
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
