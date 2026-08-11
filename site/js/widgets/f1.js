// Formula 1 — next Grand Prix, last-race podium, and driver + constructor
// standings, from the worker's /f1 digest (Jolpica). Config-less. Team colour
// dots reuse the app's Subway/TfL bullet idiom; driver country flags are
// flagcdn images (the same image-flag treatment Golf and Tennis use — emoji flags were
// the board's one non-image flag dialect, and some Chromium builds render
// them as bare letter pairs). Balanced/adaptive: standings sit side-by-side
// when the card is wide, stacked when narrow, measured to fit like the news card.

import { escapeHtml, clockTimeOpts } from '../util.js';
import { WORKER_URL } from '../env.js';
import { fitList } from '../capacity.js';
import { setExpandSource } from '../expand.js';
import { loadImage } from '../imageshow.js';

export const meta = { id: 'f1', title: 'Formula 1', refreshMs: 30 * 60 * 1000 };

// constructorId -> [name, dot colour]. Approx current-grid liveries incl. the
// 2026 entrants (Audi, Cadillac). NOTE: recheck once a season — colours and the
// grid change. Unknown id -> neutral grey dot + the raw id.
const F1_TEAMS = {
  mercedes: ['Mercedes', '#27F4D2'], ferrari: ['Ferrari', '#E8002D'], mclaren: ['McLaren', '#FF8000'],
  red_bull: ['Red Bull', '#3671C6'], aston_martin: ['Aston Martin', '#229971'], alpine: ['Alpine', '#0093CC'],
  williams: ['Williams', '#64C4FF'], rb: ['Racing Bulls', '#6692FF'], haas: ['Haas', '#B6BABD'],
  audi: ['Audi', '#BB0A30'], sauber: ['Kick Sauber', '#52E252'], cadillac: ['Cadillac', '#C6A15B'],
};
// Prefer the curated short name; fall back to the worker's official name
// (present in standings rows), then the raw id as a last resort.
const teamName = (cid, fallback) => F1_TEAMS[cid]?.[0] ?? fallback ?? cid;
const teamColor = (cid) => F1_TEAMS[cid]?.[1] ?? '#7d8590';

// Ergast demonym -> ISO 3166 alpha-2 (F1 nationalities). Unknown -> no flag.
const NAT_ISO = {
  Argentine: 'AR', Australian: 'AU', Austrian: 'AT', Belgian: 'BE', Brazilian: 'BR', British: 'GB',
  Canadian: 'CA', Chinese: 'CN', Danish: 'DK', Dutch: 'NL', Finnish: 'FI', French: 'FR', German: 'DE',
  Italian: 'IT', Japanese: 'JP', Mexican: 'MX', Monegasque: 'MC', 'New Zealander': 'NZ', Polish: 'PL',
  Russian: 'RU', Spanish: 'ES', Swedish: 'SE', Swiss: 'CH', Thai: 'TH', American: 'US',
};
const flagOf = (nat) => {
  const iso = NAT_ISO[nat];
  if (!iso) return '';
  // flagcdn covers every ISO alpha-2 (ESPN's country set misses Monaco, so
  // Leclerc would lose his flag there). Keyless, CSP-clean (img-src https:).
  return `<img class="f1-flag" src="https://flagcdn.com/w40/${iso.toLowerCase()}.png" alt="" loading="lazy">`;
};

const dot = (cid) => `<span class="f1-dot" style="background:${teamColor(cid)}"></span>`;

// ---------------------------------------------------------------------------
// The next race's map, in two tiers.
//
// TIER 1 is Formula 1's own circuit diagram — the detailed sector-coloured one
// with the corner numbers, the DRS zones and the speed trap. It is HOTLINKED
// from F1's public media CDN and never committed: the artwork is F1's, and this
// repo is open source. That is the same posture the driver flags already take
// with flagcdn, and the same one the Home Assistant formulaone-card takes with
// these exact images. It is deliberately a hotlink and not a mirror, and it is
// fragile by construction: if F1 reshuffles its URLs, every one of these 404s
// at once. Which is the whole reason tier 2 exists.
//
// TIER 2 is site/data/f1-tracks.json: plain outlines derived from
// bacinger/f1-circuits (MIT, (c) 2019-2025 Tomislav Bacinger) by
// tools/build-f1-tracks.js and committed, so a board with no reach to F1's CDN
// still gets the shape of the place. It is what draws FIRST, at open, and F1's
// image replaces it only once it has decoded.
//
// Neither available: no map block at all, and the rest of the pillar is
// unaffected.
//
// The URL template and the slug list come from the formulaone-card's
// constants.ts + utils.ts (getCircuitName: the locality with its spaces
// removed, plus a handful of country exceptions). Keyed here off the digest's
// own circuitId rather than re-derived from country + locality, because the
// digest carries no locality and an explicit table cannot quietly put Barcelona
// under the Madrid Grand Prix. Every entry below was probed against the live
// CDN on 2026-08-02; the fifteen historical circuits in the bundled outline set
// have no modern diagram and are absent on purpose (they can never be the
// current season's next or last race anyway).
const F1_IMG = 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026track';
const F1_TRACK_SLUG = {
  albert_park: 'melbourne', americas: 'austin', bahrain: 'sakhir', baku: 'baku',
  catalunya: 'catalunya', hungaroring: 'hungaroring', imola: 'imola', interlagos: 'interlagos',
  jeddah: 'jeddah', losail: 'lusail', madring: 'madring', marina_bay: 'singapore',
  miami: 'miami', monaco: 'montecarlo', monza: 'monza', red_bull_ring: 'spielberg',
  rodriguez: 'mexicocity', sepang: 'kualalumpur', shanghai: 'shanghai', silverstone: 'silverstone',
  spa: 'spafrancorchamps', suzuka: 'suzuka', vegas: 'lasvegas', villeneuve: 'montreal',
  yas_marina: 'yasmarina', zandvoort: 'zandvoort',
};
export const trackImageUrl = (cid) =>
  (F1_TRACK_SLUG[cid] ? `${F1_IMG}${F1_TRACK_SLUG[cid]}detailed.webp` : '');

// The bundled outlines. Fetched ONCE beside the digest — a tap must never
// fetch — and read synchronously from here after. Missing file, or a boot
// before the first fetch: no outline, and tier 1 (or nothing) carries the map.
let tracks = null;

async function loadTracks(net) {
  if (tracks) return tracks;
  try {
    tracks = await net.fetchJSON('data/f1-tracks.json');
  } catch {
    tracks = {}; // one failed load is permanent for the session; a map is not worth retrying
  }
  return tracks;
}
// `_source` (the licence notice) shares the object with the circuits, so the
// shape is what says whether a key is a track.
const trackOf = (cid) => (cid && tracks?.[cid]?.d ? tracks[cid] : null);

// ---------------------------------------------------------------------------
// Dates and times. The digest carries plain YYYY-MM-DD dates and UTC times; the
// board reads them in ITS timezone at ITS 12/24h preference, through the same
// shared formatter every other clock reading on the board goes through.
// ---------------------------------------------------------------------------

// A parseable instant for a session. With a UTC time it is exact; date-only
// falls back to local noon, which is what the card's own fmtDate does — enough
// to name the right day, never used to print an o'clock.
export function sessionAt(date, time) {
  if (!date) return NaN;
  if (!time) return Date.parse(`${date}T12:00:00`);
  return Date.parse(`${date}T${time.endsWith('Z') ? time : `${time}Z`}`);
}

export function sessionWhen(date, time, clock24 = false) {
  const t = sessionAt(date, time);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return time ? `${day} · ${d.toLocaleTimeString('en-US', clockTimeOpts(clock24))}` : day;
}

// Calendar days between two instants, in LOCAL days — "tomorrow" is about the
// date on the wall, not about 24-hour blocks.
const dayGap = (from, to) =>
  Math.round(
    (new Date(to.getFullYear(), to.getMonth(), to.getDate())
      - new Date(from.getFullYear(), from.getMonth(), from.getDate())) / 86400000,
  );

// The countdown line. Race weekend gets the nearer-term wording, and a race
// already under way stops counting rather than saying "in 0 days".
export function lightsOut(date, time, now = new Date()) {
  const t = sessionAt(date, time);
  if (!Number.isFinite(t)) return '';
  const days = dayGap(now, new Date(t));
  if (days > 1) return `Lights out in ${days} days`;
  if (days === 1) return 'Lights out tomorrow';
  if (days === 0) return t > now.getTime() ? 'Lights out today' : 'Race under way';
  return '';
}

// "Last Sunday" while that still means something, a plain date once it doesn't.
export function lastWhen(date, now = new Date()) {
  const t = sessionAt(date, '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const days = -dayGap(now, d);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days <= 7) return `Last ${d.toLocaleDateString('en-US', { weekday: 'long' })}`;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// The full-screen season view (Sean's approved three-pillar mockup).
// ---------------------------------------------------------------------------

// The weekend as a reader wants it: when it STARTS, the sessions that decide
// something, and the race. The three practices are one line — "Practice" is the
// Friday you note, and FP2/FP3 are detail nobody reads across a room — while
// every sprint session earns its own row, because a sprint weekend is a
// different weekend. The digest sorts by date, so a sprint qualifying lands
// before its sprint and the Saturday qualifying after it, as it happens.
const DECIDERS = new Set(['sq', 'sprint', 'q', 'race']);
export function scheduleRows(sessions = []) {
  const out = [];
  let practice = false;
  for (const s of sessions) {
    if (String(s?.id ?? '').startsWith('fp')) {
      if (practice) continue;
      practice = true;
      out.push({ ...s, label: 'Practice' });
    } else if (DECIDERS.has(s?.id)) {
      out.push(s);
    }
  }
  return out;
}

// Ergast's non-finish statuses run to dozens of causes ("Collision damage",
// "Water leak"). None of them is legible as a cause at 6 ft, and none of them
// is what the reader is asking; three outcomes are.
const DNF_WORD = (status) => {
  if (/^disqualified/i.test(status)) return 'DSQ';
  if (/^(did not start|withdrew)/i.test(status)) return 'DNS';
  return 'DNF';
};
const LAPPED = /^\+\s*(\d+)\s+laps?$/i;

// The right-hand column of a classification row: the winner's total time, a
// gap, a lap deficit, or the failure. `bad` is the only place the board's --bad
// tone enters this view.
export function gapCell(r) {
  if (r?.time) return { text: r.time, bad: false };
  const lapped = LAPPED.exec(r?.status ?? '');
  if (lapped) return { text: `+${lapped[1]} lap${lapped[1] === '1' ? '' : 's'}`, bad: false };
  if (!r?.status || /^finished$/i.test(r.status)) return { text: '', bad: false };
  return { text: DNF_WORD(r.status), bad: true };
}

// The classification the view can actually show. A digest from before the
// worker's full-results half is deployed carries only `podium`, so the pillar
// degrades to three rows with no gap column rather than to nothing.
export function classification(vm) {
  if (vm?.results?.length) return vm.results;
  // The podium rows carry nationality already, so even the degraded pillar
  // keeps its flags. `grid`/`pts` stay UNDEFINED rather than 0 — that is what
  // tells the pillar it has no table to draw, not a table full of zeroes.
  return (vm?.podium ?? []).map((p) => ({
    pos: p.pos, driver: p.driver, nat: p.nat, cid: p.cid, time: '', status: '', fastest: false,
  }));
}

const vdot = (cid) => `<span class="f1v-dot" style="background:${teamColor(cid)}"></span>`;
// The card's flag, at the view's scale. Same flagcdn treatment, same NAT_ISO
// table, so a driver who has a flag on the card has one here (Sean, 2026-08-02).
const vflag = (nat) => flagOf(nat).replace('class="f1-flag"', 'class="f1v-flag"');

// Two plain paths, never a clipPath: gen1 Qt WebEngine has none, so colouring
// one segment of a line means splitting the line (DESIGN.md).
function trackSvg(cid, { tick = false } = {}) {
  const t = trackOf(cid);
  if (!t) return '';
  return `<svg viewBox="${escapeHtml(t.viewBox)}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <path class="f1v-track__line" d="${escapeHtml(t.d)}"/>
    ${tick ? `<path class="f1v-track__sf" d="${escapeHtml(t.sf)}"/>` : ''}
  </svg>`;
}

// Tier 1 over tier 2, once it has DECODED — the board's standing rule for any
// image swap, so the map appears whole instead of banding in top-down. The
// outline is already on screen, so there is nothing to wait for and no
// placeholder: this is an upgrade in place, not a load.
export function upgradeTrackImage(root, make = () => new Image()) {
  const box = root?.querySelector?.('.f1v-track__box[data-track-img]');
  if (!box) return Promise.resolve(false);
  const url = box.dataset.trackImg;
  const img = make();
  img.className = 'f1v-track__img';
  img.alt = '';
  return loadImage(img, url).then(() => {
    // The reader may have closed the view (or the idle timer may have) while
    // F1's CDN was thinking; the snapshot it belonged to is gone.
    if (!box.isConnected) return false;
    // loadImage resolves for a broken image too, on purpose. A decoded bitmap
    // is the only thing that earns the swap.
    if (img.naturalWidth === 0) {
      // Tier 2 keeps the block. With no outline under it there is nothing to
      // keep, and an empty frame is worse than no frame.
      if (!box.firstElementChild) box.closest('.f1v-track')?.remove();
      return false;
    }
    box.replaceChildren(img);
    return true;
  });
}

function nextPillar(vm, cfg) {
  const { next } = vm;
  if (!next?.name) return '';
  const rows = scheduleRows(next.sessions);
  const count = lightsOut(next.date, next.time, new Date());
  const t = trackOf(next.circuitId);
  const img = trackImageUrl(next.circuitId);
  const km = t?.m ? `${(t.m / 1000).toFixed(3)} km` : '';
  const label = [t?.name, km].filter(Boolean).join(' · ');
  return `<div class="f1v__pillar f1v__pillar--next">
    <h3 class="f1v__h">Next race${next.round ? ` · Round ${next.round}` : ''}</h3>
    <div class="f1v-gp">${escapeHtml(next.name)}</div>
    ${next.circuit ? `<div class="f1v-gp__sub">${escapeHtml(next.circuit)}</div>` : ''}
    ${rows.length ? `<div class="f1v-sessions">${rows.map((s) => `
      <div class="f1v-sess${s.id === 'race' ? ' f1v-sess--race' : ''}">
        <span>${escapeHtml(s.label ?? '')}</span>
        <b>${escapeHtml(sessionWhen(s.date, s.time, cfg?.clock24))}</b>
      </div>`).join('')}</div>` : ''}
    ${count ? `<div class="f1v-count">${escapeHtml(count)}</div>` : ''}
    ${t || img ? `<div class="f1v-track">
      <div class="f1v-track__box"${img ? ` data-track-img="${escapeHtml(img)}"` : ''}>${trackSvg(next.circuitId, { tick: true })}</div>
      ${label ? `<div class="f1v-track__lbl">${escapeHtml(label)}</div>` : ''}
    </div>` : ''}
  </div>`;
}

// Grid 0 is Ergast for a pit-lane start, which is a fact worth a word rather
// than a zero nobody can read.
export const gridCell = (grid) => (grid > 0 ? String(grid) : (grid === 0 ? 'PIT' : ''));

function lastPillar(vm) {
  const rows = classification(vm);
  if (!vm.lastRace && !rows.length) return '';
  const sub = [lastWhen(vm.lastDate), vm.lastCircuit].filter(Boolean).join(' · ');
  // The MINI map stays an outline, deliberately: F1's diagram is a detailed
  // drawing with corner numbers and named zones, and at 150px those become an
  // unreadable smudge. Here the shape is the whole job.
  const mini = trackSvg(vm.lastCircuitId);
  // The two numeric columns only exist once the digest carries them, so a
  // podium-only fallback stays the three plain rows it always was.
  const table = rows.some((r) => r.grid !== undefined || r.pts !== undefined);
  const cell = (v) => `<span class="f1v-cell">${escapeHtml(v)}</span>`;
  return `<div class="f1v__pillar f1v__pillar--last">
    <div class="f1v-last__head">
      <div class="f1v-last__id">
        <div class="f1v-last__name">${escapeHtml(vm.lastRace ?? 'Last race')}</div>
        ${sub ? `<div class="f1v-last__sub">${escapeHtml(sub)}</div>` : ''}
      </div>
      ${mini ? `<div class="f1v-minitrack">${mini}</div>` : ''}
    </div>
    <div class="f1v-res">
      ${table ? `<div class="f1v-rrow f1v-rrow--head">
        <span class="f1v-pos"></span><span class="f1v-drv"></span>
        ${cell('Grid')}${cell('Pts')}<span class="f1v-gap"></span>
      </div>` : ''}
      ${rows.map((r) => {
    const gap = gapCell(r);
    return `<div class="f1v-rrow">
        <span class="f1v-pos">${escapeHtml(String(r.pos ?? ''))}</span>
        <span class="f1v-drv">${vdot(r.cid)}${vflag(r.nat)}${escapeHtml(r.driver ?? '')}</span>
        ${table ? cell(gridCell(r.grid)) + cell(r.pts > 0 ? String(r.pts) : '') : ''}
        <span class="f1v-gap${gap.bad ? ' f1v-gap--dnf' : ''}${r.fastest ? ' f1v-gap--flap' : ''}">${escapeHtml(gap.text)}</span>
      </div>`;
  }).join('')}
    </div>
  </div>`;
}

// Drivers truncate at ten and constructors do not: the championship has one
// table that is a story (the front of the drivers' fight) and one that is a
// list, and all of the second fits beside the top of the first. The board's
// "+N" corner count is a CARD idiom and has no place inside a view, so the
// truncation is silent by design.
export const BOARD_DRIVERS = 10;

function standingsPillar(vm) {
  const { drivers = [], teams = [] } = vm;
  if (!drivers.length && !teams.length) return '';
  // A constructor is not a nationality anyone reads a flag for, so only the
  // drivers' table carries one — the same split the card makes.
  const row = (pos, cid, who, { nat = '', sub = '', wins = 0, pts } = {}) => `<div class="f1v-srow">
    <span class="f1v-pos">${escapeHtml(String(pos ?? ''))}</span>
    <span class="f1v-who">${vdot(cid)}${vflag(nat)}${escapeHtml(who)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</span>
    <span class="f1v-wins">${wins ? escapeHtml(`${wins}w`) : ''}</span>
    <span class="f1v-pts">${escapeHtml(String(pts ?? ''))}</span>
  </div>`;
  const block = (h, rows, cls = '') =>
    (rows ? `<div class="${cls}"><h3 class="f1v__h">${h}</h3>${rows}</div>` : '');
  return `<div class="f1v__pillar f1v__pillar--stand">
    ${block('Drivers', drivers.slice(0, BOARD_DRIVERS).map((s) => row(s.pos, s.cid, s.name, { nat: s.nat, sub: teamName(s.cid), wins: s.wins, pts: s.pts })).join(''))}
    ${block('Constructors', teams.map((s) => row(s.pos, s.cid, teamName(s.cid, s.name), { pts: s.pts })).join(''), 'f1v__stand2')}
  </div>`;
}

// The whole view. Returns '' when there is nothing to show, which is what tells
// render() not to register the tap.
export function f1Board(vm, cfg) {
  const pillars = nextPillar(vm, cfg) + lastPillar(vm) + standingsPillar(vm);
  return pillars ? `<div class="f1v">${pillars}</div>` : '';
}

export function render(el, vm, cfg) {
  // No "as of" stamp: F1 data only changes after a race (weekly), never
  // intraday, so a minute-resolution timestamp would be misleading noise.
  // Outage staleness is still shown by the card frame's .is-stale dimming.
  const { next, lastRace, podium, drivers = [], teams = [] } = vm;
  if (!next && !podium && !drivers.length && !teams.length) {
    el.innerHTML = '<div class="empty">F1 data unavailable</div>';
    setExpandSource(el, null); // nothing behind the tap either
    return;
  }
  // Below ~380px the card is too tight for secondary text: drop the circuit
  // name and podium team, and stack the two standings columns full-width so
  // surnames stay readable. Above it, standings sit side-by-side; the top few
  // of each fit even at the 3-wide minimum (long surnames may ellipsize).
  const narrow = el.clientWidth > 0 && el.clientWidth < 380;

  const nextBlock = next
    ? `<div class="f1-next">
         <div class="f1-next__hd"><span class="f1-next__tag">Next</span> ${escapeHtml(next.name)}</div>
         <div class="f1-next__meta">${escapeHtml(fmtDate(next.date))}${!narrow && next.circuit ? ` · ${escapeHtml(next.circuit)}` : ''}</div>
       </div>` : '';

  const podiumBlock = podium?.length
    ? `<div class="f1-sec"><div class="f1-sec__h">${escapeHtml(lastRace ?? 'Last race')} — podium</div>${
        podium.map((p) => `<div class="f1-row f1-row--p${p.pos}"><span class="f1-pos">${p.pos}</span>${dot(p.cid)}${flagOf(p.nat)}<span class="f1-name">${escapeHtml(p.driver)}</span>${narrow ? '' : `<span class="f1-team">${escapeHtml(teamName(p.cid))}</span>`}</div>`).join('')
      }</div>` : '';

  const driverRow = (s) => `<div class="f1-row"><span class="f1-pos">${s.pos}</span>${dot(s.cid)}${flagOf(s.nat)}<span class="f1-name">${escapeHtml(s.name)}</span><span class="f1-pts">${s.pts}</span></div>`;
  const teamRow = (s) => `<div class="f1-row"><span class="f1-pos">${s.pos}</span>${dot(s.cid)}<span class="f1-name">${escapeHtml(teamName(s.cid, s.name))}</span><span class="f1-pts">${s.pts}</span></div>`;
  const col = (h, rows) => `<div class="f1-col"><div class="f1-sec__h">${h}</div>${rows}</div>`;

  // Eight drivers beside eight constructors: the most the card ever deals.
  const STANDINGS_ROWS = 16;
  const build = (dn, cn) => {
    const dCol = drivers.length ? col('Drivers', drivers.slice(0, dn).map(driverRow).join('')) : '';
    const cCol = teams.length ? col('Constructors', teams.slice(0, cn).map(teamRow).join('')) : '';
    const stand = narrow ? dCol + cCol : `<div class="f1-cols">${dCol}${cCol}</div>`;
    return nextBlock + podiumBlock + stand;
  };

  // The standings are two columns dealing from ONE budget, so the fit counts
  // rows across both: the drivers column keeps the odd row (ceil), which is
  // exactly the old walk of "shrink whichever column is longer, constructors
  // first" written as arithmetic rather than as a loop of its own. Eight a side
  // is where it starts and where it stays wherever there is no layout to
  // measure (happy-dom); one a side is the floor. F1 has no capacity model,
  // this card not being a list, so STANDINGS_ROWS is both the start and the
  // fallback. The one pixel of tolerance is the one this card shipped with:
  // at zero it sheds a driver on a hairline overflow.
  fitList(el, {
    id: meta.id,
    fallback: STANDINGS_ROWS,
    min: 2,
    measure: true,
    slack: 1,
    draw: (n) => { el.innerHTML = build(Math.ceil(n / 2), Math.floor(n / 2)); },
  });

  // One card, one destination (the history precedent): every tap on a card with
  // any season on it opens the whole season, whatever the card had room for.
  // The predicate is exactly the union of the three pillars' own conditions, so
  // the affordance and the view can never disagree — a card that shows the
  // is-expandable treatment always has something behind the tap. The BODY is
  // built at tap time, which is what keeps "Lights out in N days" honest on a
  // board that has been up since the last refresh.
  const hasView = Boolean(next?.name || lastRace || classification(vm).length || drivers.length || teams.length);
  setExpandSource(el, hasView ? () => ({
    title: meta.title,
    note: vm.season ? `${vm.season} season` : '',
    bodyHtml: f1Board(vm, cfg),
    // The live body is the only way to reach the DOM a snapshot became. No fit
    // here: the outline is already drawn and correct, and the tier-1 image
    // replaces it in place if and when it decodes. Nothing waits on it and
    // nothing moves.
    onOpen: (body) => { upgradeTrackImage(body); },
  }) : null);
}

function fmtDate(iso) {
  const t = Date.parse(`${iso}T12:00:00`);
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : iso;
}

export async function fetchData(_cfg, net) {
  // The bundled outlines ride along with the digest so the expanded view never
  // fetches. Their load catches its own failures, so a missing file costs the
  // maps and nothing else — and the digest is what decides whether this throws.
  const [digest] = await Promise.all([net.fetchJSON(`${WORKER_URL}/f1`), loadTracks(net)]);
  return digest;
}
