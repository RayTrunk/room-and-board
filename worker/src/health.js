// Health monitor. Probes the key endpoints and validates the RESPONSE CONTENT —
// not just up/down — so it catches the real failure mode: an upstream that
// returns HTTP 200 with reshaped garbage (e.g. Yahoo changing its JSON), or a
// worker route quietly serving hours-old cache (e.g. NJT after its daily token
// cap is hit). Runs from the worker's scheduled() cron and on-demand via GET
// /health, and posts to ALERT_WEBHOOK on failure.
//
// Checks with `path` are the worker's OWN routes: they run in-process via
// selfFetch (a Worker fetching its own custom domain over the network loops →
// Cloudflare 522). Checks with `url` are external and use plain fetch. A check
// with `canary` runs code instead of probing an endpoint, for the dependency
// that has no route to watch (the CODES KV setup-code service; see codeCanary).
// `maxStaleSec` (own-route checks only): when the worker serves last-good cache
// (`stale: true`) because the upstream refresh keeps failing, tolerate a brief
// blip but FAIL once the data is older than this, that sustained-stale window is
// exactly how the NJT token cap and similar silent degradations show up.
// Self-hosters: change the hosts/paths (or delete the [triggers] block in
// wrangler.toml to turn the cron off).

const STALE_MAX = 3600; // 1h: past this, stale cache means the upstream is really down

export const CHECKS = [
  {
    name: 'site',
    url: 'https://roomboard.app/version.json',
    ok: (j) => typeof j.version === 'string' && j.version.length > 3,
  },
  {
    name: 'markets', // Yahoo (unofficial) — the flakiest dependency
    path: '/markets',
    maxStaleSec: STALE_MAX,
    ok: (j) => Array.isArray(j.indices) && j.indices.length > 0 && Number.isFinite(j.indices[0].price),
  },
  {
    name: 'weather', // Open-Meteo, browser-direct (not proxied) — core dependency
    url: 'https://api.open-meteo.com/v1/forecast?latitude=40.75&longitude=-73.99&hourly=temperature_2m&forecast_days=1',
    ok: (j) => Array.isArray(j.hourly?.temperature_2m) && j.hourly.temperature_2m.length > 0,
  },
  {
    name: 'gdrive', // curated photos + backdrops; also proves GDRIVE_KEY works
    path: '/gdrive/album?folder=1RHow60mcBwzMturimQSbziK3hqCvP2lz',
    maxStaleSec: STALE_MAX,
    ok: (j) => Array.isArray(j.photos) && j.photos.length > 0,
  },
  {
    name: 'amtrak', // Amtraker (unofficial) transit proxy
    path: '/amtrak/departures',
    maxStaleSec: STALE_MAX,
    ok: (j) => typeof j.station === 'string' && Array.isArray(j.departures),
  },
  {
    // The public front door (unsleep.io, a SEPARATE Pages project deployed by
    // its own CI job) exists precisely for the moment nobody would notice it
    // silently broken (cert lapse, custom-domain removal, a build that stopped
    // shipping). changelog.json is the probe because the health framework
    // parses JSON and that file rides every front-door deploy.
    // Probed EXTERNALLY on purpose: DNS + TLS + routing are the failure modes
    // under test, which selfFetch would bypass. A check against ANY of this
    // worker's own custom domains (api.roomboard.app, api.quadrille.io,
    // api.unsleep.app) must NEVER be added here: the worker fetching its OWN
    // custom domain gets a Cloudflare 522 every time, proven live 2026-07-31
    // after one night of false paging, while the domain serves perfectly from
    // outside. (Replaced backup-site 2026-08-07 when rvc.tech was retired;
    // followed the front door to unsleep.io 2026-08-18.)
    name: 'frontdoor',
    url: 'https://unsleep.io/data/changelog.json',
    ok: (j) => Array.isArray(j) && j.length > 0,
  },
  {
    // Microsoft 365 is the status row most likely to rot silently: it is the
    // only one assembled from two feeds, and its previous endpoint went to a
    // permanent 404 without anyone noticing that the row had been reading
    // "Status unavailable" for weeks. An unknown m365 state is exactly that
    // failure, so it is what this check tests — not merely that the route
    // answered. Only m365 is requested, so another provider's outage cannot
    // page for Microsoft. selfFetch hands the route the same env the request
    // handler gets, so on a worker with the optional MS_* tenant secrets set
    // this check exercises the Graph source too — though a broken tenant alone
    // won't page, since the public sources still answer the row.
    name: 'm365',
    path: '/services/status?ids=m365',
    maxStaleSec: STALE_MAX,
    ok: (j) => Array.isArray(j.services)
      && j.services.some((s) => s?.id === 'm365' && s.state !== 'unknown'),
  },
  {
    // ESPN is one upstream behind three cards: My Teams, Golf and Tennis all
    // read from site.api.espn.com, so this single check covers all three — if
    // the team row can be built, the golf and tennis scoreboards are reachable
    // too. It exists because ESPN's edge started 403ing the board's requests
    // and the row sat on yesterday's game for days before a person noticed;
    // the routes were 502ing the whole time and nothing paged. Checks the
    // CONTENT — a row with a real abbreviation — because the shape is what
    // rots: a 200 with a row that lost its team is the failure worth paging
    // for. A fixed, always-in-season team (the Yankees) so an offseason
    // league can never make the check flap.
    name: 'espn',
    path: '/sports/team?lg=mlb&id=nyy',
    maxStaleSec: STALE_MAX,
    ok: (j) => typeof j.row?.abbr === 'string' && j.row.abbr.length > 0,
  },
  {
    name: 'njt', // NJTransit — getStationSchedule is a STATIC daily timetable, so
    // "old" is not "wrong": healthy = the schedule still has a future departure.
    // A prior-day timetable (every train already in the past) is the real
    // failure. No maxStaleSec — staleness is meaningless for static daily data,
    // and NJT's own endpoint is chronically flaky (recovers only at its midnight
    // reset), so paging on age would just be nightly noise. See the redesign
    // plan in docs/superpowers/plans for fetch-once-per-day.
    path: '/njt/departures',
    ok: (j) => typeof j.station === 'string' && Array.isArray(j.trains) && j.trains.some((t) => Number(t?.time) > Date.now() / 1000),
  },
  {
    // PATH runs 24/7, so a missing station map is never a quiet hour: it is the
    // RidePATH feed having been reshaped under us. The individual direction
    // arrays DO empty out between trains, so only the skeleton is asserted
    // (every station still carries both ToNY and ToNJ), which is exactly what a
    // reshape takes away. Until this existed the route could serve 24h-old
    // cache while the monitor read green.
    name: 'path',
    path: '/path/realtime',
    maxStaleSec: STALE_MAX,
    ok: (j) => {
      const st = j.stations;
      if (!st || typeof st !== 'object' || Array.isArray(st)) return false;
      const dirs = Object.values(st);
      return dirs.length > 0 && dirs.every((d) => Array.isArray(d?.ToNY) && Array.isArray(d?.ToNJ));
    },
  },
  {
    // Stands in for the whole /alerts/{subway,lirr,mnr} family: one upstream
    // (the camsys feeds), one route, one mapper, so three checks would page
    // three times for a single MTA outage. A day with no active alerts is good
    // news and common, so an empty array passes; what rots is the row shape (an
    // alert that lost its header). maxStaleSec is the real watchdog here: an
    // alerts digest that stopped refreshing is how a resolved delay lingers on
    // a wall for a day.
    name: 'subway',
    path: '/alerts/subway',
    maxStaleSec: STALE_MAX,
    ok: (j) => Array.isArray(j.alerts) && j.alerts.every((a) => typeof a?.header === 'string'),
  },
  {
    // NYC Ferry has genuinely quiet periods (midday, overnight), and an empty
    // board then is correct rather than broken, so the validator asserts shape
    // only; a check that flapped every night would be worse than no check (same
    // reasoning as espn's always-in-season team). maxStaleSec does the real
    // work: a feed that stopped refreshing shows up as sustained staleness.
    name: 'ferry',
    path: '/ferry/departures',
    maxStaleSec: STALE_MAX,
    ok: (j) => Array.isArray(j.trips),
  },
  {
    // The setup-code service is the one dependency with no route worth probing:
    // a broken namespace, an exhausted quota or a KV outage stays invisible
    // until somebody is standing at a board typing a code that will never work.
    // So this check is a canary rather than an HTTP probe, and it appears in
    // EVERY report under the one name in both of its modes (see codeCanary), so
    // alertPlan treats it as a single concept and pages once.
    name: 'code',
    canary: codeCanary,
  },
];

// Can never collide with a real setup code: real keys are `code:` plus six
// characters of CODE_ALPHABET, which drops I, L, O and U, and HEALTH has an L.
const CANARY_KEY = 'code:HEALTH';

// Two modes on purpose, and the split is load-bearing. /health is public and
// unauthenticated (an external uptime pinger may poll it as fast as it likes),
// while KV writes are capped at 1000/day, and spending that cap is not
// hypothetical here: board polling once drained it through the shared CODES
// namespace and broke setup-code minting outright (see postCode in index.js).
// A write canary reachable from a public URL could spend the budget and cause
// the very outage it exists to watch for. Hence:
//   read mode (the default, used by the /health route): one KV get, zero
//     writes. A null answer is the SUCCESS case; it proves the binding exists,
//     the namespace answered, and the read quota is alive, which is everything
//     obtainable without spending a write.
//   write-cycle mode (cron only): the whole user path, mint then redeem,
//     through the real routes. The cron fires 72 times a day and each cycle
//     costs 2 writes (the put plus the single-use delete) and 2 reads, so about
//     144 writes/day against the 1000 cap, leaving ample room for real pairing
//     volume.
async function codeCanary({ env, selfFetch, writeCycle }) {
  if (writeCycle) return codeWriteCycle(selfFetch);
  if (!env?.CODES) return { ok: false, detail: 'CODES binding missing' };
  await env.CODES.get(CANARY_KEY); // null is healthy: the read itself is the test
  return { ok: true, detail: 'ok (read)' };
}

// Mint and redeem through the REAL route handlers (selfFetch, in-process). Each
// failure names the half that broke, because a dead mint and a dead redemption
// send an operator to different places. A 429 is a failure too: the per-IP
// throttle window is 10 s and the cron runs every 20 min, so tripping it means
// something else is already wrong.
async function codeWriteCycle(selfFetch) {
  const cfg = JSON.stringify({ canary: true });
  const mint = await selfFetch('/code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cfg }),
  });
  if (!mint.ok) return { ok: false, detail: `mint HTTP ${mint.status}` };
  const code = (await mint.json())?.code;
  if (typeof code !== 'string' || !code) return { ok: false, detail: 'mint returned no code' };
  const redeem = await selfFetch(`/code/${code}`);
  if (!redeem.ok) return { ok: false, detail: `redeem HTTP ${redeem.status}` };
  if ((await redeem.json())?.cfg !== cfg) return { ok: false, detail: 'cfg mismatch' };
  return { ok: true, detail: 'ok (mint+redeem)' };
}

// Age of a payload in seconds. Every one of our own routes answers through
// cached(), which stamps updatedAt as epoch seconds on the way out, so on a
// `path` check this is never legitimately null (see probe). null when
// absent/unparseable.
function ageSeconds(updatedAt) {
  const n = Number(updatedAt);
  if (!Number.isFinite(n)) return null;
  return Math.floor(Date.now() / 1000) - n;
}

// Rejects with a TimeoutError if p doesn't settle in ms; clears the timer on
// settle so it never dangles (matters for the in-process self checks, which
// have no fetch AbortSignal of their own).
function withTimeout(p, ms) {
  let t;
  const timer = new Promise((_, rej) => {
    t = setTimeout(() => rej(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), ms);
  });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
}

async function probe(check, selfFetch, extFetch, ctx = {}) {
  try {
    // A canary reports {ok, detail} from its own logic rather than from a
    // response body, and inherits the same timeout discipline as the two HTTP
    // kinds: a KV read that never settles must not hang the whole report.
    if (check.canary) return { name: check.name, ...(await withTimeout(check.canary(ctx), 13000)) };
    const res = check.path
      ? await withTimeout(selfFetch(check.path), 13000)
      : await extFetch(check.url, { signal: AbortSignal.timeout(12000), headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) {
      // An optional route the operator chose not to configure (NJT without
      // creds, bus without a key) returns 503 {error:'..._not_configured'} —
      // a choice, not an outage. Skip it rather than page forever.
      if (res.status === 503) {
        const b = await res.text().catch(() => '');
        if (/_not_configured/.test(b)) return { name: check.name, ok: true, detail: 'not configured (skipped)' };
      }
      return { name: check.name, ok: false, detail: `HTTP ${res.status}` };
    }
    const body = await res.text();
    let json;
    try { json = JSON.parse(body); } catch { return { name: check.name, ok: false, detail: 'unparseable response' }; }
    if (!check.ok(json)) return { name: check.name, ok: false, detail: 'unexpected shape/content' };
    const age = ageSeconds(json.updatedAt);
    // A body from one of OUR routes without a readable updatedAt is a broken
    // route, not a shrug. The old code let it pass: age came back null, the
    // staleness test below skipped on null, and the check reported ok. That
    // exempted precisely the feed that had stopped telling the truth about
    // itself from the one test built to catch it. External checks (`url`) are
    // third-party JSON that never agreed to carry a stamp, so they are judged by
    // their own validator alone.
    if (check.path && age === null) {
      return { name: check.name, ok: false, detail: 'no updatedAt (unstamped payload)' };
    }
    // stale=true means the worker served last-good cache because the upstream
    // refresh failed. Tolerate a brief blip; FAIL once it's older than
    // maxStaleSec (the upstream has been down a while and the data is misleading).
    if (json.stale === true) {
      const mins = age === null ? null : Math.round(age / 60);
      if (check.maxStaleSec && age !== null && age > check.maxStaleSec) {
        return { name: check.name, ok: false, detail: `stale ${mins} min old`, stale: true, ageSec: age };
      }
      return { name: check.name, ok: true, detail: mins === null ? 'ok (stale cache)' : `ok (stale ${mins} min)`, stale: true, ageSec: age };
    }
    return { name: check.name, ok: true, detail: 'ok', stale: false };
  } catch (err) {
    const detail = err?.name === 'TimeoutError' ? 'timeout' : String(err?.message ?? err).slice(0, 80);
    return { name: check.name, ok: false, detail };
  }
}

// Runs every check concurrently. selfFetch(path, init?)→Response dispatches the
// worker's own routes in-process; extFetch defaults to global fetch (injectable
// for tests). opts.writeCycle opts the code canary into its full mint-and-redeem
// path: the cron passes it, the public /health route must not (see codeCanary).
export async function runHealthChecks(env, selfFetch, extFetch = fetch, opts = {}) {
  const ctx = { env, selfFetch, writeCycle: opts.writeCycle === true };
  const results = await Promise.all(CHECKS.map((c) => probe(c, selfFetch, extFetch, ctx)));
  return { ok: results.every((r) => r.ok), at: new Date().toISOString(), results };
}

// Decides whether to alert this run, given the set of checks that failed LAST
// run (persisted by the caller). Only a CHANGE pages: a check flipping fail↔ok.
// An ongoing outage stays silent after its first alert, so a stuck dependency
// (e.g. NJT's token cap all afternoon) doesn't page every 20 min. Returns the
// current failing-check names for the caller to persist for next time.
export function alertPlan(report, prevFailing = []) {
  const failing = report.results.filter((r) => !r.ok);
  const names = failing.map((r) => r.name);
  const sameSet = names.length === prevFailing.length && names.every((n) => prevFailing.includes(n));
  if (sameSet) return { changed: false, failing: names, text: null };
  const recovered = prevFailing.filter((n) => !names.includes(n));
  let text;
  if (failing.length) {
    text = `🔴 unsleep health: ${failing.map((r) => `${r.name} (${r.detail})`).join(', ')}`;
    if (recovered.length) text += ` (recovered: ${recovered.join(', ')})`;
  } else {
    text = `✅ unsleep health: all clear (recovered: ${recovered.join(', ')})`;
  }
  return { changed: true, failing: names, text: `${text} — ${report.at}` };
}

// Which failing-set to persist for the next run's comparison. An attempted page
// that was NOT delivered (Slack/ntfy blip) must hold the PREVIOUS set, so the
// next run still sees a change and re-pages — otherwise a transient webhook
// outage silently swallows the only alert (at-least-once). A delivered page (or
// a run with nothing to send) advances to this run's set.
export function nextFailingState(plan, prevFailing, delivered) {
  if (plan.changed && plan.text && !delivered) return prevFailing;
  return plan.failing;
}

// Dead-man's switch: the monitor cannot watch itself, so every completed
// scheduled run pings HEARTBEAT_URL (a healthchecks.io-style check that pages
// when pings STOP arriving). It fires whether or not dependencies are failing:
// the ping proves the cron RAN, dep health is the webhook's job. If the run
// throws before reaching this, no ping goes out and the external check pages —
// which is exactly the point. No-op until the secret is set, so it deploys
// ahead of the account setup. Returns whether a ping was delivered.
export async function heartbeat(env, fetchImpl = fetch) {
  const url = env?.HEARTBEAT_URL;
  if (!url) return false;
  try {
    const res = await fetchImpl(url, { method: 'POST', signal: AbortSignal.timeout(8000) });
    if (!res.ok) console.error('[health] heartbeat non-2xx', res.status);
    return res.ok;
  } catch (err) {
    console.error('[health] heartbeat failed', err);
    return false;
  }
}

// Posts a prebuilt message to ALERT_WEBHOOK. Understands Slack incoming webhooks
// (JSON {text}) and ntfy.sh (plain body) by URL; no-ops with a log if the secret
// isn't set, so the monitor can deploy before the alert channel is wired.
// Returns true when the alert was DELIVERED (2xx) — or when there's no channel
// to deliver to, an unwired config state, not a transient failure worth
// retrying — and false when a wired channel rejected or errored, so the caller
// can hold its state and re-page next run (at-least-once) instead of advancing
// past an alert nobody received.
export async function notify(env, text, fetchImpl = fetch) {
  const url = env?.ALERT_WEBHOOK;
  if (!url) { console.error('[health]', text, '(ALERT_WEBHOOK not set)'); return true; }
  const ntfy = url.includes('ntfy.sh');
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: ntfy ? { Title: 'unsleep health' } : { 'content-type': 'application/json' },
      body: ntfy ? text : JSON.stringify({ text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error('[health] alert POST non-2xx', res.status);
    return res.ok;
  } catch (err) {
    console.error('[health] alert POST failed', err);
    return false;
  }
}
