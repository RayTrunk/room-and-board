/**
 * @vitest-environment happy-dom
 *
 * Formula 1: the full-screen season view (Sean's approved three-pillar mockup)
 * and the worker halves that feed it.
 *
 * The two sides ship together but DEPLOY apart — the site goes out with Pages
 * and the worker with a separate action — so for a window the boards run the
 * new view against the OLD digest. Every block here therefore has to be
 * provably optional: the pre-promote digest (podium only, no sessions, no
 * round, no circuitIds) has its own describe below, and it is the case that
 * actually runs on beta first.
 *
 * Time assertions derive from the SHARED formatter rather than from literal
 * strings: CI runs in UTC and a developer does not, and this repo has already
 * paid for that lesson once.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { closeExpand } from '../site/js/expand.js';
import { clockTimeOpts } from '../site/js/util.js';
import { mapF1 } from '../worker/src/f1.js';
// Namespace, so the scaffold can mount the REAL f1 card off the module's own
// meta instead of a hand-typed title.
import * as f1 from '../site/js/widgets/f1.js';
import { board as mountBoard } from './helpers/board.js';
import { simplify, circuitPath, buildTracks, ERGAST_ID } from '../tools/build-f1-tracks.js';

const {
  render, fetchData, f1Board, gapCell, gridCell, classification, scheduleRows,
  sessionWhen, sessionAt, lightsOut, lastWhen, trackImageUrl, upgradeTrackImage,
  BOARD_DRIVERS,
} = f1;

import nextFx from './worker/fixtures/f1-next.json';
import nextSprintFx from './worker/fixtures/f1-next-sprint.json';
import lastFx from './worker/fixtures/f1-last.json';
import lastFullFx from './worker/fixtures/f1-last-full.json';
import driversFx from './worker/fixtures/f1-drivers.json';
import teamsFx from './worker/fixtures/f1-teams.json';

// happy-dom swaps the global URL for a document-relative one, so node's own
// path helpers resolve repo files (the overlay-chrome idiom).
const here = dirname(fileURLToPath(import.meta.url));

// ===========================================================================
// 1. THE WORKER: what the digest has to carry for the view to be drawable
// ===========================================================================

describe('mapF1 forwards the season view\'s data', () => {
  const d = mapF1(nextFx, lastFullFx, driversFx, teamsFx);

  it('names the season and the round', () => {
    expect(d.season).toBe('2026');
    expect(d.next.round).toBe(10);
  });

  it('keys both track outlines by circuitId', () => {
    expect(d.next.circuitId).toBe('spa');
    expect(d.lastCircuitId).toBe('hungaroring');
    expect(d.lastCircuit).toBe('Hungaroring');
    expect(d.lastDate).toBe('2026-07-26');
  });

  it('forwards the weekend\'s sessions in the order they happen, race last', () => {
    expect(d.next.sessions.map((s) => s.id)).toEqual(['fp1', 'fp2', 'fp3', 'q', 'race']);
    expect(d.next.sessions.at(-1)).toEqual({ id: 'race', label: 'Race', date: '2026-07-19', time: '13:00:00Z' });
    // Dates and UTC times stay raw: a digest cached for an hour has no business
    // deciding what o'clock it is in the room the board is in.
    expect(d.next.sessions[0]).toEqual({ id: 'fp1', label: 'Practice 1', date: '2026-07-17', time: '11:30:00Z' });
    expect(d.next.time).toBe('13:00:00Z');
  });

  it('sorts a sprint weekend by DATE, not by the payload\'s key order', () => {
    // The payload lists Qualifying before Sprint; the weekend runs the other
    // way round, and a schedule that reads out of order is worse than none.
    const s = mapF1(nextSprintFx, lastFullFx, driversFx, teamsFx);
    expect(s.next.sessions.map((x) => x.id)).toEqual(['fp1', 'sq', 'sprint', 'q', 'race']);
    expect(s.next.circuitId).toBe('americas');
  });

  it('forwards the FULL classification as a table, not just the podium', () => {
    expect(d.results).toHaveLength(20);
    expect(d.results[0]).toEqual({
      pos: 1, driver: 'Norris', nat: 'British', cid: 'mclaren',
      grid: 1, pts: 0, time: '1:35:22.104', status: 'Finished', fastest: false,
    });
    expect(d.results.map((r) => r.pos)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    // Grid, race points and nationality on every row — the view draws a
    // starting position, a score and a flag per driver.
    expect(d.results.every((r) => typeof r.grid === 'number' && typeof r.pts === 'number')).toBe(true);
    expect(d.results.every((r) => typeof r.nat === 'string' && r.nat)).toBe(true);
  });

  it('reads a pit-lane start as the zero Ergast writes for it', () => {
    const pitFx = structuredClone(lastFullFx);
    pitFx.MRData.RaceTable.Races[0].Results[19].grid = '0';
    const r = mapF1(nextFx, pitFx, null, null).results.at(-1);
    expect(r.grid).toBe(0);
    expect(gridCell(r.grid)).toBe('PIT'); // ...and the view says so in a word
    expect(gridCell(4)).toBe('4');
    expect(gridCell(undefined)).toBe('');
  });

  it('forwards the points scored in the RACE, not the championship total', () => {
    const ptsFx = structuredClone(lastFullFx);
    ptsFx.MRData.RaceTable.Races[0].Results[0].points = '25';
    ptsFx.MRData.RaceTable.Races[0].Results[1].points = '18';
    const r = mapF1(nextFx, ptsFx, null, null).results;
    expect([r[0].pts, r[1].pts, r[19].pts]).toEqual([25, 18, 0]);
  });

  it('marks the fastest lap of the RACE, once', () => {
    // FastestLap.rank is the field's ranking, not the driver's own best lap:
    // every finisher has a FastestLap block and exactly one has rank 1.
    expect(d.results.filter((r) => r.fastest).map((r) => r.driver)).toEqual(['Piastri']);
  });

  it('forwards the statuses a lapped or retired car has instead of a time', () => {
    const by = Object.fromEntries(d.results.map((r) => [r.driver, r]));
    expect(by.Bortoleto).toMatchObject({ time: '', status: '+1 Lap' });
    expect(by.Colapinto).toMatchObject({ time: '', status: '+2 Laps' });
    expect(by.Tsunoda).toMatchObject({ time: '', status: 'Collision damage' });
    expect(by.Hulkenberg).toMatchObject({ time: '', status: 'Accident', fastest: false });
  });

  it('leaves the CARD\'s podium exactly as it was', () => {
    // Four fields, in the shape the card destructures. The full classification
    // sits BESIDE it and must never replace it — a card reading `podium` is
    // what the boards run today.
    expect(d.podium).toHaveLength(3);
    expect(d.podium[0]).toEqual({ pos: 1, driver: 'Norris', nat: 'British', cid: 'mclaren' });
    expect(d.podium.every((p) => Object.keys(p).length === 4)).toBe(true);
  });

  it('adds each driver\'s win count beside the points', () => {
    expect(d.drivers[0]).toMatchObject({ pos: 1, name: 'Antonelli', wins: 5 });
    expect(d.drivers.every((s) => typeof s.wins === 'number')).toBe(true);
  });

  it('degrades per-block rather than throwing', () => {
    const empty = mapF1(null, null, null, null);
    expect(empty).toMatchObject({ season: null, next: null, lastRace: null, podium: null, results: [] });
    expect(empty.lastCircuitId).toBeNull();
    // A next race with no sessions and no round at all (an early-calendar
    // payload) still maps — the view drops the blocks it cannot fill.
    const bare = mapF1({ MRData: { RaceTable: { Races: [{ raceName: 'X', date: '2026-09-06' }] } } }, null, driversFx, null);
    expect(bare.next).toMatchObject({ name: 'X', round: null, circuitId: '' });
    expect(bare.next.sessions.map((s) => s.id)).toEqual(['race']);
    // ...and the season still comes off whichever block did answer.
    expect(bare.season).toBe('2026');
  });
});

// ===========================================================================
// 2. THE VIEW
// ===========================================================================

// A tiny outline set, so the view tests do not depend on the vendored file
// having been generated. The real one is shape-checked at the bottom.
const TRACKS = {
  _source: { license: 'MIT' },
  spa: { d: 'M10 10L90 10L90 60L10 60Z', viewBox: '0 0 100 70', sf: 'M20 4L20 16', name: 'Spa Francorchamps', m: 7004 },
  hungaroring: { d: 'M5 5L80 5L80 50Z', viewBox: '0 0 90 60', sf: 'M12 0L12 10', name: 'Budapest', m: 4381 },
};

const digest = () => mapF1(nextFx, lastFullFx, driversFx, teamsFx);

// Loads the module-level outline cache the same way a board does — through
// fetchData — because the view must never fetch at tap time.
async function primeTracks(tracks = TRACKS) {
  await fetchData({}, {
    fetchJSON: async (u) => (u.includes('f1-tracks') ? structuredClone(tracks) : digest()),
  });
}

// The outline cache is module state and survives the whole file, so the cases
// that need it COLD get their own module instance. Only the pure builders are
// used from it — the DOM harness stays on the statically imported one.
async function coldF1() {
  vi.resetModules();
  return import('../site/js/widgets/f1.js');
}

// A real <img> element that never touches the network: happy-dom neither
// fetches nor decodes, so the decode promise and `naturalWidth` are driven
// here the way an engine drives them. naturalWidth is what separates a decoded
// bitmap from a 404, and it is what the upgrade actually reads.
const makeImg = (ok) => {
  const img = document.createElement('img');
  Object.defineProperty(img, 'naturalWidth', { value: ok ? 1252 : 0, configurable: true });
  img.decode = () => (ok ? Promise.resolve() : Promise.reject(new Error('decode failed')));
  return img;
};
// `new Image()` returns whatever the constructor returns, so this hands the
// production path (which has no injection point of its own) a real element.
const stubImage = ({ ok = true } = {}) => {
  const made = [];
  vi.stubGlobal('Image', function StubImage() {
    const img = makeImg(ok);
    made.push(img);
    return img;
  });
  return made;
};

// A one-card board with the delegated expand listener wired, as main.js does.
const board = (vm, cfg = {}) => mountBoard(f1, { rect: { w: 4, h: 4 }, vm, cfg });

const overlay = () => document.querySelector('#expand-view');
const text = () => overlay().textContent.replace(/\s+/g, ' ').trim();

beforeEach(() => {
  closeExpand();
  document.body.innerHTML = '';
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('the three pillars', () => {
  let html;
  beforeEach(async () => {
    await primeTracks();
    html = f1Board(digest(), {});
  });

  it('draws all three, at the mockup\'s widths', () => {
    for (const cls of ['f1v__pillar--next', 'f1v__pillar--last', 'f1v__pillar--stand']) {
      expect(html).toContain(cls);
    }
  });

  it('leads the next race with its round, name and circuit', () => {
    expect(html).toContain('Next race · Round 10');
    expect(html).toContain('Belgian Grand Prix');
    expect(html).toContain('Circuit de Spa-Francorchamps');
  });

  it('shows the whole classification, twenty rows, one per finisher and retiree', () => {
    const el = document.createElement('div');
    el.innerHTML = html;
    const rows = [...el.querySelectorAll('.f1v-rrow:not(.f1v-rrow--head)')];
    expect(rows).toHaveLength(20);
    expect(el.textContent).toContain('Hulkenberg');
  });

  it('lays the classification out as a table, with one quiet word per column', () => {
    const el = document.createElement('div');
    el.innerHTML = html;
    const head = el.querySelector('.f1v-rrow--head');
    expect([...head.querySelectorAll('.f1v-cell')].map((n) => n.textContent)).toEqual(['Grid', 'Pts']);
    // Every row carries the same five slots, so the columns line up.
    const first = el.querySelector('.f1v-rrow:not(.f1v-rrow--head)');
    expect(first.querySelector('.f1v-pos').textContent).toBe('1');
    expect([...first.querySelectorAll('.f1v-cell')]).toHaveLength(2);
    expect(first.querySelector('.f1v-gap').textContent).toBe('1:35:22.104');
  });

  it('scores only the drivers who scored', () => {
    const vm = digest();
    vm.results[0].pts = 25;
    vm.results[1].pts = 18;
    const el = document.createElement('div');
    el.innerHTML = f1Board(vm, {});
    const pts = [...el.querySelectorAll('.f1v-rrow:not(.f1v-rrow--head)')]
      .map((r) => r.querySelectorAll('.f1v-cell')[1].textContent);
    expect(pts.slice(0, 2)).toEqual(['25', '18']);
    // A column of zeroes down the back half is noise, not information.
    expect(pts.slice(2).every((p) => p === '')).toBe(true);
  });

  it('shows where every driver started', () => {
    const el = document.createElement('div');
    el.innerHTML = html;
    const grids = [...el.querySelectorAll('.f1v-rrow:not(.f1v-rrow--head)')]
      .map((r) => r.querySelectorAll('.f1v-cell')[0].textContent);
    expect(grids).toEqual(digest().results.map((r) => String(r.grid)));
  });

  it('flies the card\'s flags in both the results and the drivers\' table', () => {
    const el = document.createElement('div');
    el.innerHTML = html;
    const flags = [...el.querySelectorAll('.f1v-flag')];
    expect(flags.length).toBeGreaterThan(20);
    expect(flags.every((f) => f.getAttribute('src').startsWith('https://flagcdn.com/'))).toBe(true);
    // One per classification row and one per drivers-standings row...
    expect(el.querySelectorAll('.f1v-rrow:not(.f1v-rrow--head) .f1v-flag')).toHaveLength(20);
    const shown = Math.min(BOARD_DRIVERS, digest().drivers.length);
    expect(el.querySelectorAll('.f1v__pillar--stand .f1v-srow')).toHaveLength(shown + digest().teams.length);
    expect(el.querySelectorAll('.f1v__pillar--stand .f1v-flag')).toHaveLength(shown);
    // ...and never on a constructor, which has no nationality anyone reads.
    const stand = el.querySelector('.f1v__stand2');
    expect(stand.querySelectorAll('.f1v-flag')).toHaveLength(0);
    expect(stand.querySelectorAll('.f1v-dot').length).toBeGreaterThan(0);
    // The flag follows the team dot, as it does on the card.
    const drv = el.querySelector('.f1v-rrow:not(.f1v-rrow--head) .f1v-drv');
    expect([...drv.children].map((n) => n.className)).toEqual(['f1v-dot', 'f1v-flag']);
    expect(drv.textContent.trim()).toBe('Norris');
  });

  it('leaves a driver with no mapped nationality flagless rather than broken', () => {
    const vm = digest();
    vm.results[0].nat = 'Martian';
    const el = document.createElement('div');
    el.innerHTML = f1Board(vm, {});
    const first = el.querySelector('.f1v-rrow:not(.f1v-rrow--head)');
    expect(first.querySelector('.f1v-flag')).toBeNull();
    expect(first.textContent).toContain('Norris');
  });

  it('gives the drivers ten rows and the constructors all of theirs', () => {
    const el = document.createElement('div');
    el.innerHTML = html;
    const stand = el.querySelector('.f1v__pillar--stand');
    const [dCount, cCount] = [...stand.children].map((b) => b.querySelectorAll('.f1v-srow').length);
    expect(dCount).toBe(Math.min(BOARD_DRIVERS, digest().drivers.length));
    expect(cCount).toBe(digest().teams.length);
    expect(stand.textContent).toContain('Drivers');
    expect(stand.textContent).toContain('Constructors');
  });

  it('puts a win count beside the leaders and nothing beside the winless', () => {
    const el = document.createElement('div');
    el.innerHTML = html;
    const wins = [...el.querySelectorAll('.f1v__pillar--stand .f1v-srow .f1v-wins')].map((n) => n.textContent);
    expect(wins[0]).toBe('5w');                        // Antonelli, 5 wins
    expect(wins.some((w) => w === '')).toBe(true);     // a winless driver's column is empty, not "0w"
  });
});

describe('the classification\'s right-hand column', () => {
  it('reads the winner\'s total time and everyone else\'s gap', () => {
    expect(gapCell({ time: '1:35:22.104', status: 'Finished' })).toEqual({ text: '1:35:22.104', bad: false });
    expect(gapCell({ time: '+4.821', status: 'Finished' })).toEqual({ text: '+4.821', bad: false });
  });

  it('says laps down in the plural the number earns', () => {
    expect(gapCell({ time: '', status: '+1 Lap' })).toEqual({ text: '+1 lap', bad: false });
    expect(gapCell({ time: '', status: '+2 Laps' })).toEqual({ text: '+2 laps', bad: false });
  });

  it('collapses every mechanical cause into the outcome a reader wants', () => {
    // Ergast has dozens of causes ("Water leak", "Collision damage"); none is
    // legible at 6 ft and none is the question being asked.
    for (const s of ['Accident', 'Engine', 'Collision damage', 'Retired', 'Puncture']) {
      expect(gapCell({ time: '', status: s })).toEqual({ text: 'DNF', bad: true });
    }
    expect(gapCell({ time: '', status: 'Disqualified' })).toEqual({ text: 'DSQ', bad: true });
    expect(gapCell({ time: '', status: 'Did not start' })).toEqual({ text: 'DNS', bad: true });
    expect(gapCell({ time: '', status: 'Withdrew' })).toEqual({ text: 'DNS', bad: true });
  });

  it('leaves the column blank rather than inventing one', () => {
    expect(gapCell({ time: '', status: '' })).toEqual({ text: '', bad: false });
    expect(gapCell({ time: '', status: 'Finished' })).toEqual({ text: '', bad: false });
    expect(gapCell(undefined)).toEqual({ text: '', bad: false });
  });

  it('is the ONLY place --bad enters the view, and it lands on the retirees', async () => {
    await primeTracks();
    const el = document.createElement('div');
    el.innerHTML = f1Board(digest(), {});
    const dnf = [...el.querySelectorAll('.f1v-gap--dnf')];
    expect(dnf.map((n) => n.textContent)).toEqual(['DNF', 'DNF']);
    // The lapped cars are NOT failures and keep the quiet tone.
    expect(el.textContent).toContain('+1 lap');
    expect([...el.querySelectorAll('.f1v-gap--dnf')].some((n) => n.textContent.includes('lap'))).toBe(false);
  });

  it('marks the fastest lap in F1 purple, on exactly one row', async () => {
    await primeTracks();
    const el = document.createElement('div');
    el.innerHTML = f1Board(digest(), {});
    const flap = [...el.querySelectorAll('.f1v-gap--flap')];
    expect(flap).toHaveLength(1);
    expect(flap[0].textContent).toBe('+4.821'); // Piastri's gap, in purple
    // A retirement can never also hold the fastest lap, so the two tones
    // cannot collide on one row.
    expect(flap[0].classList.contains('f1v-gap--dnf')).toBe(false);
  });
});

describe('the weekend schedule', () => {
  it('folds three practices into one line and keeps every sprint session', () => {
    const normal = mapF1(nextFx, null, null, null).next.sessions;
    expect(scheduleRows(normal).map((s) => s.label)).toEqual(['Practice', 'Qualifying', 'Race']);
    const sprint = mapF1(nextSprintFx, null, null, null).next.sessions;
    expect(scheduleRows(sprint).map((s) => s.label))
      .toEqual(['Practice', 'Sprint Qualifying', 'Sprint', 'Qualifying', 'Race']);
  });

  it('emphasises the race row and no other', async () => {
    await primeTracks();
    const el = document.createElement('div');
    el.innerHTML = f1Board(digest(), {});
    const rows = [...el.querySelectorAll('.f1v-sess')];
    expect(rows).toHaveLength(3);
    const race = rows.filter((r) => r.classList.contains('f1v-sess--race'));
    expect(race).toHaveLength(1);
    expect(race[0].textContent).toContain('Race');
  });

  it('formats each session in the board\'s timezone at the board\'s clock', () => {
    // Derived from the SHARED formatter, never from a literal: CI runs UTC.
    const at = sessionAt('2026-07-19', '13:00:00Z');
    const d = new Date(at);
    const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    for (const clock24 of [false, true]) {
      expect(sessionWhen('2026-07-19', '13:00:00Z', clock24))
        .toBe(`${day} · ${d.toLocaleTimeString('en-US', clockTimeOpts(clock24))}`);
    }
    // ...and the two preferences really do differ, so this is testing something.
    expect(sessionWhen('2026-07-19', '13:00:00Z', true))
      .not.toBe(sessionWhen('2026-07-19', '13:00:00Z', false));
  });

  it('names the day alone when the payload gave no time', () => {
    const d = new Date(sessionAt('2026-07-19', ''));
    expect(sessionWhen('2026-07-19', ''))
      .toBe(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
    expect(sessionWhen('', '')).toBe('');
    expect(sessionWhen('not-a-date', '')).toBe('');
  });

  it('carries the board\'s 24-hour preference from cfg into the rows', async () => {
    await primeTracks();
    const vm = digest();
    const race = vm.next.sessions.at(-1);
    expect(f1Board(vm, { clock24: true })).toContain(sessionWhen(race.date, race.time, true));
    expect(f1Board(vm, { clock24: false })).toContain(sessionWhen(race.date, race.time, false));
  });
});

describe('the countdown', () => {
  const RACE = ['2026-07-19', '13:00:00Z'];
  const at = (iso) => new Date(iso);

  it('counts whole calendar days out, then switches to the near words', () => {
    expect(lightsOut(...RACE, at('2026-06-28T09:00:00Z'))).toBe('Lights out in 21 days');
    expect(lightsOut(...RACE, at('2026-07-18T23:00:00Z'))).toBe('Lights out tomorrow');
    expect(lightsOut(...RACE, at('2026-07-19T06:00:00Z'))).toBe('Lights out today');
  });

  it('stops counting once the race has started', () => {
    expect(lightsOut(...RACE, at('2026-07-19T14:00:00Z'))).toBe('Race under way');
    expect(lightsOut(...RACE, at('2026-07-20T09:00:00Z'))).toBe('');
  });

  it('says nothing at all without a date', () => {
    expect(lightsOut('', '', at('2026-07-01T00:00:00Z'))).toBe('');
    expect(lightsOut(undefined, undefined, at('2026-07-01T00:00:00Z'))).toBe('');
  });

  it('dates the last race in the words a week allows', () => {
    expect(lastWhen('2026-07-26', at('2026-07-26T20:00:00Z'))).toBe('Today');
    expect(lastWhen('2026-07-26', at('2026-07-27T20:00:00Z'))).toBe('Yesterday');
    expect(lastWhen('2026-07-26', at('2026-07-29T20:00:00Z'))).toMatch(/^Last /);
    // Past a week "last Sunday" is a lie, so it becomes a plain date.
    expect(lastWhen('2026-07-26', at('2026-08-20T20:00:00Z'))).not.toMatch(/^Last /);
    expect(lastWhen('', at('2026-08-20T20:00:00Z'))).toBe('');
  });
});

describe('the map, tier 2: the bundled outline', () => {
  it('draws the next race\'s circuit large, with a start/finish tick', async () => {
    await primeTracks();
    const el = document.createElement('div');
    el.innerHTML = f1Board(digest(), {});
    const svg = el.querySelector('.f1v-track__box svg');
    expect(svg.getAttribute('viewBox')).toBe(TRACKS.spa.viewBox);
    expect(svg.querySelector('.f1v-track__line').getAttribute('d')).toBe(TRACKS.spa.d);
    // Two plain paths, never a clipPath: gen1 Qt WebEngine has none.
    expect(svg.querySelector('.f1v-track__sf').getAttribute('d')).toBe(TRACKS.spa.sf);
    expect(el.innerHTML).not.toContain('clipPath');
    // The quiet label carries what the data actually supports: the circuit and
    // its lap distance. Lap COUNT is in no payload we fetch, so it is not shown.
    expect(el.querySelector('.f1v-track__lbl').textContent.trim()).toBe('Spa Francorchamps · 7.004 km');
  });

  it('draws the last race\'s circuit small and tickless, and never as F1\'s diagram', async () => {
    await primeTracks();
    const el = document.createElement('div');
    el.innerHTML = f1Board(digest(), {});
    const mini = el.querySelector('.f1v-minitrack svg');
    expect(mini.querySelector('.f1v-track__line').getAttribute('d')).toBe(TRACKS.hungaroring.d);
    expect(mini.querySelector('.f1v-track__sf')).toBeNull();
    // At 150px the detailed diagram's corner numbers and named zones would be
    // an unreadable smudge; the mini map is a shape, on purpose.
    expect(el.querySelectorAll('[data-track-img]')).toHaveLength(1);
  });

  it('drops the map when it has neither tier, and keeps everything else', async () => {
    await primeTracks();
    const vm = digest();
    vm.next.circuitId = 'a-circuit-nobody-bundled'; // no outline AND no F1 slug
    vm.lastCircuitId = '';
    const el = document.createElement('div');
    el.innerHTML = f1Board(vm, {});
    expect(el.querySelector('.f1v-track')).toBeNull();
    expect(el.querySelector('.f1v-minitrack')).toBeNull();
    expect(el.textContent).toContain('Belgian Grand Prix');   // pillar 1 otherwise intact
    expect(el.querySelectorAll('.f1v-rrow')).toHaveLength(21); // pillar 2 untouched (20 + head)
  });

  it('drops every outline when the bundled file will not load, and still opens', async () => {
    const m = await coldF1();
    await m.fetchData({}, {
      fetchJSON: async (u) => {
        if (u.includes('f1-tracks')) throw new Error('404');
        return digest();
      },
    });
    const el = document.createElement('div');
    el.innerHTML = m.f1Board(digest(), {});
    expect(el.querySelector('svg')).toBeNull();
    expect(el.querySelectorAll('.f1v__pillar')).toHaveLength(3);
    // ...and tier 1 still gets its chance: the box is there, waiting for it.
    expect(el.querySelector('.f1v-track__box[data-track-img]')).not.toBeNull();
  });

  it('never lets the digest\'s failure take the outlines\' load with it', async () => {
    const m = await coldF1();
    const calls = [];
    await expect(m.fetchData({}, {
      fetchJSON: async (u) => {
        calls.push(u);
        if (u.includes('f1-tracks')) return structuredClone(TRACKS);
        throw new Error('worker down');
      },
    })).rejects.toThrow('worker down');
    expect(calls.some((u) => u.includes('f1-tracks'))).toBe(true);
  });
});

describe('the map, tier 1: F1\'s own circuit diagram', () => {
  beforeEach(async () => { await primeTracks(); });

  it('builds the CDN url from the circuitId, and only for circuits it has', () => {
    // Probed against the live CDN 2026-08-02. The slug is the locality with its
    // spaces removed, plus F1's own exceptions (Spa, Barcelona, Singapore...).
    expect(trackImageUrl('spa')).toBe(
      'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026trackspafrancorchampsdetailed.webp',
    );
    expect(trackImageUrl('catalunya')).toContain('2026trackcatalunyadetailed.webp');
    expect(trackImageUrl('marina_bay')).toContain('2026tracksingaporedetailed.webp');
    expect(trackImageUrl('vegas')).toContain('2026tracklasvegasdetailed.webp');
    expect(trackImageUrl('monaco')).toContain('2026trackmontecarlodetailed.webp');
    // Historical circuits have no modern diagram, and neither has a typo.
    expect(trackImageUrl('portimao')).toBe('');
    expect(trackImageUrl('nurburgring')).toBe('');
    expect(trackImageUrl('')).toBe('');
    expect(trackImageUrl(undefined)).toBe('');
  });

  it('hotlinks and never bundles: every url is F1\'s https CDN', () => {
    const el = document.createElement('div');
    el.innerHTML = f1Board(digest(), {});
    const url = el.querySelector('[data-track-img]').dataset.trackImg;
    expect(url.startsWith('https://media.formula1.com/')).toBe(true);
  });

  it('swaps the diagram in over the outline once it has DECODED', async () => {
    stubImage({ ok: true });
    const el = document.createElement('div');
    el.innerHTML = f1Board(digest(), {});
    const box = el.querySelector('.f1v-track__box');
    document.body.append(el); // isConnected: the view is on screen
    expect(box.querySelector('svg')).not.toBeNull(); // tier 2 draws first, always
    await expect(upgradeTrackImage(el)).resolves.toBe(true);
    expect(box.querySelector('svg')).toBeNull();
    expect(box.querySelector('img.f1v-track__img').src).toContain('2026trackspafrancorchampsdetailed.webp');
  });

  it('keeps the outline when F1\'s image will not load', async () => {
    stubImage({ ok: false });
    const el = document.createElement('div');
    el.innerHTML = f1Board(digest(), {});
    document.body.append(el);
    await expect(upgradeTrackImage(el)).resolves.toBe(false);
    // The fallback chain's whole point: a dead hotlink costs the detail, never
    // the map. This is also what a board with no reach to F1's CDN sees.
    expect(el.querySelector('.f1v-track__box svg .f1v-track__line')).not.toBeNull();
    expect(el.querySelector('img.f1v-track__img')).toBeNull();
  });

  it('drops the block when the image fails and there was no outline under it', async () => {
    const m = await coldF1();
    await m.fetchData({}, { fetchJSON: async (u) => { if (u.includes('f1-tracks')) throw new Error('404'); return digest(); } });
    stubImage({ ok: false });
    const el = document.createElement('div');
    el.innerHTML = m.f1Board(digest(), {});
    document.body.append(el);
    await m.upgradeTrackImage(el);
    expect(el.querySelector('.f1v-track')).toBeNull(); // an empty frame is worse than no frame
    expect(el.querySelectorAll('.f1v__pillar')).toHaveLength(3);
  });

  it('does nothing to a view the reader has already closed', async () => {
    stubImage({ ok: true });
    const el = document.createElement('div');
    el.innerHTML = f1Board(digest(), {});
    // Never appended: not connected, exactly as a snapshot is after closeExpand.
    await expect(upgradeTrackImage(el)).resolves.toBe(false);
    expect(el.querySelector('img.f1v-track__img')).toBeNull();
    expect(el.querySelector('.f1v-track__box svg')).not.toBeNull();
  });

  it('is wired to the overlay, so a real tap upgrades a real view', async () => {
    const made = stubImage({ ok: true });
    const b = board(digest());
    b.card.click();
    expect(overlay().querySelector('.f1v-track__box svg')).not.toBeNull();
    await vi.waitFor(() => {
      expect(overlay().querySelector('img.f1v-track__img')).not.toBeNull();
    });
    expect(made).toHaveLength(1); // one image, once, per open
  });
});

// ===========================================================================
// 3. THE PRE-PROMOTE DIGEST — what a board actually renders on beta first
// ===========================================================================

describe('a digest from before the worker half deployed', () => {
  // Exactly today's prod shape: no season, no round, no circuitIds, no
  // sessions, no results, no wins.
  const oldDigest = () => {
    const d = mapF1(nextFx, lastFx, driversFx, teamsFx);
    delete d.season;
    delete d.results;
    delete d.lastDate;
    delete d.lastCircuit;
    delete d.lastCircuitId;
    d.next = { name: d.next.name, date: d.next.date, circuit: d.next.circuit, country: d.next.country };
    d.drivers = d.drivers.map(({ wins, ...rest }) => rest);
    return d;
  };

  beforeEach(async () => { await primeTracks(); });

  it('still opens all three pillars', () => {
    const el = document.createElement('div');
    el.innerHTML = f1Board(oldDigest(), {});
    expect(el.querySelectorAll('.f1v__pillar')).toHaveLength(3);
  });

  it('drops the round, the schedule and BOTH map tiers, and keeps the countdown', () => {
    const el = document.createElement('div');
    el.innerHTML = f1Board(oldDigest(), {});
    expect(el.querySelector('.f1v__h').textContent).toBe('Next race'); // no "· Round N"
    expect(el.querySelector('.f1v-sessions')).toBeNull();
    // No circuitId means neither tier has a key: no outline and no CDN url.
    expect(el.querySelector('.f1v-track')).toBeNull();
    expect(el.querySelector('[data-track-img]')).toBeNull();
  });

  it('still counts the days down, on the date the old digest does carry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T12:00:00Z')); // the fixture race is the 19th
    const el = document.createElement('div');
    el.innerHTML = f1Board(oldDigest(), {});
    expect(el.querySelector('.f1v-count').textContent).toBe('Lights out in 9 days');
  });

  it('degrades the classification to the podium it does have, flags and all', () => {
    const el = document.createElement('div');
    el.innerHTML = f1Board(oldDigest(), {});
    const rows = [...el.querySelectorAll('.f1v-rrow')];
    expect(rows).toHaveLength(3);
    expect(el.querySelector('.f1v-rrow--head')).toBeNull(); // no grid/points to head
    expect(rows[0].textContent).toContain('Leclerc');
    // No time, no gap, no fastest lap, no table columns — but the row is a row,
    // with its team dot AND its flag, which the podium already carried.
    expect(rows.every((r) => r.querySelector('.f1v-gap').textContent === '')).toBe(true);
    expect(rows.every((r) => r.querySelectorAll('.f1v-cell').length === 0)).toBe(true);
    expect(rows[0].querySelector('.f1v-dot')).not.toBeNull();
    expect(rows[0].querySelector('.f1v-flag')).not.toBeNull();
  });

  it('is what `classification` chooses between, and it prefers the full set', () => {
    expect(classification(oldDigest())).toHaveLength(3);
    expect(classification(digest())).toHaveLength(20);
    expect(classification({})).toEqual([]);
  });

  it('leaves the wins column empty rather than printing "undefinedw"', () => {
    const el = document.createElement('div');
    el.innerHTML = f1Board(oldDigest(), {});
    const wins = [...el.querySelectorAll('.f1v__pillar--stand .f1v-wins')];
    expect(wins.length).toBeGreaterThan(0);
    expect(wins.every((n) => n.textContent === '')).toBe(true);
    expect(el.textContent).not.toMatch(/undefined|NaN/);
  });

  it('names no season in the overlay note', async () => {
    const b = board(oldDigest());
    b.card.click();
    expect(document.querySelector('.expand__note')).toBeNull();
  });
});

// ===========================================================================
// 4. REGISTRATION
// ===========================================================================

describe('one card, one destination', () => {
  beforeEach(async () => { await primeTracks(); });

  it('opens the season from a tap anywhere on the card', () => {
    const b = board(digest());
    expect(b.card.classList.contains('is-expandable')).toBe(true);
    b.card.click();
    expect(overlay().hidden).toBe(false);
    expect(document.querySelector('.expand__title').textContent).toBe('Formula 1');
    expect(document.querySelector('.expand__note').textContent).toBe('2026 season');
    expect(document.querySelector('.expand__hint').textContent).toBe('Tap anywhere to close');
    expect(text()).toContain('Belgian Grand Prix');
    expect(text()).toContain('Constructors');
  });

  it('clears the registration on the empty path', () => {
    const b = board(digest());
    expect(b.card.classList.contains('is-expandable')).toBe(true);
    b.render({ next: null, lastRace: null, podium: null, drivers: [], teams: [] });
    expect(b.body.textContent).toContain('F1 data unavailable');
    expect(b.card.classList.contains('is-expandable')).toBe(false);
    b.card.click();
    expect(overlay()?.hidden ?? true).toBe(true);
  });

  it('registers on any ONE pillar\'s worth of content', () => {
    for (const vm of [
      { next: { name: 'Belgian Grand Prix', date: '2026-07-19' } },
      { podium: [{ pos: 1, driver: 'Norris', cid: 'mclaren' }] },
      { drivers: [{ pos: 1, name: 'Norris', cid: 'mclaren', pts: 275, wins: 6 }] },
      { teams: [{ pos: 1, cid: 'mclaren', name: 'McLaren', pts: 526 }] },
    ]) {
      const b = board(vm);
      expect(b.card.classList.contains('is-expandable'), JSON.stringify(vm)).toBe(true);
      b.card.click();
      expect(overlay().hidden).toBe(false);
      expect(overlay().querySelector('.f1v__pillar')).not.toBeNull();
      closeExpand();
    }
  });

  it('never shows the affordance with nothing behind it', () => {
    // The card's own empty test and the view's are not identical — a `next`
    // object with no raceName is truthy to one and empty to the other. The
    // predicate is the view's, so the two can never disagree.
    const b = board({ next: {}, lastRace: null, podium: null, drivers: [], teams: [] });
    expect(b.card.classList.contains('is-expandable')).toBe(false);
    b.card.click();
    expect(overlay()?.hidden ?? true).toBe(true);
  });

  it('builds the countdown at TAP time, not at render time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T12:00:00Z'));
    const b = board(digest());
    vi.setSystemTime(new Date('2026-07-18T12:00:00Z'));
    b.card.click();
    // Rendered on the 1st, tapped on the 18th: the line is the 18th's.
    expect(text()).toContain('Lights out tomorrow');
  });
});

// ===========================================================================
// 5. THE VENDORED OUTLINES
// ===========================================================================

describe('the outline builder', () => {
  it('keeps the endpoints and drops what is within tolerance of the line', () => {
    const line = [[0, 0], [10, 0.2], [20, 0], [20, 20]];
    expect(simplify(line, 1)).toEqual([[0, 0], [20, 0], [20, 20]]);
    expect(simplify(line, 0.05)).toEqual(line);
    expect(simplify([[0, 0], [1, 1]], 1)).toEqual([[0, 0], [1, 1]]);
  });

  it('projects a ring into a closed path with a perpendicular start tick', () => {
    // A square, walked from its bottom-left corner along the bottom edge: the
    // tick has to cross that edge, i.e. run vertically.
    const ring = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    const [cid, t] = circuitPath({
      properties: { id: 'nl-1948', Name: 'X', Location: 'Zandvoort', length: 4259 },
      geometry: { type: 'LineString', coordinates: ring },
    });
    expect(cid).toBe('zandvoort');
    expect(t.m).toBe(4259);
    expect(t.name).toBe('Zandvoort');
    expect(t.d.startsWith('M')).toBe(true);
    expect(t.d.endsWith('Z')).toBe(true);          // the closure rides in Z, not a repeated point
    expect(t.d.split('L')).toHaveLength(4);         // four corners, one M + three L
    const [, x1, y1, x2, y2] = /^M([-\d.]+) ([-\d.]+)L([-\d.]+) ([-\d.]+)$/.exec(t.sf).map(Number);
    expect(x1).toBeCloseTo(x2, 6);                  // vertical: crosses the horizontal first segment
    expect(Math.abs(y2 - y1)).toBeGreaterThan(10);
    expect(t.viewBox).toMatch(/^0 0 [\d.]+ [\d.]+$/);
  });

  it('ignores a circuit it cannot key by circuitId', () => {
    expect(circuitPath({ properties: { id: 'xx-1999' }, geometry: { coordinates: [[0, 0], [1, 1], [0, 1], [0, 0]] } })).toBeNull();
    expect(circuitPath(null)).toBeNull();
    expect(buildTracks(null)).toEqual({});
  });

  it('maps only to real Ergast circuitIds, one apiece', () => {
    const ids = Object.values(ERGAST_ID);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('vegas');       // the modern Strip circuit...
    expect(ids).not.toContain('las_vegas'); // ...NOT the 1981 Caesars Palace one
    expect(ids.every((id) => /^[a-z_]+$/.test(id))).toBe(true);
  });
});

describe('site/data/f1-tracks.json shape', () => {
  const path = join(here, '../site/data/f1-tracks.json');

  it('has the documented shape (run tools/build-f1-tracks.js first)', () => {
    if (!existsSync(path)) return; // generated by a manual build step; skip until it exists
    const data = JSON.parse(readFileSync(path, 'utf8'));

    // The licence notice travels WITH the data: it is the condition on which
    // the outlines may be vendored at all (MIT, bacinger/f1-circuits).
    expect(data._source.license).toBe('MIT');
    expect(data._source.copyright).toMatch(/Tomislav Bacinger/);
    expect(data._source.repo).toContain('bacinger/f1-circuits');

    const ids = Object.keys(data).filter((k) => !k.startsWith('_'));
    expect(ids.length).toBeGreaterThan(30);
    for (const id of ids) {
      const t = data[id];
      expect(Object.values(ERGAST_ID), id).toContain(id);
      expect(t.d, id).toMatch(/^M[-\d. LZ]*Z$/);
      expect(t.sf, id).toMatch(/^M[-\d.]+ [-\d.]+L[-\d.]+ [-\d.]+$/);
      expect(t.viewBox, id).toMatch(/^0 0 [\d.]+ [\d.]+$/);
      const [, , w, h] = t.viewBox.split(' ').map(Number);
      expect(w, id).toBeLessThanOrEqual(430);
      expect(h, id).toBeLessThanOrEqual(430);
      expect(Math.max(w, h), id).toBeGreaterThan(400); // the longer side is the box
      expect(typeof t.name, id).toBe('string');
      expect(t.m, id).toBeGreaterThan(2000);           // a Grand Prix lap, in metres
    }
  });

  it('covers the circuits the calendar is actually at', () => {
    if (!existsSync(path)) return;
    const data = JSON.parse(readFileSync(path, 'utf8'));
    for (const id of ['spa', 'hungaroring', 'americas', 'monza', 'monaco', 'zandvoort', 'silverstone', 'suzuka']) {
      expect(data[id]?.d, id).toBeTruthy();
    }
  });
});
