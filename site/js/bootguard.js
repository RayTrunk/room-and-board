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
 * Recovery slows down but never stops. A reload fixes the mid-propagation case,
 * and an unconditional reload loop would hammer a board (and the worker) on a
 * genuinely broken deploy, so it retries fast a few times with growing backoff
 * (~45s of budget) and then keeps retrying every 10 minutes, forever, with the
 * notice showing in between. Stopping was worse: Pages propagates per-asset
 * over 2 to 3 minutes, i.e. longer than the fast budget, so a board that gave
 * up mid-window stayed stranded until somebody walked over and power-cycled it,
 * which is the exact outcome this guard exists to prevent. 6 reloads an hour is
 * not a storm.
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
  var SLOW_RETRY_MS = 600000;       // 10 min between eternal retries (6/hour cap)
  var STALE_MS = 1800000;           // 30 min: an older failure is not this boot's

  var lastError = '';
  var timer = null;
  var armed = true;
  var deferrals = 0;
  var pending = false;              // one reload in flight at a time, never a queue
  var reloadTimer = null;

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
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = null;
    pending = false;
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
      ? 'The dashboard could not start after several attempts. It keeps retrying every few minutes on its own.'
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

  // One reload in flight at a time, so repeated error events can never queue a
  // burst of them. In the slow phase the timer re-arms itself after firing:
  // normally the reload navigates and this whole chain dies with the page, but
  // if a panel ever refuses to navigate the board must still get another try.
  function scheduleReload(wait, slow) {
    if (pending) return;
    pending = true;
    var fire = function () {
      reloadTimer = null;
      // The page can still come alive while a retry is waiting (a very slow
      // boot, or a propagation window that closed). Never reload a board that
      // is already showing the dashboard, and never leave the chain running.
      if (loaded()) {
        clearState();
        disarm();
        return;
      }
      guard.reload();
      if (slow) reloadTimer = setTimeout(fire, SLOW_RETRY_MS);
      else pending = false;
    };
    reloadTimer = setTimeout(fire, wait);
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
    // A spent budget from an old failure burst (last night's deploy window) must
    // not send today's first transient straight to the slow phase, so anything
    // older than STALE_MS starts over. A state with no timestamp keeps its count:
    // unknown age is not proof of age.
    if (prev && prev.at && (Date.now() - prev.at) > STALE_MS) prev = null;
    var tries = ((prev && prev.n) || 0) + 1;
    writeState({ n: tries, at: Date.now(), err: lastError });
    var fatal = tries > MAX_TRIES;
    show(tries, fatal);
    // Past the fast budget the guard slows to SLOW_RETRY_MS but never stops: the
    // propagation window that strands a board outlasts the fast retries, and no
    // one is standing next to an unattended display to reboot it. The notice
    // stays up in between, so a human still sees the state.
    var wait = fatal
      ? SLOW_RETRY_MS
      : (BACKOFF_MS[tries - 1] || BACKOFF_MS[BACKOFF_MS.length - 1]);
    guard.phase = fatal ? 'slow' : 'fast';
    guard.wait = wait;
    scheduleReload(wait, fatal);
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
    phase: 'fast',   // 'fast' while the backoff budget lasts, then 'slow' forever
    wait: 0,         // ms the last verdict scheduled before the next reload
  };
  window.__signageBootGuard = guard;
})();
