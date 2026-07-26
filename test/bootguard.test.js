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

  it('gives up after the retry budget rather than reload-storming, and says so', () => {
    // Simulate the 4th consecutive failed boot (3 already recorded).
    const { reloads, store } = loadGuard();
    store.set('sgn.bootfail', JSON.stringify({ n: 3 }));

    vi.advanceTimersByTime(10_000);
    expect(notice().textContent).toContain('Display needs attention');

    vi.advanceTimersByTime(600_000); // plenty of time for any scheduled reload
    expect(reloads.n).toBe(0); // stopped
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

  it('records the failure so a later session can see it happened', () => {
    const { store } = loadGuard();
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom' }));
    vi.advanceTimersByTime(1200);
    const st = JSON.parse(store.get('sgn.bootfail'));
    expect(st.n).toBe(1);
    expect(st.err).toContain('boom');
  });
});
