/**
 * @vitest-environment happy-dom
 */
// bootguard.js is a CLASSIC script (deliberately — see its header), so it cannot
// be imported. These tests evaluate the real file in a fresh happy-dom global,
// which also means the file's actual parse/exec is exercised rather than a
// reimplementation of its logic.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Cwd-relative, not import.meta.url: under happy-dom import.meta.url is an http
// URL and node:fs rejects it.
const SRC = await readFile(resolve(process.cwd(), 'site/js/bootguard.js'), 'utf8');

// Fresh document + storage per case, then run the guard.
function loadGuard({ storage = true } = {}) {
  // happy-dom shares one `window` across cases, so a guard loaded by an earlier
  // test is still listening and would double-count this one's error events. A
  // real page loads the guard exactly once; disarm the previous instance to
  // match that.
  try { window.__signageBootGuard.disarm(); } catch { /* none yet */ }
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  delete window.__signageLoaded;
  delete window.__signageBootGuard;
  const store = new Map();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage
      ? {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
      }
      : {
        getItem() { throw new Error('blocked'); },
        setItem() { throw new Error('blocked'); },
        removeItem() { throw new Error('blocked'); },
      },
  });
  new Function(SRC).call(window); // eslint-disable-line no-new-func
  const guard = window.__signageBootGuard;
  const reloads = { n: 0 };
  guard.reload = () => { reloads.n += 1; };
  return { guard, reloads, store };
}

const notice = () => document.getElementById('bootguard');

describe('bootguard', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stays silent and clears the retry counter when the page boots', () => {
    const { reloads, store } = loadGuard();
    store.set('sgn.bootfail', JSON.stringify({ n: 2 })); // a prior bad boot
    window.__signageLoaded = true; // main.js reached its final top-level statement

    vi.advanceTimersByTime(60_000);

    expect(reloads.n).toBe(0);
    expect(notice()).toBeNull();
    // Counter reset, so a future failure gets a full retry budget.
    expect(store.get('sgn.bootfail')).toBeUndefined();
    // ...but the count is handed to the hourly beacon on its way out (fleet.js
    // reads window.__bootRetries): removeItem is the only moment that number
    // exists, and "this board needed 2 attempts" is worth a fleet-wide look.
    expect(window.__bootRetries).toBe(2);
  });

  it('reports zero retries for a board that came up first try', () => {
    delete window.__bootRetries;
    loadGuard(); // no persisted state at all
    window.__signageLoaded = true;
    vi.advanceTimersByTime(60_000);
    expect(window.__bootRetries).toBe(0);
  });

  it('reports zero rather than junk when the persisted state is unreadable', () => {
    // A half-written or hand-edited entry must not put a string (or NaN) on
    // window for the beacon to send — "cannot tell" and "first try" are the
    // same non-event.
    for (const bad of ['not json', JSON.stringify({ n: 'lots' }), JSON.stringify({}), JSON.stringify(null)]) {
      delete window.__bootRetries;
      const { store } = loadGuard();
      store.set('sgn.bootfail', bad);
      window.__signageLoaded = true;
      vi.advanceTimersByTime(60_000);
      expect(window.__bootRetries).toBe(0);
    }
  });

  it('reports zero when storage is blocked entirely', () => {
    delete window.__bootRetries;
    loadGuard({ storage: false });
    window.__signageLoaded = true;
    vi.advanceTimersByTime(60_000);
    expect(window.__bootRetries).toBe(0); // never left undefined, never throws
  });

  it('shows a notice and reloads when the module graph never executes', () => {
    const { reloads } = loadGuard();
    // __signageLoaded is never set — the broken-import case.
    vi.advanceTimersByTime(10_000); // READY_MS
    expect(notice()).not.toBeNull();
    expect(notice().textContent).toContain('Reloading the display');
    expect(reloads.n).toBe(0); // not instant: waits out the backoff first

    vi.advanceTimersByTime(3000); // first backoff
    expect(reloads.n).toBe(1);
  });

  it('acts within ~a second of a module error instead of waiting out the full timeout', () => {
    const { reloads } = loadGuard();
    window.dispatchEvent(new ErrorEvent('error', {
      message: "The requested module './util.js' does not provide an export named 'x'",
    }));

    vi.advanceTimersByTime(1200); // SETTLE_MS
    expect(notice()).not.toBeNull();
    // The real error text is surfaced, so a human can see the cause on the panel.
    expect(notice().textContent).toContain('does not provide an export');
    vi.advanceTimersByTime(3000);
    expect(reloads.n).toBe(1);
  });

  it('ignores errors once the page is alive (no reload on an unrelated runtime error)', () => {
    const { reloads } = loadGuard();
    window.__signageLoaded = true;
    window.dispatchEvent(new ErrorEvent('error', { message: 'some later widget blew up' }));

    vi.advanceTimersByTime(60_000);
    expect(reloads.n).toBe(0);
    expect(notice()).toBeNull();
  });

  it('slows down after the retry budget rather than reload-storming, and says so', () => {
    // Simulate the 4th consecutive failed boot (3 already recorded).
    const { guard, reloads, store } = loadGuard();
    store.set('sgn.bootfail', JSON.stringify({ n: 3 }));

    vi.advanceTimersByTime(10_000);
    expect(notice().textContent).toContain('Display needs attention');
    expect(guard.phase).toBe('slow');

    // Anti-storm: nothing in the next ten minutes, i.e. 6 reloads/hour at most.
    vi.advanceTimersByTime(599_999);
    expect(reloads.n).toBe(0);
  });

  it('keeps retrying every 10 minutes forever once the fast budget is spent', () => {
    // The fast retries (~45s total) are shorter than a Pages propagation window
    // (2-3 min), so stopping there stranded a board until someone rebooted it.
    const { reloads, store } = loadGuard();
    store.set('sgn.bootfail', JSON.stringify({ n: 3 }));

    vi.advanceTimersByTime(10_000);
    expect(notice()).not.toBeNull();
    expect(reloads.n).toBe(0);

    vi.advanceTimersByTime(600_000); // SLOW_RETRY_MS
    expect(reloads.n).toBe(1);
    // Eternal, not one-shot: the notice stays up and the next attempt follows.
    expect(notice()).not.toBeNull();
    vi.advanceTimersByTime(600_000);
    expect(reloads.n).toBe(2);
    vi.advanceTimersByTime(1_800_000); // three more windows
    expect(reloads.n).toBe(5);
  });

  it('tells the viewer it keeps retrying, instead of reading as stranded', () => {
    const { store } = loadGuard();
    store.set('sgn.bootfail', JSON.stringify({ n: 3 }));

    vi.advanceTimersByTime(10_000);
    const copy = notice().textContent;
    expect(copy).toContain('Display needs attention'); // headline unchanged
    expect(copy).toMatch(/keeps retrying/i);
    expect(copy).toMatch(/every few minutes/i);
  });

  it('starts the budget over when the recorded failure is older than 30 minutes', () => {
    // A burst from a deploy window days ago must not push today's first
    // transient straight onto the slow path.
    const { guard, reloads, store } = loadGuard();
    store.set('sgn.bootfail', JSON.stringify({ n: 3, at: Date.now() - 31 * 60_000 }));

    vi.advanceTimersByTime(10_000);
    expect(guard.phase).toBe('fast');
    expect(JSON.parse(store.get('sgn.bootfail')).n).toBe(1); // counter restarted
    vi.advanceTimersByTime(3000);                            // first fast backoff
    expect(reloads.n).toBe(1);
  });

  it('still escalates when the recorded failure is recent', () => {
    const { guard, reloads, store } = loadGuard();
    store.set('sgn.bootfail', JSON.stringify({ n: 3, at: Date.now() - 60_000 }));

    vi.advanceTimersByTime(10_000);
    expect(guard.phase).toBe('slow');
    expect(JSON.parse(store.get('sgn.bootfail')).n).toBe(4);
    vi.advanceTimersByTime(599_999);
    expect(reloads.n).toBe(0); // no fast retry, and no storm
  });

  it('escalates the backoff across consecutive failures', () => {
    const first = loadGuard();
    vi.advanceTimersByTime(10_000);
    vi.advanceTimersByTime(2999);
    expect(first.reloads.n).toBe(0); // 3s backoff not yet elapsed
    vi.advanceTimersByTime(1);
    expect(first.reloads.n).toBe(1);

    // Second attempt (counter persisted as 1) waits longer.
    const second = loadGuard();
    second.store.set('sgn.bootfail', JSON.stringify({ n: 1 }));
    vi.advanceTimersByTime(10_000);
    vi.advanceTimersByTime(9999);
    expect(second.reloads.n).toBe(0);
    vi.advanceTimersByTime(1);
    expect(second.reloads.n).toBe(1); // 10s backoff
  });

  it('still recovers when localStorage is blocked (kiosk) instead of throwing', () => {
    const { reloads } = loadGuard({ storage: false });
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
    expect(notice()).not.toBeNull();
    vi.advanceTimersByTime(3000);
    expect(reloads.n).toBe(1); // retries just don't persist across reloads
  });

  it('treats a still-downloading document as slow, not broken (no reload loop on a cold cache)', () => {
    const ro = (v) => Object.defineProperty(document, 'readyState', { configurable: true, value: v });
    ro('loading');
    const { reloads } = loadGuard();
    try {
      vi.advanceTimersByTime(10_000 + 5 * 5000); // READY_MS plus several rechecks
      expect(reloads.n).toBe(0);                 // deferred while still loading
      expect(notice()).toBeNull();
      // ...but the deferral is bounded, so a document that never completes still
      // gets a verdict rather than disabling the guard.
      vi.advanceTimersByTime(30_000);
      expect(notice()).not.toBeNull();
    } finally {
      ro('complete');
    }
  });

  it('drops a pending retry when the page comes alive late', () => {
    // The eternal phase must not reload a board that recovered on its own.
    const { reloads, store } = loadGuard();
    store.set('sgn.bootfail', JSON.stringify({ n: 3, at: Date.now() }));
    vi.advanceTimersByTime(10_000);
    expect(notice()).not.toBeNull();

    window.__signageLoaded = true; // a very slow boot finally finished
    vi.advanceTimersByTime(1_800_000); // three slow windows
    expect(reloads.n).toBe(0);
    expect(store.get('sgn.bootfail')).toBeUndefined(); // counter cleared too
  });

  it('records the failure so a later session can see it happened', () => {
    const { store } = loadGuard();
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom' }));
    vi.advanceTimersByTime(1200);
    const st = JSON.parse(store.get('sgn.bootfail'));
    expect(st.n).toBe(1);
    expect(st.err).toContain('boom');
  });
});
