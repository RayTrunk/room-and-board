// happy-dom here does not implement window.localStorage, so anything that
// reads it (store.js, surf-gate.js) silently no-ops under test. This installs a
// minimal in-memory one for the suites that need real persistence semantics
// rather than the resilience fakes in store.test.js.

export function installLocalStorage() {
  const map = new Map();
  const fake = {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
  };
  Object.defineProperty(window, 'localStorage', { value: fake, configurable: true, writable: true });
  return fake;
}
