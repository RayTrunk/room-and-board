// Companion setup page logic: build a config, POST it to the worker's code
// exchange, show the 6-char code. Reads #cfg= to pre-fill (QR round trip).

import { isAddable, normalizeConfig, encodeConfig, decodeConfig, WIDGET_IDS, WIDGET_GROUPS, ART_CATS, DEFAULT_CONFIG, NJT_LINES } from '../config.js';
import { optimizeLayout } from '../layout-optimize.js';
import { WORKER_URL } from '../env.js';
import { toggleIn, searchStations, canAddTicker, foldAt } from './pickers.js';
import { attachReorder, foldHeadHtml, tickerRowsHtml } from './reorder.js';
import { locationSearch } from '../geo.js';
import { fetchJSON } from '../net.js';
import { ensureOceanProbe } from '../surf-gate.js';
import { escapeHtml, parseAlbumToken, parseDriveFolder } from '../util.js';
import { OFFICES, zoneLabel, zonesByRegion } from '../widgets/worldclock.js';
import { symbolKnown, normalizeSymbol } from '../widgets/markets.js';
import { TFL_LINES, TFL_MODES } from '../tfl-lines.js';
import { SUBWAY_LINES } from '../widgets/subway.js';
import { PATH_STATIONS, PATH_DIRS } from '../widgets/path.js';
import { BSKY_API } from '../widgets/posts.js';

const $ = (sel) => document.querySelector(sel);
export const WIDGET_LABELS = {
  weather: 'Weather',
  subway: 'NYC Subway',
  lirr: 'LIRR (Penn Station)',
  mnr: 'Metro-North (GCT)',
  njt: 'NJ Transit',
  amtrak: 'Amtrak (Moynihan)',
  path: 'PATH',
  ferry: 'NYC Ferry',
  bus: 'Express Bus',
  markets: 'Markets',
  marketsnews: 'Markets News',
  art: 'Art slideshow',
  photos: 'iCloud Photos',
  gdrivephotos: 'GDrive Photos',
  landscapes: 'Landscapes',
  services: 'Cloud Services',
  apod: 'NASA Daily Photo',
  chart: 'Chart of the Day',
  citibike: 'Citi Bike',
  tfl: 'TfL Status',
  history: 'This Day in History',
  aqi: 'Air & Sky',
  surf: 'Surf',
  quote: 'Quote of the Day',
  wotd: 'Word of the Day',
  worldclock: 'World Clock',
  sports: 'My Teams (sports)',
  sportsnews: 'Sports News',
  f1: 'Formula 1',
  golf: 'Golf (PGA)',
  tennis: 'Tennis',
  iptv: 'Live Video / YouTube',
  news: 'Headlines',
  substack: 'Substack',
  bsky: 'Bluesky',
  rss: 'RSS Feeds',
  calendar: 'Calendar',
};

// Ordered config sections for the two-step /setup wizard. A section shows in
// step 2 iff any of its trigger widget ids is placed; a category divider shows
// iff its group has ≥1 visible section. Single source of truth for step-2
// visibility — triggers ⊆ WIDGET_IDS, group ∈ WIDGET_GROUPS (settings-logic.test).
export const SETUP_SECTIONS = [
  { id: 'subway-field', group: 'Commute', triggers: ['subway'] },
  { id: 'lirr-field', group: 'Commute', triggers: ['lirr'] },
  { id: 'mnr-field', group: 'Commute', triggers: ['mnr'] },
  { id: 'njt-field', group: 'Commute', triggers: ['njt'] },
  { id: 'amtrak-field', group: 'Commute', triggers: ['amtrak'] },
  { id: 'path-field', group: 'Commute', triggers: ['path'] },
  { id: 'ferry-field', group: 'Commute', triggers: ['ferry'] },
  { id: 'bus-field', group: 'Commute', triggers: ['bus'] },
  { id: 'citibike-field', group: 'Commute', triggers: ['citibike'] },
  { id: 'tfl-field', group: 'Commute', triggers: ['tfl'] },
  // Surf shares the location field: it reads the very same cfg.loc (see
  // effectiveSurfSpot), so a board carrying ONLY Surf must still be asked where it is.
  { id: 'weather-field', group: 'Weather & Air', triggers: ['weather', 'aqi', 'surf'] },
  { id: 'markets-field', group: 'Markets', triggers: ['markets'] },
  { id: 'marketsnews-field', group: 'Markets', triggers: ['marketsnews'] },
  { id: 'sports-field', group: 'Sports', triggers: ['sports'] },
  { id: 'sportsnews-field', group: 'Sports', triggers: ['sportsnews'] },
  { id: 'news-field', group: 'News & Social', triggers: ['news'] },
  { id: 'substack-field', group: 'News & Social', triggers: ['substack'] },
  { id: 'bsky-field', group: 'News & Social', triggers: ['bsky'] },
  { id: 'art-field', group: 'Images', triggers: ['art'] },
  { id: 'photos-field', group: 'Images', triggers: ['photos'] },
  { id: 'gdrivephotos-field', group: 'Images', triggers: ['gdrivephotos'] },
  { id: 'iptv-field', group: 'Images', triggers: ['iptv'] },
  // Landscapes is in the Images group but has nothing to configure, so it has
  // no section here — same as apod. Same in Daily: only Chart of the Day has
  // anything to ask about.
  { id: 'chart-field', group: 'Daily', triggers: ['chart'] },
  { id: 'calendar-field', group: 'Productivity', triggers: ['calendar'] },
  { id: 'wc-field', group: 'Reference', triggers: ['worldclock'] },
  { id: 'services-field', group: 'Reference', triggers: ['services'] },
];

// Widgets whose card CANNOT render without a choice this page is the only
// place to make. The test is not "does the field look important" but "does an
// empty value reach the board": every entry below is a field normalizeConfig
// hands through empty (no default substituted) and whose widget then paints
// `setupPrompt` instead of data. That is the whole quarter-board an unconfigured
// LIRR arrived as, and it is why these block the code rather than warn about it.
//
// Deliberately NOT here, having been checked one by one: subway.lines,
// tfl.lines, citibike.stations, services.list, markets.symbols, news/marketsnews/
// sportsnews.sources, substack.pubs, bsky.handles and worldclock.cities all fall
// back to their defaults in normalizeConfig, so an emptied list never reaches a
// board empty; njt.lines, art.cats and chart.topics treat [] as "all"; path and
// ferry are selects that always hold a value.
//
// `field` is the on-page label the badge sits on, so the guard sentence and the
// thing the user is looking for say the same words. Pure data; exported for tests.
export const REQUIRED_FIELDS = Object.freeze([
  { id: 'lirr', widget: 'LIRR', field: 'Only trains stopping at', filled: (c) => Boolean(c?.lirr?.dest) },
  { id: 'mnr', widget: 'Metro-North', field: 'Only trains stopping at', filled: (c) => Boolean(c?.mnr?.dest) },
  { id: 'amtrak', widget: 'Amtrak', field: 'Only trains stopping at', filled: (c) => Boolean(c?.amtrak?.dest) },
  { id: 'bus', widget: 'Express Bus', field: 'Route and stop', filled: (c) => (c?.bus?.legs?.length ?? 0) > 0 },
  { id: 'sports', widget: 'My Teams', field: 'Teams', filled: (c) => (c?.sports?.teams?.length ?? 0) > 0 },
  // Mirrors normalizeConfig's https-only rule: anything else normalizes to ''
  // on the way out, so anything else is unconfigured here too.
  { id: 'iptv', widget: 'Live Video / YouTube', field: 'YouTube, HLS stream, or camera link', filled: (c) => /^https:\/\/\S+$/i.test(c?.iptv?.url ?? '') },
  { id: 'photos', widget: 'iCloud Photos', field: 'Album link', filled: (c) => Boolean(c?.photos?.album) },
  { id: 'gdrivephotos', widget: 'GDrive Photos', field: 'Folder link', filled: (c) => Boolean(c?.gdrivephotos?.album) },
]);

// The required fields a given pick set still owes. Only PICKED widgets count:
// an unconfigured LIRR nobody asked for is not a problem. Pure; exported.
export function missingRequired(cfgLike, placed) {
  const p = placed instanceof Set ? placed : new Set(placed ?? []);
  return REQUIRED_FIELDS.filter((f) => p.has(f.id) && !f.filled(cfgLike));
}

// Why the output buttons are greyed out, in the user's words: which card, which
// field, and the two ways out (fill it, or drop the card). Pure; exported.
export function requiredNotice(missing) {
  if (!missing?.length) return '';
  const parts = missing.map((f) => `${f.widget} (${f.field})`);
  const list = parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  const tail = missing.length === 1
    ? 'Finish it above, or uncheck that widget in step 1.'
    : 'Finish them above, or uncheck those widgets in step 1.';
  return `Still to fill in: ${list}. ${tail}`;
}

// Which step-2 config sections + category dividers are visible for a set of
// placed widget ids. Pure — drives the DOM apply step in the wizard.
export function stepTwoVisibility(placed) {
  const p = placed instanceof Set ? placed : new Set(placed);
  const sections = new Set();
  const groups = new Set();
  for (const s of SETUP_SECTIONS) {
    if (s.triggers.some((id) => p.has(id))) { sections.add(s.id); groups.add(s.group); }
  }
  return { sections, groups };
}

let cfg = structuredClone(DEFAULT_CONFIG);

// A FRESH visit starts with nothing ticked (Sean, 2026-07-29): the wizard used
// to arrive with DEFAULT_LAYOUT's nine cards pre-checked, which made the picker
// read like a list to prune rather than a list to choose from — and quietly
// shipped whatever was in DEFAULT_LAYOUT onto every board set up from a phone,
// which is how a retired World Cup card kept arriving on new boards for nine
// days. Everything else in DEFAULT_CONFIG (location, sources, tickers) is still
// the starting point; only the layout starts empty. Pure so it can be tested
// without the DOM: `normalized` is the config after normalizeConfig, `scanned`
// is truthy only when a board QR decoded.
export const startingLayout = (normalized, scanned) => (scanned ? normalized.layout : []);

// The board this wizard arrived from, if it arrived from a board QR at all.
// Held so the preserve rule below can compare against it. null on a fresh visit.
let scannedLayout = null;

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

// Which layout a set of picks should produce.
//
// THE SCANNED-BOARD RULE, exactly as implemented: a layout that arrived from a
// board QR is handed back UNTOUCHED for as long as the picked set is the same set
// of ids that board already carries. The moment the SET differs — one card added
// or one removed — the whole board is generated from the picks instead. Untick a
// card and tick it straight back and you get your own arrangement again, because
// the rule is a comparison and not a latch.
//
// The reason it is a set comparison and not "did anything ever change": that
// scanned layout is a board somebody ARRANGED BY HAND in edit mode, dragging and
// resizing cards on the wall. Re-flowing it under them because they retyped a
// ticker would throw that work away. Changing the card set is the one signal that
// they want a different board, and it is also the point at which the old
// arrangement has a hole in it. Editing the LISTS (tickers, teams, lines) never
// re-arranges a scanned board — it does re-run the generator for a board this
// wizard generated, which is the whole point of running it again at Get-code time.
//
// Pure and exported for tests: `scanned` is the scanned layout or null.
export function layoutFor(ids, cfg, scanned) {
  const want = new Set(ids);
  if (scanned?.length && sameSet(want, new Set(scanned.map((r) => r.id)))) {
    return { layout: scanned.map((r) => ({ ...r })), dropped: [], crowded: [], scannedKept: true };
  }
  const { layout, dropped, crowded } = optimizeLayout([...want], cfg);
  return { layout, dropped, crowded, scannedKept: false };
}

// Everything the board shows is derived from the picks, so regenerate in one
// place. Returns what the generator had to give up, for the notices.
let lastCrowded = [];
function syncLayout(ids) {
  const res = layoutFor(ids, cfg, scannedLayout);
  cfg.layout = res.layout;
  cfg.widgets = res.layout.map((r) => r.id);
  lastCrowded = res.crowded;
  return res;
}

// Said out loud on the picker when the pick asks for more than the board holds
// well. Sean's call, 2026-07-29: the generator refuses to put a data card below
// the size that shows a worthwhile amount of its data — three departures, three
// lines, three tickers — so when the picks cannot all clear that bar, the honest
// move is to say so rather than to ship slivers that technically contain data.
// Pure; exported for tests.
export const crowdedNote = (n) =>
  (n <= 0 ? ''
    : n === 1
      ? 'One card will be small. That is a lot for one screen; uncheck something and it gets more room.'
      : `${n} cards will be small. That is a lot for one screen; uncheck one or two and the rest get more room.`);

async function boot() {
  // Pre-fill from a scanned board QR (#cfg=...). A scan is the one case that
  // DOES arrive pre-checked: it is that board's own current card set, and the
  // user came here to adjust it, not to start over.
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  let scanned = null;
  if (hash.get('cfg')) {
    try {
      scanned = await decodeConfig(hash.get('cfg'));
      cfg = scanned;
    } catch {
      // fall through to defaults
    }
  }
  cfg = structuredClone(normalizeConfig(cfg));
  // normalizeConfig cannot represent an empty layout (normalizeLayout treats []
  // as "no opinion" and hands back DEFAULT_LAYOUT, the safety net that keeps a
  // corrupted stored config off a blank board). So the blank slate is applied
  // AFTER normalizing, and getCode/getSignageUrl refuse to encode it.
  cfg.layout = startingLayout(cfg, scanned);
  cfg.widgets = cfg.layout.map((r) => r.id);
  // A scan is the one arrival that carries a board somebody arranged by hand.
  // Remember it, so the preserve rule in layoutFor has something to compare to.
  scannedLayout = scanned ? cfg.layout.map((r) => ({ ...r })) : null;

  $('#name').value = cfg.name;
  $('#mode').value = cfg.mode;

  // Wire the critical controls FIRST — before any data-loading section render —
  // so a flaky fetch or a Pages per-asset deploy skew (which throws an import
  // SyntaxError) can't leave the Get-code / wizard buttons dead.
  $('#get-code').addEventListener('click', getCode);
  $('#get-signage-url').addEventListener('click', getSignageUrl);
  $('#copy-signage-url').addEventListener('click', copySignageUrl);
  $('#copy-code').addEventListener('click', copyCode);
  // Every field on this page writes straight into `cfg` from its own handler,
  // so rather than teach twenty handlers to report in, listen once where all
  // of their events end up. Listeners on an ancestor run AFTER the target's
  // own in the bubble phase, so cfg is already updated by the time this fires;
  // the handful of handlers that finish after an await call refreshGating
  // themselves.
  for (const type of ['change', 'input', 'click']) {
    document.addEventListener(type, () => refreshGating());
  }
  $('#to-step-2').addEventListener('click', () => {
    applyStepTwo();
    $('#step-1').hidden = true;
    $('#step-2').hidden = false;
    window.scrollTo(0, 0);
  });
  $('#to-step-1').addEventListener('click', () => {
    $('#step-2').hidden = true;
    $('#step-1').hidden = false;
    window.scrollTo(0, 0);
  });
  // Before the data-loading renders below, so a scanned board's Next button is
  // live immediately rather than after the slowest station-list fetch.
  refreshGating();

  // Each section renders independently: one failure is logged, not fatal, so a
  // single broken field can't blank the rest of the setup form.
  const safe = async (fn) => { try { await fn(); } catch (e) { console.error('[setup] section render failed', e); } };
  await safe(renderWidgets);
  await safe(renderLocation);
  await safe(renderSchedule);
  await safe(renderLirrDest);
  await safe(() => renderRailDest('mnr-dest', 'data/stations-mnr.json', 'mnr'));
  await safe(() => bindAlertCheck('mnr-alerts', 'mnr'));
  await safe(renderSubwayLines);
  await safe(renderArtPrefs);
  await safe(() => bindAlertCheck('lirr-alerts', 'lirr'));
  await safe(() => bindAlertCheck('njt-alerts', 'njt'));
  await safe(() => renderRailDest('amtrak-dest', 'data/stations-amtrak.json', 'amtrak'));
  await safe(() => bindAlertCheck('amtrak-alerts', 'amtrak'));
  await safe(renderNjt);
  await safe(renderPath);
  await safe(renderFerry);
  await safe(renderBusStops);
  await safe(renderCitibikeField);
  await safe(renderTflLines);
  await safe(renderTickers);
  await safe(renderMarketsNewsSources);
  await safe(renderWorldclockPrefs);
  await safe(renderTeams);
  await safe(renderSportsNewsSources);
  await safe(renderNewsSources);
  await safe(renderPostsAccounts);
  await safe(renderPhotos);
  await safe(renderGdrivePhotos);
  await safe(renderServicesField);
  await safe(renderChartField);
  await safe(renderIptvField);
  // Last: the sections above are what the gate reads, and a scanned board may
  // arrive already owing a required field.
  refreshGating();
}

// Grouped checkbox HTML for the setup widget picker. `labels` is this page's
// WIDGET_LABELS (phone-length); `placed` is a Set of currently-placed ids.
// Exported for tests. The phone wizard is the LAST grouped picker: the board's
// own Settings gave up its toggle list on 2026-08-01 (edit mode owns add and
// remove there), but /setup builds a config for a board that has none yet, so
// there is no layout to arrange and a checklist is still the right shape.
export function widgetChecksHtml(labels, placed, cfgRef = null) {
  return WIDGET_GROUPS.map((g) => `
    <section class="wpick__group">
      <h3 class="wpick__title">${g.label}</h3>
      <div class="checks">${g.ids.filter((id) => placed.has(id) || isAddable(id, cfgRef)).map((id) =>
        `<label><input type="checkbox" data-w="${id}" ${placed.has(id) ? 'checked' : ''}> ${labels[id]}</label>`,
      ).join('')}</div>
    </section>`).join('');
}

// Step 2 shows only the sections the picks call for, so it has two legitimately
// bare states and they mean opposite things. Naming them is the difference
// between "you're done here" and a page that looks broken. Pure; exported for
// tests.
export function stepTwoNote(pickedCount, visibleSections) {
  if (pickedCount === 0) return 'No widgets picked yet. Go back to step 1 and choose at least one card for your board.';
  if (visibleSections === 0) return 'Nothing to personalize: every card you picked works as it is.';
  return '';
}

// Hide step-2 config sections + dividers that don't apply to the current picks.
function applyStepTwo() {
  const placed = new Set(cfg.layout.map((r) => r.id));
  const { sections, groups } = stepTwoVisibility(placed);
  for (const s of SETUP_SECTIONS) {
    const el = document.getElementById(s.id);
    if (el) el.hidden = !sections.has(s.id);
  }
  document.querySelectorAll('#step-2 [data-group]').forEach((d) => {
    d.hidden = !groups.has(d.dataset.group);
  });
  const note = document.getElementById('step-2-note');
  if (note) {
    note.textContent = stepTwoNote(placed.size, sections.size);
    note.hidden = !note.textContent;
  }
}

// Nothing picked = nothing to put on the board. Both output paths refuse rather
// than encoding it, because normalizeConfig would silently swap the empty layout
// for DEFAULT_LAYOUT (see normalizeLayout) and hand the user a code for a board
// they did not choose — which is the exact failure the blank-slate picker was
// meant to end. Exported for tests.
export const canEncode = (layout) => Array.isArray(layout) && layout.length > 0;
export const EMPTY_PICKS_NOTICE = 'Pick at least one widget first — a board with no cards has nothing to show.';

// The picker labels carry a parenthetical for the picker's sake ("LIRR (Penn
// Station)"); the summary beside the code is a sanity check read while walking
// to the board, so it drops them.
export const shortLabel = (label) => String(label ?? '').replace(/\s*\([^)]*\)\s*$/, '');

// One line beside the generated code: how many cards, and which. Long picks
// truncate rather than wrap into a paragraph — the count is the check, the
// names are the reassurance. Pure; exported for tests.
export function pickSummary(ids, labels = WIDGET_LABELS, max = 5) {
  const names = [...(ids ?? [])].map((id) => shortLabel(labels[id] ?? id));
  if (!names.length) return '';
  const head = names.slice(0, max);
  const rest = names.length - head.length;
  return `${names.length} widget${names.length === 1 ? '' : 's'}: ${head.join(', ')}${rest ? `, plus ${rest} more` : ''}`;
}

// Step 2 edits the very lists the generator reads — tickers, teams, subway
// lines, cities — so the layout that leaves this page has to be generated
// AFTER those edits, not from the 3-ticker defaults the picker last saw.
// Cheapest correct place: once, on the way out. A scanned board is untouched
// here (layoutFor's preserve rule), which is deliberate: retyping a ticker must
// not re-flow a wall somebody arranged by hand.
function regenerateForOutput() {
  syncLayout(new Set(cfg.layout.map((r) => r.id)));
}

// Returns true when it blocked.
function blockedOnEmptyPicks() {
  if (canEncode(cfg.layout)) return false;
  notice(EMPTY_PICKS_NOTICE);
  $('#step-2').hidden = true;
  $('#step-1').hidden = false;
  window.scrollTo(0, 0);
  return true;
}

// Backstop for the same rule the disabled button already enforces. The button
// is the primary gate — a disabled control cannot be tapped, so nothing bounces
// — but a keyboard, an autofill, or a future caller can still reach these
// functions, and a code for a board with a blank card must never leave here.
// Returns true when it blocked.
function blockedOnRequired() {
  const missing = missingRequired(cfg, new Set(cfg.layout.map((r) => r.id)));
  if (!missing.length) return false;
  notice(requiredNotice(missing));
  return true;
}

// One place that decides what is tappable and what is still owed, re-run after
// anything that could change either. Buttons carry the real `disabled`
// attribute rather than a look-alike class, so a tap on a blocked button does
// nothing at all instead of raising a toast the user has to dismiss; the guard
// line beside them says why, because a dead control that explains nothing is
// just a dead end.
function refreshGating() {
  const placed = new Set(cfg.layout.map((r) => r.id));
  const missing = missingRequired(cfg, placed);
  const unmet = new Set(missing.map((f) => f.id));
  document.querySelectorAll('[data-req]').forEach((badge) =>
    badge.classList.toggle('req--unmet', unmet.has(badge.dataset.req)));

  const next = document.getElementById('to-step-2');
  if (next) next.disabled = placed.size === 0; // the running count under the picker carries the ask

  const blocked = !canEncode(cfg.layout) || missing.length > 0;
  for (const id of ['get-code', 'get-signage-url']) {
    const btn = document.getElementById(id);
    // Never fight getCode's own in-flight disable ("Getting code…").
    if (btn && !btn.dataset.busy) btn.disabled = blocked;
  }
  // Required fields only. The zero-pick case already has its own sentence at
  // the top of step 2 (stepTwoNote), and with Next disabled it is unreachable
  // through the UI anyway — blockedOnEmptyPicks remains its backstop.
  const guard = document.getElementById('code-guard');
  if (guard) {
    guard.textContent = requiredNotice(missing);
    guard.hidden = !guard.textContent;
  }
}

// In-app notice replacing browser alert(): the native "…says" chrome broke
// the page's look, and its copy suggested actions (shrink) that aren't
// possible here. Tap or wait to dismiss.
let noticeTimer = null;
function notice(msg) {
  let t = document.getElementById('setup-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'setup-toast';
    t.className = 'toast';
    t.addEventListener('click', () => { t.hidden = true; });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { t.hidden = true; }, 6000);
}
function dismissNotice() {
  const t = document.getElementById('setup-toast');
  if (t) t.hidden = true;
  clearTimeout(noticeTimer);
}

// Repaints the checkbox list from cfg. Assigned by renderWidgets; the change
// handler lives on the #widgets CONTAINER, so redrawing its children never
// costs a re-bind and the checked state re-derives from cfg.layout.
let repaintWidgets = null;

// Ocean gate for the Surf card. The wizard always knows a location by the time
// the picker is drawn — the defaults, or the board's own config from a scanned
// QR — so the verdict is simply asked for on load, and again whenever the
// location changes. Until one lands Surf is absent, which is the honest state:
// on a phone we cannot know whether this board is anywhere near the water.
function probeSurf() {
  ensureOceanProbe(cfg.loc, { fetchJSON }, () => repaintWidgets?.());
}

// Live running total under the picker. The wizard opens with nothing ticked, so
// the empty state has to ASK rather than just sit there looking finished — and
// once picking starts the same line becomes the count, which is the thing a user
// scrolling a 34-card list actually wants to know. Exported for tests.
export const pickedLabel = (n) =>
  (n === 0
    ? 'Nothing picked yet. Choose the cards you want on your board.'
    : `${n} widget${n === 1 ? '' : 's'} picked.`);

function renderWidgets() {
  const placed = () => new Set(cfg.layout.map((r) => r.id));
  const count = $('#widget-count');
  const repaintCount = () => {
    if (!count) return;
    count.textContent = [pickedLabel(cfg.layout.length), crowdedNote(lastCrowded.length)]
      .filter(Boolean).join(' ');
  };
  repaintWidgets = () => {
    $('#widgets').innerHTML = widgetChecksHtml(WIDGET_LABELS, placed(), cfg);
    repaintCount();
  };
  repaintWidgets();
  probeSurf();
  $('#widgets').addEventListener('change', (e) => {
    const id = e.target.dataset.w;
    if (!id) return;
    // Acting on the picker makes any standing notice moot (a failed check
    // below re-raises it fresh).
    dismissNotice();
    // The whole board is re-generated from the picks on every tick. That is what
    // kills the two failures the old incremental path had: the board no longer
    // depends on the ORDER the boxes were ticked, and "No room left" no longer
    // fires because the previous cards happened to be sitting in the way — a
    // widget is refused only if it cannot fit at its legible minimum in ANY
    // arrangement, which for a pick of this size does not happen.
    const want = placed();
    if (e.target.checked) want.add(id); else want.delete(id);
    const { dropped } = syncLayout(want);
    if (e.target.checked && dropped.includes(id)) {
      e.target.checked = false;
      notice('No room left on the board for that widget. Uncheck another widget to make space.');
    }
    repaintCount();
  });
}

async function renderRailDest(selectId, dataUrl, group) {
  const stations = await (await fetch(dataUrl)).json();
  // No "Any station": a stops-at pick is required (the card prompts until one
  // is made). The placeholder keeps '' so skipping the section is possible.
  $('#' + selectId).innerHTML =
    `<option value="">Choose a station</option>` +
    stations.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
  $('#' + selectId).value = cfg[group].dest;
  $('#' + selectId).addEventListener('change', (e) => (cfg[group].dest = e.target.value));
}

async function renderLirrDest() {
  $('#lirr-origin').value = cfg.lirr.origin ?? 'penn';
  $('#lirr-origin').addEventListener('change', (e) => (cfg.lirr.origin = e.target.value));
  return renderRailDest('lirr-dest', 'data/stations-lirr.json', 'lirr');
}

function bindAlertCheck(id, group) {
  const box = $('#' + id);
  box.checked = cfg[group].alerts;
  box.addEventListener('change', () => (cfg[group].alerts = box.checked));
}

function renderArtPrefs() {
  $('#art-every').value = String(cfg.art.every);
  $('#art-every').addEventListener('change', (e) => (cfg.art.every = Number(e.target.value)));
  $('#art-cats').innerHTML = ART_CATS.map(
    ([id, label]) => `<label><input type="checkbox" data-c="${id}" ${cfg.art.cats.includes(id) ? 'checked' : ''}> ${label}</label>`,
  ).join('');
  $('#art-cats').addEventListener('change', (e) => {
    const c = e.target.dataset.c;
    if (c) cfg.art.cats = toggleIn(cfg.art.cats, c);
  });
}

function renderSubwayLines() {
  const paint = () => {
    $('#sub-lines').innerHTML = SUBWAY_LINES.map((l) => {
      const on = cfg.subway.lines.includes(l);
      return `<button type="button" class="bullet bullet--${l} linechip ${on ? '' : 'linechip--off'}" data-l="${l}" role="switch" aria-checked="${on}">${l}</button>`;
    }).join('');
    $('#sub-lines').querySelectorAll('[data-l]').forEach((b) =>
      b.addEventListener('click', () => {
        cfg.subway.lines = toggleIn(cfg.subway.lines, b.dataset.l);
        paint();
      }),
    );
  };
  paint();
}

const M2HM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const HM2M = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
function renderSchedule() {
  const sel = $('#mode'), editor = $('#schedule-editor'), rows = $('#schedule-rows');
  sel.value = cfg.mode;
  const paint = () => {
    editor.hidden = sel.value !== 'scheduled';
    rows.innerHTML = cfg.schedule.map((w, i) => `<div class="sched-row">
      <input type="time" step="900" data-i="${i}" data-t="start" value="${M2HM(w.start)}">
      <span>–</span>
      <input type="time" step="900" data-i="${i}" data-t="end" value="${M2HM(w.end)}">
      ${cfg.schedule.length > 1 ? `<button type="button" data-rm="${i}">✕</button>` : ''}
    </div>`).join('');
    rows.querySelectorAll('input[type="time"]').forEach((inp) =>
      inp.addEventListener('change', () => {
        if (!inp.value) return; // don't clobber on a cleared field
        cfg.schedule[Number(inp.dataset.i)][inp.dataset.t] = HM2M(inp.value);
      }));
    rows.querySelectorAll('[data-rm]').forEach((b) =>
      b.addEventListener('click', () => { cfg.schedule = cfg.schedule.filter((_, i) => i !== Number(b.dataset.rm)); paint(); }));
  };
  sel.addEventListener('change', paint);
  $('#schedule-add').addEventListener('click', () => {
    if (cfg.schedule.length < 4) cfg.schedule = [...cfg.schedule, { start: 540, end: 1020 }];
    paint();
  });
  paint();
}

function renderLocation() {
  $('#loc-current').textContent = `Current: ${cfg.loc.label}`;
  const paintUnits = () => $('#weather-field').querySelectorAll('[data-units]').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.units === (cfg.loc.units === 'C' ? 'C' : 'F')));
  $('#loc-go').addEventListener('click', async () => {
    const results = await locationSearch($('#loc-search').value);
    $('#loc-results').innerHTML = results.length
      ? results.map((r, i) => `<button type="button" class="btn" data-pick="${i}">${escapeHtml(r.label)}</button>`).join('')
      : '<span class="hint">No matches. Try a city name or a 5-digit US ZIP.</span>';
    $('#loc-results').querySelectorAll('[data-pick]').forEach((b) =>
      b.addEventListener('click', () => {
        const r = results[Number(b.dataset.pick)];
        // Picking sets units by region (US → °F, else °C); the toggle overrides.
        cfg.loc = { lat: r.lat, lon: r.lon, label: r.label, units: r.cc === 'US' ? 'F' : 'C' };
        $('#loc-results').innerHTML = '';
        $('#loc-search').value = '';
        $('#loc-current').textContent = `Current: ${cfg.loc.label}`;
        paintUnits();
        // A new spot invalidates the old verdict (probeVerdict is keyed by
        // location), so the picker drops Surf immediately and re-earns it only
        // if this coast answers.
        repaintWidgets?.();
        probeSurf();
      }));
  });
  paintUnits();
  $('#weather-field').querySelectorAll('[data-units]').forEach((b) =>
    b.addEventListener('click', () => { cfg.loc = { ...cfg.loc, units: b.dataset.units }; paintUnits(); }));
}

function renderWorldclockPrefs() {
  const has = (label, zone) => cfg.worldclock.cities.some((c) => c.label === label && c.zone === zone);
  const rerender = () => {
    $('#wc-chips').innerHTML = cfg.worldclock.cities
      .map((c, i) => `<button type="button" data-wc-rm="${i}">${escapeHtml(c.label)} ✕</button>`).join('');
    $('#wc-chips').querySelectorAll('[data-wc-rm]').forEach((b) =>
      b.addEventListener('click', () => {
        cfg.worldclock.cities = cfg.worldclock.cities.filter((_, i) => i !== Number(b.dataset.wcRm));
        rerender();
      }));
    $('#wc-offices').innerHTML = OFFICES.map(([label, zone], i) =>
      `<label><input type="checkbox" data-wc-office="${i}" ${has(label, zone) ? 'checked' : ''}> ${label}</label>`).join('');
    $('#wc-offices').querySelectorAll('[data-wc-office]').forEach((box) =>
      box.addEventListener('change', () => {
        const [label, zone] = OFFICES[Number(box.dataset.wcOffice)];
        cfg.worldclock.cities = box.checked && cfg.worldclock.cities.length < 10
          ? [...cfg.worldclock.cities, { label, zone }]
          : cfg.worldclock.cities.filter((c) => !(c.label === label && c.zone === zone));
        rerender();
      }));
  };
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const byRegion = zonesByRegion(zones);
  const regions = Object.keys(byRegion);
  const fillZones = (region) => {
    $('#wc-zone').innerHTML = (byRegion[region] || [])
      .map((z) => `<option value="${z}">${zoneLabel(z)} — ${z}</option>`).join('');
  };
  $('#wc-region').innerHTML = regions.map((r) => `<option value="${r}">${r}</option>`).join('');
  if (regions.length) fillZones(regions[0]);
  $('#wc-region').addEventListener('change', () => fillZones($('#wc-region').value));
  if (!zones.length) { $('#wc-region').hidden = true; $('#wc-zone').hidden = true; $('#wc-add').hidden = true; }
  $('#wc-add').addEventListener('click', () => {
    const zone = $('#wc-zone').value;
    if (!zone) return;
    const label = zoneLabel(zone);
    if (!has(label, zone) && cfg.worldclock.cities.length < 10) {
      cfg.worldclock.cities = [...cfg.worldclock.cities, { label, zone }];
      rerender();
    }
  });
  rerender();
}

// Same component and same code path as the board pane, with two deliberate
// differences that are the SURFACE's, not the code's: rows go two-line at
// 390px (three controls plus "CBG.L · Close Brothers" truncates on one), and
// the fold falls wherever this config's own layout puts it — /setup's markets
// card is at its 3×3 default, so the line lands after the third row, not the
// board's fifth. Never hard-coded: it reads the layout it is about to encode.
function renderTickers() {
  const list = $('#sym-list');
  const draw = () => {
    const cap = foldAt(cfg);
    const symbols = cfg.markets.symbols;
    $('#sym-fold').innerHTML = foldHeadHtml(cap, symbols.length);
    list.innerHTML = symbols.length
      ? tickerRowsHtml(symbols, { cap })
      : '<p class="hint">No tickers; the three index defaults return on save.</p>';
    $('#sym-note').textContent = symbols.length === 1
      ? 'Add a second ticker and each row gains a handle to drag it by.'
      : '';
    list.querySelectorAll('[data-remove-sym]').forEach((b) =>
      b.addEventListener('click', () => {
        cfg.markets.symbols = symbols.filter((t) => t !== b.dataset.removeSym);
        draw();
      }),
    );
  };
  draw();
  // The PAGE is what scrolls here, so that is what auto-scrolls under a drag
  // near the top or bottom of the screen. The handle carries touch-action:none
  // and nothing else does, which is what keeps a drag from turning into a
  // page scroll. Bound once to the list element, which outlives every draw().
  attachReorder(list, {
    order: () => cfg.markets.symbols,
    cap: () => foldAt(cfg),
    scroller: document.scrollingElement,
    commit: (next) => { cfg.markets.symbols = next; draw(); },
  });
  $('#sym-add').addEventListener('click', async () => {
    // Normalize BEFORE validating: "£CBG" used to fail the regex silently
    // (the £ never even produced a message) — now it becomes CBG.L.
    const t = normalizeSymbol($('#sym-code').value);
    if (!canAddTicker(cfg.markets.symbols, t)) return;
    const btn = $('#sym-add');
    btn.disabled = true;
    $('#sym-status').textContent = 'Checking…';
    if (await symbolKnown(t)) {
      cfg.markets.symbols = [...cfg.markets.symbols, t];
      $('#sym-code').value = '';
      $('#sym-status').textContent = '';
      draw();
    } else {
      const tip = /^[A-Z]{1,6}$/.test(t) ? ' If it trades outside the US, add the exchange suffix: London CBG.L, Frankfurt SAP.DE, Toronto SHOP.TO.' : '';
      $('#sym-status').textContent = `${t} isn't a known ticker. Check the symbol.${tip}`;
    }
    btn.disabled = false;
  });
}

async function renderTeams() {
  const data = await (await fetch('data/teams.json')).json();
  const leagueSel = $('#team-league');
  const teamSel = $('#team-select');
  leagueSel.innerHTML = data.leagues.map((l, i) => `<option value="${i}">${l.label}</option>`).join('');
  const syncTeams = () => {
    const l = data.leagues[Number(leagueSel.value)];
    teamSel.innerHTML = l.teams.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
  };
  leagueSel.addEventListener('change', syncTeams);
  syncTeams();
  const chips = $('#team-chips');
  const byKey = {};
  for (const l of data.leagues) for (const t of l.teams) byKey[`${l.lg}:${t.id}`] = { ...t, label: l.label };
  const renderChips = () => {
    chips.innerHTML = cfg.sports.teams
      .map((sel) => {
        const t = byKey[`${sel.lg}:${sel.id}`];
        return `<button type="button" data-team="${escapeHtml(sel.lg)}:${escapeHtml(sel.id)}">${escapeHtml(t ? t.name : sel.id)} ✕</button>`;
      })
      .join('');
    chips.querySelectorAll('[data-team]').forEach((b) =>
      b.addEventListener('click', () => {
        const [lg, id] = b.dataset.team.split(':');
        cfg.sports.teams = cfg.sports.teams.filter((t) => !(t.lg === lg && t.id === id));
        renderChips();
      }),
    );
  };
  renderChips();
  $('#team-add').addEventListener('click', () => {
    const lg = data.leagues[Number(leagueSel.value)].lg;
    const id = teamSel.value;
    if (!cfg.sports.teams.some((t) => t.lg === lg && t.id === id) && cfg.sports.teams.length < 6) {
      cfg.sports.teams = [...cfg.sports.teams, { lg, id }];
      renderChips();
    }
  });
}

async function renderMarketsNewsSources() {
  const { MARKET_SOURCES } = await import('../widgets/marketsnews.js');
  $('#marketsnews-sources').innerHTML = MARKET_SOURCES.map(
    ([id, label]) => `<label><input type="checkbox" data-mn="${id}" ${cfg.marketsnews.sources.includes(id) ? 'checked' : ''}> ${label}</label>`,
  ).join('');
  $('#marketsnews-sources').addEventListener('change', (e) => {
    const id = e.target.dataset.mn;
    if (id) cfg.marketsnews.sources = toggleIn(cfg.marketsnews.sources, id);
  });
}

async function renderSportsNewsSources() {
  const { SPORTS_SOURCES } = await import('../widgets/sportsnews.js');
  $('#sportsnews-sources').innerHTML = SPORTS_SOURCES.map(
    ([id, label]) => `<label><input type="checkbox" data-tn="${id}" ${cfg.sportsnews.sources.includes(id) ? 'checked' : ''}> ${label}</label>`,
  ).join('');
  $('#sportsnews-sources').addEventListener('change', (e) => {
    const id = e.target.dataset.tn;
    if (id) cfg.sportsnews.sources = toggleIn(cfg.sportsnews.sources, id);
  });
  // The filter needs a team to filter by, and the wizard's own team picker is
  // the section directly above, so the note points there rather than gating.
  const only = $('#sportsnews-only');
  only.checked = cfg.sportsnews.onlyMyTeams;
  only.addEventListener('change', () => { cfg.sportsnews.onlyMyTeams = only.checked; });
}

// Live Video: two plain inputs (URL + optional label) bound straight to cfg.
function renderIptvField() {
  const url = document.getElementById('iptv-url');
  const label = document.getElementById('iptv-label');
  const warn = document.getElementById('iptv-url-warn');
  url.value = cfg.iptv?.url ?? '';
  label.value = cfg.iptv?.label ?? '';
  url.addEventListener('input', () => {
    const v = url.value.trim();
    cfg.iptv = { ...cfg.iptv, url: v };
    // Mirror normalizeConfig's rule so a doomed URL isn't a silent surprise.
    warn.hidden = !v || /^https:\/\/\S+$/i.test(v);
  });
  label.addEventListener('input', () => { cfg.iptv = { ...cfg.iptv, label: label.value.trim() }; });
}

async function renderChartField() {
  const { CHART_TOPICS } = await import('../widgets/chart-topics.js');
  const allSlugs = CHART_TOPICS.map(([, slug]) => slug);
  const box = $('#chart-topics');
  box.innerHTML =
    `<label><input type="checkbox" id="chart-all-cb"> <b>Select all</b></label>` +
    CHART_TOPICS.map(
      ([label, slug]) => `<label><input type="checkbox" data-topic="${escapeHtml(slug)}"> ${escapeHtml(label)}</label>`,
    ).join('');
  const syncAll = () => { $('#chart-all-cb').checked = allSlugs.every((s) => cfg.chart.topics.includes(s)); };
  const syncTopics = () => box.querySelectorAll('[data-topic]').forEach((cb) => { cb.checked = cfg.chart.topics.includes(cb.dataset.topic); });
  syncTopics();
  syncAll();
  box.addEventListener('change', (e) => {
    if (e.target.id === 'chart-all-cb') {
      cfg.chart.topics = e.target.checked ? [...allSlugs] : [];
      syncTopics();
      return;
    }
    const slug = e.target.dataset.topic;
    if (slug) { cfg.chart.topics = toggleIn(cfg.chart.topics, slug); syncAll(); }
  });
  const pol = $('#chart-politics');
  pol.checked = cfg.chart.excludePolitics;
  pol.addEventListener('change', () => { cfg.chart.excludePolitics = pol.checked; });
}

async function renderNewsSources() {
  const { NEWS_SOURCES } = await import('../widgets/news.js');
  $('#news-sources').innerHTML = NEWS_SOURCES.map(
    ([id, label, , , scope]) => `<label><input type="checkbox" data-n="${id}" ${cfg.news.sources.includes(id) ? 'checked' : ''}> ${label} <small>(${scope})</small></label>`,
  ).join('');
  $('#news-sources').addEventListener('change', (e) => {
    const id = e.target.dataset.n;
    if (id) cfg.news.sources = toggleIn(cfg.news.sources, id);
  });
}

let expressBusData = null;
function renderTflLines() {
  const paint = () => {
    $('#tfl-lines').innerHTML = TFL_MODES.map((g) => {
      const chips = TFL_LINES.filter((l) => l.mode === g).map((l) => {
        const on = cfg.tfl.lines.includes(l.id);
        return `<button type="button" class="tflchip ${on ? '' : 'tflchip--off'}" data-l="${l.id}" role="switch" aria-checked="${on}">
          <span class="tflchip__dot" style="background:${l.color}"></span>${escapeHtml(l.name)}</button>`;
      }).join('');
      return `<h3 class="setup__subhead">${g}</h3><div class="tflchips">${chips}</div>`;
    }).join('');
    $('#tfl-lines').querySelectorAll('[data-l]').forEach((b) =>
      b.addEventListener('click', () => { cfg.tfl.lines = toggleIn(cfg.tfl.lines, b.dataset.l); paint(); }));
  };
  paint();
}

let cbStations = null; // citibike station bundle, fetched once
async function renderCitibikeField() {
  cbStations ??= await fetch('data/citibike-stations.json').then((r) => r.json());
  const input = $('#citibike-search');
  const list = $('#citibike-matches');
  const chipsEl = $('#citibike-chips');
  const drawChips = () => {
    chipsEl.innerHTML = cfg.citibike.stations
      .map((s, i) => `<button type="button" class="chip" data-remove="${i}">${escapeHtml(s.name)} ✕</button>`).join('');
    chipsEl.querySelectorAll('[data-remove]').forEach((c) =>
      c.addEventListener('click', () => { cfg.citibike.stations = cfg.citibike.stations.filter((_, i) => i !== Number(c.dataset.remove)); drawChips(); }));
  };
  input.addEventListener('input', () => {
    const chosenIds = new Set(cfg.citibike.stations.map((s) => s.id));
    const matches = searchStations(cbStations, input.value, chosenIds, 15);
    list.innerHTML = matches.map((s) => (s.added
      ? `<span class="btn picklist__item--added">${escapeHtml(s.name)} ✓ Added</span>`
      : `<button type="button" class="btn" data-add="${s.id}" data-name="${escapeHtml(s.name)}">${escapeHtml(s.name)}</button>`)).join('');
    list.querySelectorAll('[data-add]').forEach((b) =>
      b.addEventListener('click', () => {
        if (cfg.citibike.stations.length >= 6) return;
        cfg.citibike.stations = [...cfg.citibike.stations, { id: b.dataset.add, name: b.dataset.name }];
        input.value = ''; list.innerHTML = ''; drawChips();
      }));
  });
  drawChips();
}

async function renderBusStops() {
  const { expressRoutes, directionsForRoute, stopsForRouteDir } = await import('./pickers.js');
  expressBusData ??= await fetch('data/express-bus.json').then((r) => r.json());
  const chips = $('#bus-chips');
  const routeSel = $('#bus-route'), dirSel = $('#bus-dir'), stopSel = $('#bus-stop');
  const opt = (v, t) => `<option value="${escapeHtml(v)}">${escapeHtml(t)}</option>`;
  const paintChips = () => {
    chips.innerHTML = cfg.bus.legs.map((l, i) => `<button type="button" class="chip" data-remove="${i}">${escapeHtml(l.route)} · ${escapeHtml(l.stopName)} ✕</button>`).join('');
    chips.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => { cfg.bus.legs = cfg.bus.legs.filter((_, i) => i !== Number(b.dataset.remove)); paintChips(); }));
  };
  routeSel.innerHTML = expressRoutes(expressBusData).map((r) => opt(r.id, r.id)).join('');
  const paintDirs = () => { dirSel.innerHTML = directionsForRoute(expressBusData, routeSel.value).map((d) => opt(d.id, d.headsign || `Direction ${d.id}`)).join(''); paintStops(); };
  const paintStops = () => { stopSel.innerHTML = stopsForRouteDir(expressBusData, routeSel.value, Number(dirSel.value)).map((s) => opt(s.id, s.name)).join(''); };
  routeSel.addEventListener('change', paintDirs);
  dirSel.addEventListener('change', paintStops);
  paintDirs();
  $('#bus-add').addEventListener('click', () => {
    if (cfg.bus.legs.length >= 2) return;
    const route = expressRoutes(expressBusData).find((r) => r.id === routeSel.value);
    const name = stopsForRouteDir(expressBusData, routeSel.value, Number(dirSel.value)).find((s) => s.id === stopSel.value)?.name ?? '';
    cfg.bus.legs = [...cfg.bus.legs, { route: route.id, lineRef: route.lineRef, dir: Number(dirSel.value), stopId: stopSel.value, stopName: name }];
    paintChips();
  });
  paintChips();
}

// New York Penn is fixed (mirrors LIRR/Amtrak); the user filters by line. No
// selection = all lines. Modeled on the Markets News source checkboxes.
function renderNjt() {
  $('#njt-lines').innerHTML = NJT_LINES.map(
    (l) => `<label><input type="checkbox" data-njt="${escapeHtml(l)}" ${cfg.njt.lines.includes(l) ? 'checked' : ''}> ${escapeHtml(l)}</label>`,
  ).join('');
  $('#njt-lines').addEventListener('change', (e) => {
    const line = e.target.dataset.njt;
    if (line) cfg.njt.lines = toggleIn(cfg.njt.lines, line);
  });
}

// Shared follow-list field (substack pubs / bsky handles): chips + one
// validated text-input add flow.
function renderFollowField(prefix, cfgKey, listKey, validate) {
  const chips = $(`#${prefix}-chips`);
  const status = $(`#${prefix}-status`);
  const renderChips = () => {
    chips.innerHTML = cfg[cfgKey][listKey]
      .map((a, i) => `<button type="button" data-acct="${i}">${escapeHtml(a.label)} ✕</button>`)
      .join('');
    chips.querySelectorAll('[data-acct]').forEach((b) =>
      b.addEventListener('click', () => {
        cfg[cfgKey][listKey] = cfg[cfgKey][listKey].filter((_, i) => i !== Number(b.dataset.acct));
        renderChips();
      }),
    );
  };
  renderChips();
  $(`#${prefix}-add`).addEventListener('click', async () => {
    const id = $(`#${prefix}-id`).value.trim().toLowerCase();
    const list = cfg[cfgKey][listKey];
    if (!id || list.length >= 6 || list.some((a) => a.id === id)) return;
    status.textContent = 'Checking…';
    try {
      const label = await validate(id);
      cfg[cfgKey][listKey] = [...list, { id, label }];
      $(`#${prefix}-id`).value = '';
      status.textContent = '';
      renderChips();
    } catch {
      status.textContent = `Couldn't find "${id}".`;
    }
  });
}

function renderPostsAccounts() {
  renderFollowField('substack', 'substack', 'pubs', async (id) => {
    const digest = await (await fetch(`${WORKER_URL}/posts/substack?pub=${encodeURIComponent(id)}`)).json();
    if (!digest.posts?.length) throw new Error('not found');
    return id.slice(0, 30);
  });
  renderFollowField('bsky', 'bsky', 'handles', async (id) => {
    const prof = await (await fetch(`${BSKY_API}/app.bsky.actor.getProfile?actor=${encodeURIComponent(id)}`)).json();
    if (!prof.handle) throw new Error('not found');
    return (prof.displayName || prof.handle).slice(0, 30);
  });
}

const renderPhotos = () => renderPhotoField('icloud');
const renderGdrivePhotos = () => renderPhotoField('gdrive');

// One setup-form photo field, keyed by source. iCloud → cfg.photos, Drive →
// cfg.gdrivephotos; the two widgets are independent, so /setup can configure
// either or both. Which source drives the screensaver is a board-side setting
// (Settings → Screensaver) — /setup no longer carries it.
function renderPhotoField(src) {
  const gd = src === 'gdrive';
  const key = gd ? 'gdrivephotos' : 'photos';
  const pre = gd ? 'gdrivephotos' : 'photos';
  $(`#${pre}-every`).value = String(cfg[key].every);
  $(`#${pre}-album`).value = cfg[key].album;
  $(`#${pre}-every`).addEventListener('change', (e) => (cfg[key].every = Number(e.target.value)));
  $(`#${pre}-add`).addEventListener('click', async () => {
    const id = gd ? parseDriveFolder($(`#${pre}-album`).value) : parseAlbumToken($(`#${pre}-album`).value);
    const status = $(`#${pre}-status`);
    if (!id) { status.textContent = `That doesn't look like a ${gd ? 'Drive folder' : 'album'} link.`; return; }
    status.textContent = 'Checking…';
    try {
      const endpoint = gd
        ? `${WORKER_URL}/gdrive/album?folder=${encodeURIComponent(id)}`
        : `${WORKER_URL}/icloud/album?token=${encodeURIComponent(id)}`;
      const res = await fetch(endpoint);
      if (res.status === 503) { status.textContent = 'The server needs a Google Drive key (GDRIVE_KEY).'; return; }
      const digest = await res.json();
      if (!digest.photos?.length) throw new Error('empty');
      cfg[key].album = id;
      status.textContent = `Found ${digest.photos.length} photos.`;
      refreshGating(); // the album only counts once the check comes back
    } catch {
      status.textContent = gd
        ? "Couldn't open that folder. Make sure it's shared to Anyone with the link."
        : "Couldn't open that album. Check Public Website is on and the link is exact.";
    }
  });
}

async function renderServicesField() {
  const { SERVICE_CHOICES } = await import('../widgets/services.js');
  $('#services-list').innerHTML = SERVICE_CHOICES.map(
    ([id, label]) => `<label><input type="checkbox" data-svc="${id}" ${cfg.services.list.includes(id) ? 'checked' : ''}> ${label}</label>`,
  ).join('');
  $('#services-list').addEventListener('change', (e) => {
    const id = e.target.dataset?.svc;
    if (id) cfg.services.list = toggleIn(cfg.services.list, id);
  });
}

function renderPath() {
  $('#path-station').innerHTML = Object.entries(PATH_STATIONS)
    .map(([code, name]) => `<option value="${code}">${name}</option>`).join('');
  $('#path-station').value = cfg.path.station;
  $('#path-station').addEventListener('change', (e) => (cfg.path.station = e.target.value));
  $('#path-dir').innerHTML = PATH_DIRS
    .map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
  $('#path-dir').value = cfg.path.dir;
  $('#path-dir').addEventListener('change', (e) => (cfg.path.dir = e.target.value));
}

async function renderFerry() {
  try {
    const { stops } = await (await fetch('data/ferry.json')).json();
    $('#ferry-landing').innerHTML = stops
      .map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
  } catch {
    $('#ferry-landing').innerHTML = '<option value="17">East 34th Street</option>';
  }
  $('#ferry-landing').value = cfg.ferry.landing;
  $('#ferry-landing').addEventListener('change', (e) => (cfg.ferry.landing = e.target.value));
}

// Cfg-only signage URL for non-touch devices (pasted into xConfiguration
// Standby Signage Url). NEVER includes auth — that fragment part is the
// macro's rotating bridge credential and must not leave its board.
export function signageUrlFor(host, encoded) {
  return `https://${host}/#cfg=${encoded}`;
}

// Reveal a result block and bring it to the eye. The code used to appear below
// the fold on a phone with any real pick list, which reads as a button that did
// nothing. Reduced-motion users get the jump instead of the glide, per DESIGN's
// crossfades-become-cuts rule.
function reveal(el) {
  el.hidden = false;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  el.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
}

// Clipboard with a hand-copy fallback: the async API needs a secure context and
// a user gesture, and older phone browsers have neither reliably. Returns
// whether the text actually made it.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand?.('copy') === true;
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// Brief confirmation ON the button, so the answer is where the finger already
// is; the label returns on its own. A blocked clipboard says so and points at
// the six characters, which are on screen and typable either way.
let copyCodeTimer = null;
async function copyCode() {
  const btn = $('#copy-code');
  const hint = $('#code-copied');
  const ok = await copyText($('#code').textContent.trim());
  btn.textContent = ok ? 'Copied' : 'Copy failed';
  btn.classList.toggle('is-copied', ok);
  hint.textContent = ok ? '' : 'This browser blocked the copy. Type the code on the board instead.';
  hint.hidden = ok;
  clearTimeout(copyCodeTimer);
  copyCodeTimer = setTimeout(() => {
    btn.textContent = 'Copy';
    btn.classList.remove('is-copied');
  }, 2200);
}

// Copy the generated URL: clipboard API first, else select the text and try
// the legacy command so one tap still works on older phone browsers; worst
// case the URL is left selected for a manual copy.
async function copySignageUrl() {
  const input = $('#signage-url');
  try {
    await navigator.clipboard.writeText(input.value);
    $('#url-copied').textContent = 'Copied! ';
  } catch {
    input.focus();
    input.select();
    const ok = document.execCommand?.('copy');
    $('#url-copied').textContent = ok ? 'Copied! ' : 'Copy blocked: the URL is selected; copy it manually. ';
  }
}

async function getSignageUrl() {
  regenerateForOutput();
  if (blockedOnEmptyPicks() || blockedOnRequired()) return;
  cfg.name = $('#name').value.trim();
  cfg.mode = $('#mode').value;
  cfg.t = Math.floor(Date.now() / 1000); // fresh t: a re-pasted URL always wins
  const url = signageUrlFor(location.host, await encodeConfig(normalizeConfig(cfg)));
  $('#signage-url').value = url;
  reveal($('#url-out'));
  await copySignageUrl();
}

async function getCode() {
  regenerateForOutput();
  if (blockedOnEmptyPicks() || blockedOnRequired()) return;
  cfg.name = $('#name').value.trim();
  cfg.mode = $('#mode').value;
  cfg.t = Math.floor(Date.now() / 1000);
  const encoded = await encodeConfig(normalizeConfig(cfg));
  const btn = $('#get-code');
  // busy outranks the gate: refreshGating must not un-disable a button that is
  // mid-request just because a stray event fired.
  btn.dataset.busy = '1';
  btn.disabled = true;
  btn.textContent = 'Getting code…';
  try {
    const res = await fetch(`${WORKER_URL}/code`, {
      method: 'POST',
      body: JSON.stringify({ cfg: encoded }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { code } = await res.json();
    $('#code').textContent = code;
    // What you are about to carry to the board, in one line, so a wrong pick is
    // caught here rather than on the wall.
    $('#code-summary').textContent = pickSummary(cfg.layout.map((r) => r.id));
    $('#code-summary').hidden = false;
    $('#copy-code').hidden = false;
    $('#code-help').hidden = false;
    $('#code-error').hidden = true;
    reveal($('#code-out'));
  } catch (err) {
    // Nothing to copy or check when there is no code: the failure owns the card.
    $('#copy-code').hidden = true;
    $('#code-summary').hidden = true;
    $('#code-copied').hidden = true;
    $('#code-help').hidden = true;
    $('#code').textContent = '···';
    $('#code-error').textContent =
      `Couldn't reach the code service (${err.message}). Check that the Worker is deployed.`;
    $('#code-error').hidden = false;
    reveal($('#code-out'));
  } finally {
    delete btn.dataset.busy;
    btn.textContent = 'Get my setup code';
    refreshGating();
  }
}

if (document.getElementById('widgets')) boot();
