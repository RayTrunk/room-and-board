/* Boot guard — the last line of defence for a board nobody is watching.
 *
 * WHY THIS IS A CLASSIC SCRIPT, NOT A MODULE: the failure it exists to catch is
 * a broken or stale static import (Cloudflare Pages propagates assets
 * per-asset, so a fresh main.js can briefly load against a stale util.js and
 * throw "does not provide an export named ..."). That kills the WHOLE module
 * graph before a single line of main.js runs, so any guard living inside that
 * graph can never fire. This file is loaded with a plain <script> ahead of the
 * module in index.html, giving it its own independent lifetime.
 *
 * It is deliberately written in ES5 with no imports, no optional chaining and
 * no template literals: if the guard itself failed to parse we would lose the
 * only net there is. It must also never throw — every storage access is
 * wrapped, because a kiosk can block localStorage entirely.
 *
 * Contract: main.js sets window.__signageLoaded = true as its final top-level
 * statement, i.e. after every import resolved AND all synchronous setup ran.
 * An async boot() failure after that point is NOT this guard's job — main.js
 * has its own boot().catch reload — so the flag is the honest signal for
 * "the page's code is alive".
 *
 * Recovery is bounded: a reload fixes the mid-propagation case, but an
 * unconditional reload loop would hammer a board (and the worker) forever on a
 * genuinely broken deploy. So it retries a few times with growing backoff and
 * then stops, leaving a visible message instead of a black screen.
 */
(function () {
  'use strict';

  var READY_MS = 10000;             // generous: main.js sets the flag in ms
  var SETTLE_MS = 1200;             // after an error event, let a burst settle
  var LOADING_RECHECK_MS = 5000;    // still downloading — look again shortly
  var MAX_DEFERRALS = 6;            // ...but never wait forever (see check())
  var KEY = 'sgn.bootfail';
  var MAX_TRIES = 3;
  var BACKOFF_MS = [3000, 10000, 30000];

  var lastError = '';
  var timer = null;
  var armed = true;
  var deferrals = 0;

  function loaded() {
    return window.__signageLoaded === true;
  }

  function readState() {
    try {
      return JSON.parse(window.localStorage.getItem(KEY)) || null;
    } catch (e) {
      return null;
    }
  }
  function writeState(s) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(s));
    } catch (e) {
      /* storage blocked: retries simply stop persisting across reloads */
    }
  }
  function clearState() {
    try {
      window.localStorage.removeItem(KEY);
    } catch (e) {
      /* ignore */
    }
  }

  // Module instantiation/evaluation errors are reported to the global scope, so
  // they surface here — that lets us act in ~1s instead of waiting out READY_MS.
  // Ignored once the page is alive, so an unrelated later runtime error can
  // never trigger a reload.
  function onError(e) {
    if (!armed || loaded()) return;
    var msg = '';
    if (e) msg = e.message || (e.reason && e.reason.message) || e.reason || '';
    lastError = String(msg || 'unknown error').slice(0, 300);
    if (timer) clearTimeout(timer);
    timer = setTimeout(check, SETTLE_MS);
  }

  function disarm() {
    armed = false;
    if (timer) clearTimeout(timer);
    timer = null;
    window.removeEventListener('error', onError, true);
    window.removeEventListener('unhandledrejection', onError);
  }

  // Minimal, dependency-free notice. Inline styles because the CSP allows
  // 'unsafe-inline' for styles but not scripts, and because main.css may itself
  // be the asset that failed to load.
  function show(tries, fatal) {
    var el = document.getElementById('bootguard');
    if (!el) {
      el = document.createElement('div');
      el.id = 'bootguard';
      el.setAttribute('style', [
        'position:fixed', 'inset:0', 'z-index:2147483647',
        'background:#000', 'color:rgba(255,255,255,.95)',
        'display:flex', 'flex-direction:column',
        'align-items:center', 'justify-content:center', 'gap:16px',
        'font-family:CiscoSansTT,-apple-system,Segoe UI,Roboto,sans-serif',
        'text-align:center', 'padding:48px',
      ].join(';'));
      (document.body || document.documentElement).appendChild(el);
    }
    var headline = fatal ? 'Display needs attention' : 'Reloading the display…';
    var detail = fatal
      ? 'The dashboard could not start after several attempts.'
      : 'A file did not load correctly. Trying again.';
    var h = document.createElement('div');
    h.setAttribute('style', 'font-size:40px;font-weight:600');
    h.textContent = headline;
    var p = document.createElement('div');
    p.setAttribute('style', 'font-size:22px;color:rgba(255,255,255,.56);max-width:40ch');
    p.textContent = detail;
    var s = document.createElement('div');
    s.setAttribute('style', 'font-size:15px;color:rgba(255,255,255,.56);font-family:ui-monospace,monospace;max-width:80ch;word-break:break-word');
    s.textContent = 'attempt ' + tries + (lastError ? ' · ' + lastError : '');
    el.textContent = '';
    el.appendChild(h);
    el.appendChild(p);
    el.appendChild(s);
  }

  function check() {
    timer = null;
    if (loaded()) {
      // Healthy boot: drop the retry counter so a future failure gets a full
      // budget again, and stop listening.
      clearState();
      disarm();
      return;
    }
    // Don't mistake SLOW for BROKEN. On a cold cache over a poor connection the
    // module graph (~40 files) can still be downloading well past READY_MS, and
    // reloading a merely-slow board just restarts the download — a loop that
    // never converges. Module scripts are deferred, so once readyState is
    // 'complete' they have either run or failed, and the verdict is safe.
    // Bounded, because a hung subresource (image, video) can keep a document
    // 'loading' indefinitely and must not disable the guard entirely.
    if (document.readyState !== 'complete' && deferrals < MAX_DEFERRALS) {
      deferrals += 1;
      timer = setTimeout(check, LOADING_RECHECK_MS);
      return;
    }
    var prev = readState();
    var tries = ((prev && prev.n) || 0) + 1;
    writeState({ n: tries, at: Date.now(), err: lastError });
    var fatal = tries > MAX_TRIES;
    show(tries, fatal);
    if (fatal) {
      disarm();
      return; // stop: a human needs to look, and a reload storm helps nobody
    }
    var wait = BACKOFF_MS[tries - 1] || BACKOFF_MS[BACKOFF_MS.length - 1];
    setTimeout(function () { guard.reload(); }, wait);
  }

  window.addEventListener('error', onError, true);
  window.addEventListener('unhandledrejection', onError);
  // Deferred module scripts have executed (or failed) by the time `load` fires,
  // so that is the earliest point a verdict is trustworthy. The timeout is only
  // the backstop for a document that never gets there.
  window.addEventListener('load', function () {
    if (!armed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(check, 500);
  });
  timer = setTimeout(check, READY_MS);

  // Exposed for tests (and for a console poke on a real board). `reload` is a
  // property so a test can observe the decision without navigating.
  var guard = {
    check: check,
    disarm: disarm,
    reload: function () { window.location.reload(); },
    state: readState,
  };
  window.__signageBootGuard = guard;
})();
