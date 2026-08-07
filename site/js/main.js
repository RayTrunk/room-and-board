// Boot and runtime orchestration for the signage dashboard.

import { normalizeConfig, decodeConfig, CURATED_SOURCES, imageFit } from './config.js';
import { loadConfig, saveConfig, loadCache, saveCache, takePendingEdit } from './store.js';
import { fetchJSON, fetchBuffer, fetchText } from './net.js';
import { fmtClock, fitViewport } from './util.js';
import { blockZoomGestures } from './zoomguard.js';
import { schedule } from './scheduler.js';
import { resolveMode, ambientSource } from './modes.js';
import { registerWidget, getWidget } from './registry.js';
import { chooseBootConfig } from './boot.js';
import { parseFragment } from './bridge.js';
import { stripData, stripHtml } from './ambient.js';
import { createSlideshow, swipeAction, swipeFadeThrough, loadImage } from './imageshow.js';
import { startBeacon, reportWidgetHealth } from './fleet.js';
import { initTextViewer } from './textviewer.js';
import { initExpand } from './expand.js';
import { startClockFace, CLOCK_SOURCES } from './clockfaces.js';
import { icon } from './icons.js';
import { ensureOceanProbe } from './surf-gate.js';

import * as clock from './widgets/clock.js';
import * as weather from './widgets/weather.js';
import * as subway from './widgets/subway.js';
import * as lirr from './widgets/lirr.js';
import * as mnr from './widgets/mnr.js';
import * as bus from './widgets/bus.js';
import * as njt from './widgets/njt.js';
import * as amtrak from './widgets/amtrak.js';
import * as pathw from './widgets/path.js';
import * as ferry from './widgets/ferry.js';
import * as art from './widgets/art.js';
import * as history from './widgets/history.js';
import * as aqi from './widgets/aqi.js';
import * as surf from './widgets/surf.js';
import * as quote from './widgets/quote.js';
import * as wotd from './widgets/wotd.js';
import * as markets from './widgets/markets.js';
import * as marketsnews from './widgets/marketsnews.js';
import * as worldclock from './widgets/worldclock.js';
import * as sports from './widgets/sports.js';
import * as sportsnews from './widgets/sportsnews.js';
import * as f1 from './widgets/f1.js';
import * as golf from './widgets/golf.js';
import * as tennis from './widgets/tennis.js';
import * as iptv from './widgets/iptv.js';
import * as news from './widgets/news.js';
import * as substack from './widgets/substack.js';
import * as bsky from './widgets/bsky.js';
import * as photos from './widgets/photos.js';
import * as gdrivephotos from './widgets/gdrivephotos.js';
import * as landscapes from './widgets/landscapes.js';
import * as services from './widgets/services.js';
import * as apod from './widgets/apod.js';
import * as chart from './widgets/chart.js';
import * as citibike from './widgets/citibike.js';
import * as tfl from './widgets/tfl.js';
import { resolvePhotosManifest } from './photos-manifest.js';
import { fetchCuratedManifest, fetchBackdropList, backdropDayIndex, localDayNumber } from './curated.js';

const MODULES = [weather, subway, lirr, mnr, njt, amtrak, pathw, ferry, bus, art, history, aqi, surf, quote, wotd, markets, marketsnews, worldclock, sports, sportsnews, news, substack, bsky, photos, gdrivephotos, landscapes, services, apod, chart, citibike, tfl, f1, golf, tennis, iptv];
for (const m of MODULES) registerWidget(m);

const net = { fetchJSON, fetchBuffer, fetchText };
const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const DEMO = params.get('demo') === '1';

// The demo fixtures are a 33 KB module (the 3rd-largest thing in the boot
// graph) that only ?demo=1 ever reads. A static import shipped and parsed them
// on every production board, so they load on demand instead — once per session,
// awaited before any demo path renders, after which `fixtures` reads
// synchronously. No top-level await: boot semantics are unchanged.
let fixtures = null;
let fixturesPromise = null;
const loadFixtures = () =>
  (fixturesPromise ??= import('../demo/fixtures.js').then((m) => (fixtures = m)));

// Scale the fixed 1920x1080 layout down onto smaller RoomOS panels (Cisco Room
// Navigator). No-op on the Board Pro. See fitViewport in util.js for why.
fitViewport();
window.addEventListener('resize', () => fitViewport());

// …and having sized the page for the device, refuse to let anyone resize it by
// hand. An accidental pinch on a board zoomed the dashboard to ~200% and the
// zoom survived the reload that Save does, so the board sat unusable until
// someone undid it by hand. The touch gesture is refused in main.css
// (`touch-action` on the root); this covers the pointer paths, which CSS has no
// say over. See zoomguard.js for the full account.
blockZoomGestures(window);

let cfg = null;
// Liveness heartbeat for the watchdog: bumped on every clock tick, NOT on
// widget freshness. A board showing only stale data (upstream outage) or only
// daily-refresh widgets is still alive — the clock proves the page isn't
// wedged, so it must not trigger a reload loop.
let lastRender = Date.now();
let slideshow = null;
let clockface = null; // minute-tick clock screensaver engine (clockfaces.js)
let slideshowStarting = false; // guards the await gap in startSlideshow
let backdropGen = 0; // guards the await gap in applyBackdrop (mode can flip mid-fetch)
let backdropList = []; // full curated backdrop set, for swipe-to-next
let backdropIndex = 0; // which backdrop is showing (starts at the daily pick)
let backdropDay = 0; // local day the index was computed for (rollover detection)
const cancels = [];

function cardFor(mod, rect) {
  let card = document.querySelector(`[data-widget="${mod.meta.id}"]`);
  if (!card) {
    card = document.createElement('article');
    card.className = `card card--${mod.meta.id}`;
    card.setAttribute('data-widget', mod.meta.id);
    card.innerHTML = `
      <h2 class="card__title">${mod.meta.title}</h2>
      <div class="card__body"></div>
      <div class="card__stamp" hidden></div>`;
    // Unconfigured cards tap straight into their Settings section — the
    // prompt names the destination; the tap saves the trip. Card-level and
    // inert unless a data-setup prompt is currently showing.
    card.addEventListener('click', async () => {
      // Retired-card prompt: straight into edit mode to swap the widget.
      if (card.querySelector('[data-edit]')) { $('#edit').click(); return; }
      const prompt = card.querySelector('[data-setup]');
      if (!prompt) return;
      const settings = await import('./settings/settings.js');
      settings.openSettings(cfg ?? normalizeConfig({}), { focus: prompt.dataset.setup });
    });
    $('#grid').appendChild(card);
  }
  if (rect) {
    card.style.gridColumn = `${rect.x + 1} / span ${rect.w}`;
    card.style.gridRow = `${rect.y + 1} / span ${rect.h}`;
    // Size hooks for per-size compact styling (container queries need a newer
    // Chromium than gen1 boards have). Tier classes: t-s/t-m/t-l by height,
    // t-narrow when 4 or fewer columns wide.
    card.dataset.w = rect.w;
    card.dataset.h = rect.h;
    card.classList.remove('t-s', 't-m', 't-l', 't-narrow');
    card.classList.add(`t-${rect.h <= 2 ? 's' : rect.h <= 4 ? 'm' : 'l'}`);
    if (rect.w <= 4) card.classList.add('t-narrow');
  }
  return card;
}

function stampOf(card) {
  return card.querySelector('.card__stamp');
}

function markFresh(card) {
  card.classList.remove('is-stale');
  stampOf(card).hidden = true;
}

function markStale(card, cachedAtSec) {
  card.classList.add('is-stale');
  const stamp = stampOf(card);
  if (cachedAtSec) {
    // Freshness stamp is a clock reading, so it follows cfg.clock24 (unlike
    // the transit schedule times in the card body).
    stamp.textContent = `as of ${fmtClock(cachedAtSec, cfg?.clock24)}`;
    stamp.hidden = false;
  }
}

function renderWidget(mod, vm, rect) {
  const card = cardFor(mod, rect);
  try {
    mod.render(card.querySelector('.card__body'), vm, cfg);
  } catch (err) {
    console.error(`[signage] render failed: ${mod.meta.id}`, err);
  }
}

// Boot fetch herd: every card used to open its first connection in the same
// tick — ~20 requests across ~7 hosts at once on gen1's embedded stack, which
// queues them anyway and delays the cards at the back of the line. Each widget
// gets its own small slot instead. Cached content still paints immediately
// (below, before the schedule), and the last card's first fetch starts well
// inside 2 s, so the board is populated as fast as it ever was.
const BOOT_STAGGER_STEP_MS = 120;
const BOOT_STAGGER_MAX_MS = 1800;

function startWidget(mod, rect, startDelayMs = 0) {
  const card = cardFor(mod, rect);
  const cached = loadCache(mod.meta.id);
  if (cached) {
    renderWidget(mod, cached.data);
    markStale(card, cached.t);
  }
  const cancel = schedule(async () => {
    try {
      const vm = await mod.fetchData(cfg, net);
      saveCache(mod.meta.id, vm);
      renderWidget(mod, vm);
      // A worker-served stale fallback (up to 24h old) must not read as fresh:
      // dim the card and stamp its age instead of clearing the stale mark.
      if (vm?.stale) markStale(card, vm.updatedAt);
      else markFresh(card);
      // Health vector (fleet.js): worker-served stale counts, fresh clears.
      reportWidgetHealth(mod.meta.id, vm?.stale ? 'stale' : null);
    } catch (err) {
      reportWidgetHealth(mod.meta.id, 'error');
      markStale(card, loadCache(mod.meta.id)?.t);
      throw err; // let the scheduler back off
    }
  }, mod.meta.refreshMs, { startDelayMs });
  cancels.push(cancel);
}

function renderStrip() {
  // The strip only shows in ambient mode; skip the cache reads + DOM rebuild
  // on the 30 s schedule while the dashboard grid is up.
  if (!DEMO && !document.body.classList.contains('mode-ambient')) return;
  if (cfg?.screensaver?.strip === false) return; // Screensaver page turned the band off
  const caches = {};
  for (const id of ['weather', 'lirr', 'mnr', 'njt']) caches[id] = loadCache(id)?.data;
  const data = DEMO && fixtures
    ? stripData(
        {
          weather: fixtures.DEMO_VMS.weather,
          lirr: fixtures.DEMO_VMS.lirr,
          mnr: fixtures.DEMO_VMS.mnr,
          njt: fixtures.DEMO_VMS.njt,
        },
        cfg,
        // The fixtures are frozen at DEMO_NOW_MS; stripData derives countdowns
        // from absolute times, so it needs the fixtures' own "now" or every demo
        // departure reads as long past and the strip goes quiet.
        { nowSec: Math.floor(fixtures.DEMO_NOW_MS / 1000) },
      )
    : stripData(caches, cfg);
  // The clock-face screensavers already show the time large; drop it from the
  // strip so it isn't printed twice.
  const showTime = !CLOCK_SOURCES.has(ambientSource(cfg));
  $('#strip').innerHTML = stripHtml(data, new Date(), { showTime });
}

async function startSlideshow() {
  // `slideshow` is only assigned after the manifest await, so two near-
  // simultaneous calls (applyMode runs once directly + once from schedule's
  // immediate first tick) would both pass a `slideshow`-only guard and spawn a
  // second, un-stoppable engine. The synchronous in-flight flag closes that gap.
  if (slideshow || slideshowStarting) return;
  slideshowStarting = true;
  try {
    const src = ambientSource(cfg);
    let manifest;
    if (DEMO) manifest = [(await loadFixtures()).DEMO_VMS.art];
    else if (src === 'photos') manifest = await resolvePhotosManifest(cfg, net, photos);
    else if (src === 'gdrivephotos') manifest = await resolvePhotosManifest(cfg, net, gdrivephotos);
    else if (CURATED_SOURCES[src]) manifest = await fetchCuratedManifest(src, net);
    else manifest = art.filterByCats(await fetchJSON('data/art-manifest.json'), cfg.art?.cats);
    if (!manifest.length) return; // don't lock an empty slideshow; retry next applyMode
    // Each ambient source owns its interval: the chosen photo widget's every for
    // its slideshow, the curated source's user rotation (its own default), art's
    // every for art (art's setting used to leak into photos).
    const everyMin = (src === 'photos' ? cfg.photos?.every
      : src === 'gdrivephotos' ? cfg.gdrivephotos?.every
      : CURATED_SOURCES[src] ? (cfg[src]?.every ?? CURATED_SOURCES[src].every)
      : cfg.art?.every) ?? 30;
    // Curated photo sources (Landscapes) fill the screen; art/personal photos
    // letterbox to never crop the canvas. Same rule the tapped-open viewer asks.
    const fit = imageFit(src);
    slideshow = createSlideshow(manifest, $('#slideshow'), { intervalMs: everyMin * 60 * 1000, fit });
    slideshow.start();
  } catch (err) { console.error('[signage] slideshow unavailable', err); }
  finally { slideshowStarting = false; }
}

// CSS url() escaping for externally-sourced image URLs: quotes and backslashes
// would otherwise terminate the url string (style-injection surface).
const cssUrl = (u) => `url("${String(u).replaceAll('\\', '%5C').replaceAll('"', '%22')}")`;

// Paints the current backdrop image into #backdrop.
function showBackdrop() {
  const el = $('#backdrop');
  el.style.backgroundImage = cssUrl(backdropList[backdropIndex].img);
  el.hidden = false;
}

// Swipe ahead of schedule: step to the next/prev backdrop. No-ops unless a clock
// backdrop is currently showing, so it's safe to wire to the whole ambient area.
// Preload before swapping (the slideshow's step() pattern) so the swipe never
// flashes the fallback background while the next image streams in.
function stepBackdrop(dir) {
  if (backdropList.length < 2 || $('#backdrop').hidden) return;
  backdropIndex = (backdropIndex + dir + backdropList.length) % backdropList.length;
  // Fade-to-dark, swap, fade back — the initial-load grammar on every device
  // (see swipeFadeThrough). The fade-out starts NOW as the acknowledgment;
  // the decode (loadImage: decode-gated, never rejects) rides the dark beat.
  swipeFadeThrough($('#backdrop'), loadImage(new Image(), backdropList[backdropIndex].img), showBackdrop);
}

// Shows/hides the daily photo behind a clock face. Async (folder fetch), so a
// generation guard drops a stale result if the mode flips mid-fetch. Loads the
// full set (for swipe-to-next) and opens on the day's deterministic pick. body's
// .ss-backdrop class drives the clock's legibility treatment (text-shadow +
// dial discs); a failed/empty fetch falls back to the plain dark background.
async function applyBackdrop(on) {
  const el = $('#backdrop');
  const gen = ++backdropGen;
  if (!on) { el.hidden = true; el.style.backgroundImage = ''; document.body.classList.remove('ss-backdrop'); backdropList = []; return; }
  if (backdropList.length) {
    // Already loaded; keep the shown image — EXCEPT across local midnight.
    // Screensaver stretches span midnight (scheduled boards are ambient all
    // night), so the daily rotation must advance here, not only on a reload.
    // A new day also supersedes yesterday's manual swipe.
    const day = localDayNumber(new Date());
    if (day !== backdropDay) {
      backdropDay = day;
      backdropIndex = backdropDayIndex(new Date(), backdropList.length);
    }
    document.body.classList.add('ss-backdrop');
    showBackdrop();
    return;
  }
  try {
    const list = await fetchBackdropList(net);
    if (gen !== backdropGen) return; // mode changed while fetching — abandon
    if (!list.length) { el.hidden = true; document.body.classList.remove('ss-backdrop'); return; }
    backdropList = list;
    backdropDay = localDayNumber(new Date());
    backdropIndex = backdropDayIndex(new Date(), list.length);
    document.body.classList.add('ss-backdrop');
    showBackdrop();
  } catch (err) {
    if (gen !== backdropGen) return;
    console.error('[signage] backdrop unavailable', err);
    el.hidden = true;
    document.body.classList.remove('ss-backdrop');
  }
}

function applyMode() {
  const forced = params.get('mode');
  const mode = forced === 'ambient' || forced === 'dashboard' ? forced : resolveMode(cfg, new Date());
  const src = ambientSource(cfg);
  const ambient = mode === 'ambient' && src !== null;
  document.body.classList.toggle('mode-ambient', ambient);
  // Clock faces reserve extra bottom space when the info strip is showing, so a
  // wrapped (two-row) world-clock grid centers above the strip instead of
  // colliding with it.
  document.body.classList.toggle('has-strip', ambient && cfg.screensaver?.strip !== false);
  $('#ambient').hidden = !ambient;
  $('#grid').hidden = ambient;
  if (ambient) {
    const isClock = CLOCK_SOURCES.has(src);
    $('#slideshow').hidden = isClock;
    $('#clockface').hidden = !isClock;
    $('#strip').hidden = cfg.screensaver?.strip === false;
    if (isClock) {
      if (slideshow) { slideshow.stop(); slideshow = null; }
      clockface ??= startClockFace($('#clockface'), src, cfg);
      applyBackdrop(cfg.screensaver?.backdrop === true);
    } else {
      if (clockface) { clockface.stop(); clockface = null; }
      applyBackdrop(false); // photo slideshows own the full screen themselves
      startSlideshow();
    }
    renderStrip();
  } else {
    if (slideshow) { slideshow.stop(); slideshow = null; }
    if (clockface) { clockface.stop(); clockface = null; }
    applyBackdrop(false);
  }
}

function startClock() {
  const tick = () => {
    clock.render($('#topbar'), null, cfg);
    lastRender = Date.now(); // heartbeat: the clock ticking proves the page is alive
  };
  tick();
  cancels.push(schedule(tick, clock.meta.refreshMs, { jitter: 0 }));
}

function showWelcome() {
  const welcome = $('#welcome');
  welcome.hidden = false;
  $('#grid').hidden = true;
  welcome.innerHTML = `
    <div class="welcome__inner">
      <div class="welcome__brand" aria-hidden="true">
        <svg class="welcome__mark" viewBox="0 0 64 64" width="72" height="72">
          <rect x="1.5" y="1.5" width="61" height="61" rx="9" fill="#0d1218" stroke="rgba(255,255,255,.14)" stroke-width="1.5"/>
          <g opacity=".15" stroke="#fff" stroke-width="2">
            <line x1="21.75" y1="2" x2="21.75" y2="62"/>
            <line x1="42.25" y1="2" x2="42.25" y2="62"/>
            <line x1="2" y1="21.75" x2="62" y2="21.75"/>
            <line x1="2" y1="42.25" x2="62" y2="42.25"/>
          </g>
          <rect x="5.25" y="5.25" width="33" height="12.5" rx="3.5" fill="#64b4fa"/>
          <rect x="46.25" y="25.75" width="12.5" height="12.5" rx="3.5" fill="rgba(100,180,250,.38)"/>
          <rect x="25.75" y="46.25" width="12.5" height="12.5" rx="3.5" fill="rgba(100,180,250,.20)"/>
        </svg>
        <span class="qmark welcome__word"><span class="qmark__lt">Quad</span>rill<span class="qmark__e"><b>é</b><i hidden>e</i></span></span>
      </div>
      <h1>Welcome to your office display</h1>
      <p>Set it up from your phone or desktop, or start with sensible defaults and fine-tune later.</p>
      <div class="qr welcome__qr"></div>
      <p class="welcome__hint">Scan to build a setup code on your phone, or visit <b>${location.host}/setup</b>.</p>
      <div class="welcome__actions">
        <button class="btn btn--primary" data-action="enter-code">I have a setup code</button>
        <button class="btn" data-action="quick-start">Quick start</button>
      </div>
    </div>`;
  // The board's URL isn't visible to the person standing in front of it, so a
  // /setup hint alone can't get them there — the QR carries the full address.
  // Best-effort: if the QR module fails to load, the text hint still names the host.
  import('./vendor/qrcode.js')
    .then(({ default: qrcode }) => {
      const qr = qrcode(0, 'M');
      qr.addData(`https://${location.host}/setup`);
      qr.make();
      welcome.querySelector('.welcome__qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 3 });
    })
    .catch(() => {});
  welcome.querySelector('[data-action="quick-start"]').addEventListener('click', async () => {
    const { QUICKSTART_CONFIG } = await import('./quickstart.js');
    cfg = normalizeConfig({ ...QUICKSTART_CONFIG, t: Math.floor(Date.now() / 1000) });
    // Best-effort: a storage-blocked kiosk must still start (config is held in
    // memory); a failed persist means it re-quick-starts next boot, not a stall.
    try { await saveConfig(cfg); } catch (e) { console.error('[boot] quick-start save failed', e); }
    welcome.hidden = true;
    $('#grid').hidden = false;
    startRuntime();
  });
  welcome.querySelector('[data-action="enter-code"]').addEventListener('click', async () => {
    const settings = await import('./settings/settings.js');
    settings.openSettings(cfg ?? normalizeConfig({}), { focus: 'code' });
  });
}

function startSelfHealing() {
  // Reload nightly at ~4 AM to pick up deploys and clear any memory creep.
  const now = new Date();
  const next4 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 4, 0, 0);
  if (next4 <= now) next4.setDate(next4.getDate() + 1);
  setTimeout(() => location.reload(), next4 - now);

  // Hourly version check → reload when the site is redeployed.
  let bootVersion = null;
  cancels.push(
    schedule(async () => {
      const v = await fetchJSON(`version.json?bust=${Date.now()}`);
      // Publish it rather than fetching version.json a third time: the colophon
      // of Settings' What's new pane states the running version, and this poll's
      // first run is a setTimeout(0), so it is populated within a tick of boot —
      // long before anyone reaches for the gear.
      if (window.__signage) window.__signage.version = v.version;
      if (bootVersion === null) bootVersion = v.version;
      else if (v.version !== bootVersion) location.reload();
    }, 60 * 60 * 1000),
  );

  // Watchdog: if nothing has rendered fresh data for 15 minutes while the
  // browser thinks it is online, reload the page.
  setInterval(() => {
    if (navigator.onLine !== false && Date.now() - lastRender > 15 * 60 * 1000) {
      location.reload();
    }
  }, 60 * 1000);
}

function startRuntime() {
  startClock();
  let slot = 0;
  for (const rect of cfg.layout) {
    const mod = getWidget(rect.id);
    if (mod) startWidget(mod, rect, Math.min(slot++ * BOOT_STAGGER_STEP_MS, BOOT_STAGGER_MAX_MS));
  }
  applyMode();
  cancels.push(schedule(applyMode, 60 * 1000, { jitter: 0 }));
  cancels.push(schedule(renderStrip, 30 * 1000, { jitter: 0 }));
  if (!DEMO) {
    startSelfHealing();
    cancels.push(startBeacon(() => cfg));
    // Ocean gate: keep the Surf card's add-picker verdict current for THIS
    // board's location, so the edit tray and the Settings widget list (both
    // opened later, from here) can answer synchronously the moment they render.
    // A board that already has the card placed re-earns the verdict out of the
    // widget's own refresh and needs no separate probe.
    if (!cfg.widgets.includes('surf')) ensureOceanProbe(cfg.loc, net);
  }
  // Settings → Widgets hands off to edit mode. When it had changes to save it
  // took the Save path, which reloads, so the intent arrives through storage
  // rather than a call (store.js takePendingEdit). Clicking the FAB rather than
  // importing edit.js keeps ONE entry path: the handler below owns the live cfg
  // and the save/sync/reload that Done needs.
  if (takePendingEdit()) $('#edit').click();
}

async function boot() {
  $('#gear').innerHTML = icon('settings', 'icon--btn');
  $('#edit').innerHTML = icon('pencil', 'icon--btn');
  initTextViewer($('#grid'));
  // Whole-card tap opens a card's hidden items full screen (markets today).
  // Delegated on the grid, so it survives every widget re-render.
  initExpand($('#grid'));
  const fragment = parseFragment(location.hash);
  // Diagnostics surface — but the bridge passphrase (auth.p) must NOT sit on a
  // global where injected script could read it. Expose only non-secret fields;
  // connectBridge below uses the local `fragment` (with the passphrase) instead.
  window.__signage = {
    fragment: { cfg: fragment.cfg, auth: fragment.auth ? { u: fragment.auth.u, ip: fragment.auth.ip } : null },
    source: null,
  };

  if (DEMO) {
    // Pull the fixtures in before anything below reads them: renderStrip and
    // applyMode both run synchronously off this branch.
    const { DEMO_VMS } = await loadFixtures();
    cfg = normalizeConfig({
      v: 3,
      name: 'User',
      mode: 'dashboard',
      layout: [
        { id: 'weather', x: 0, y: 0, w: 4, h: 4 },
        { id: 'subway', x: 4, y: 0, w: 4, h: 4 },
        { id: 'lirr', x: 8, y: 0, w: 4, h: 4 },
        { id: 'art', x: 0, y: 4, w: 2, h: 4 },
        { id: 'worldclock', x: 2, y: 4, w: 2, h: 4 },
        { id: 'history', x: 4, y: 4, w: 6, h: 2 },
        { id: 'quote', x: 4, y: 6, w: 6, h: 2 },
        { id: 'aqi', x: 10, y: 4, w: 2, h: 4 },
      ],
    });
    startClock();
    for (const rect of cfg.layout) {
      const mod = getWidget(rect.id);
      if (mod) renderWidget(mod, DEMO_VMS[mod.meta.id], rect);
    }
    applyMode();
    return;
  }

  let fragmentCfg = null;
  if (fragment.cfg) {
    try {
      fragmentCfg = await decodeConfig(fragment.cfg);
    } catch {
      fragmentCfg = null;
    }
  }
  const stored = await loadConfig();
  const { cfg: chosen, source } = chooseBootConfig(fragmentCfg, stored);
  window.__signage.source = source;

  if (!chosen) {
    showWelcome();
    return;
  }
  cfg = chosen;
  // Repair wiped storage from a decodable #fragment — but best-effort: on a
  // storage-blocked board this MUST NOT reject boot() (which reload-loops it).
  // The config is already in memory; a persist failure just re-repairs next boot.
  if (source === 'fragment') {
    try { await saveConfig(cfg); } catch (e) { console.error('[boot] config repair-save failed', e); }
  }
  startRuntime();

  // Vault sync runs opportunistically after first paint; settings uses the
  // connection to mirror saves into the macro vault.
  if (fragment.auth) {
    import('./bridge.js').then(async ({ connectBridge }) => {
      try {
        window.__signage.bridge = await connectBridge(fragment.auth);
        window.__signage.vault = 'connected';
      } catch {
        window.__signage.vault = 'offline';
      }
    });
  }
}

// Ambient slideshow swipe: left/right steps the photo/art slideshow using the
// same gesture classifier as the full-screen viewer. Handlers live on the
// static #slideshow host (they survive createSlideshow re-rendering its
// innerHTML) and read the module-level `slideshow`, so every ambient session
// is covered without re-wiring.
{
  const host = $('#slideshow');
  let downX = 0;
  let downY = 0;
  // Match pointerup to the SAME pointer that went down: a palm or 2nd finger on
  // the wall panel fires its own pointerup and would otherwise fabricate a swipe.
  let downId = null;
  host.addEventListener('pointerdown', (e) => {
    downX = e.clientX;
    downY = e.clientY;
    downId = e.pointerId;
  });
  host.addEventListener('pointerup', (e) => {
    if (e.pointerId !== downId) return;
    downId = null;
    const action = swipeAction(e.clientX - downX, e.clientY - downY);
    if (action === 'next' || action === 'prev') slideshow?.step(action === 'next' ? 1 : -1);
  });
}

// Clock-backdrop swipe: over a clock face the photo slideshow is hidden, so a
// parallel handler on the ambient container steps the backdrop ahead of the
// daily schedule. stepBackdrop no-ops unless a backdrop is actually showing, so
// this is inert during photo slideshows (which keep their own handler above).
{
  const host = $('#ambient');
  let downX = 0;
  let downY = 0;
  let downId = null;
  host.addEventListener('pointerdown', (e) => {
    downX = e.clientX;
    downY = e.clientY;
    downId = e.pointerId;
  });
  host.addEventListener('pointerup', (e) => {
    if (e.pointerId !== downId) return;
    downId = null;
    const action = swipeAction(e.clientX - downX, e.clientY - downY);
    if (action === 'next' || action === 'prev') stepBackdrop(action === 'next' ? 1 : -1);
  });
}

$('#gear').addEventListener('click', async () => {
  const settings = await import('./settings/settings.js');
  settings.openSettings(cfg ?? normalizeConfig({}), {});
});

$('#edit').addEventListener('click', async () => {
  if (!cfg) return;
  const { openEditMode } = await import('./edit.js');
  openEditMode(cfg, {
    async onDone(layout) {
      cfg = normalizeConfig({ ...cfg, layout, t: Math.floor(Date.now() / 1000) });
      if (DEMO) return location.reload(); // demo sessions never persist
      await saveConfig(cfg);
      try {
        if (window.__signage?.bridge) {
          const { encodeConfig } = await import('./config.js');
          await window.__signage.bridge.sendConfig(await encodeConfig(cfg));
          window.__signage.vault = 'synced';
        }
      } catch {
        window.__signage.vault = 'offline';
      }
      location.reload();
    },
  });
});

// Signal to bootguard.js (a classic script loaded ahead of this module) that the
// page's code is alive: every import resolved and all synchronous top-level
// setup above ran. This MUST stay the last top-level statement before boot() —
// a broken/stale import or a throw during setup then leaves the flag unset and
// the guard recovers. An async boot() failure past this point is handled by the
// catch below, not by the guard.
window.__signageLoaded = true;

// A boot crash means no runtime and therefore no watchdog — reload is the
// only recovery path on an unattended board.
boot().catch((err) => {
  console.error('[signage] boot failed', err);
  setTimeout(() => location.reload(), 60 * 1000);
});
