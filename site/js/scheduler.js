// Jittered periodic runner with exponential backoff on failure. Jitter keeps
// a fleet of boards from hitting upstream feeds in lockstep.

// `startDelayMs` offsets only the FIRST run (default 0 = the historic
// setTimeout(0) behaviour). The runtime uses it to deal each widget its own
// boot slot: without it every card on the board opened its first connection in
// the same tick, ~20 sockets across ~7 hosts on gen1's embedded stack. Callers
// pass an explicit number rather than the scheduler rolling a random one, so
// boot order stays deterministic and testable.
export function schedule(fn, intervalMs, { jitter = 0.15, startDelayMs = 0 } = {}) {
  let cancelled = false;
  let timer = null;
  let backoff = 1;

  const jittered = (ms) => {
    if (!jitter) return ms;
    const spread = ms * jitter;
    return Math.round(ms - spread + Math.random() * 2 * spread);
  };

  const run = async () => {
    if (cancelled) return;
    try {
      await fn();
      backoff = 1;
    } catch {
      backoff = Math.min(backoff * 2, 8);
    }
    if (!cancelled) timer = setTimeout(run, jittered(intervalMs * backoff));
  };

  timer = setTimeout(run, Math.max(0, startDelayMs) || 0);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
