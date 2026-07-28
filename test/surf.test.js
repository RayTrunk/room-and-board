/**
 * @vitest-environment happy-dom
 */
// Surf: the mapping (every marine field is independently nullable), the two
// derived facts the card is built on (the shore normal that falls out of the
// model's own snap, and the wind quality that follows from it), the chart
// geometry rules the mockup pinned, and the ocean gate that keeps the card out
// of pickers where there is no surf to report.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  effectiveSurfSpot, mapSurf, render, surfBoard, dirArrow,
  heightValue, heightUnit, fmtHeight, fmtPeriod, fmtOffshore,
  labelAnchors, cardColumns, waveChart, surfCanvas, nightRuns, nightAt,
  marineUrl, windUrl, fetchData, meta,
} from '../site/js/widgets/surf.js';
import {
  snapVector, windQuality, angleBetween, spotKey, verdictFrom, hasOcean,
  probeVerdict, writeProbe, clearProbe, readProbe, ensureOceanProbe,
  probeUrl, PROBE_TTL_MS, MAX_SNAP_KM, OCEAN_WIDGETS,
} from '../site/js/surf-gate.js';
import { isAddable, isOceanHidden } from '../site/js/config.js';
import { installLocalStorage } from './stubs/localstorage.js';
import { DEMO_VMS } from '../site/demo/fixtures.js';

const SPOT = { lat: 40.9384, lon: -72.3037, label: 'Bridgehampton', units: 'F' };
const CELL = { lat: 40.875, lon: -72.29166 }; // what Open-Meteo actually answers for SPOT

// A trimmed but structurally complete marine payload, field names verbatim from
// a live marine-api response.
const marineJson = (over = {}) => ({
  latitude: CELL.lat,
  longitude: CELL.lon,
  current: {
    time: '2026-07-02T08:00',
    wave_height: 3.3, wave_period: 5.2, wave_direction: 165, sea_surface_temperature: 71.1,
  },
  hourly: {
    time: ['2026-07-02T06:00', '2026-07-02T07:00', '2026-07-02T08:00', '2026-07-02T09:00', '2026-07-02T10:00'],
    wave_height: [3.2, 3.27, 3.3, 3.35, 3.45],
    swell_wave_height: [1.45, 1.49, 1.5, 1.51, 1.53],
    swell_wave_period: [6.1, 6.15, 6.2, 6.2, 6.25],
    swell_wave_direction: [156, 157, 158, 158, 159],
    wind_wave_height: [2.3, 2.35, 2.4, 2.42, 2.5],
    wind_wave_period: [3.3, 3.35, 3.4, 3.4, 3.45],
    wind_wave_direction: [170, 171, 172, 172, 173],
  },
  daily: {
    time: ['2026-07-01', '2026-07-02', '2026-07-03'],
    wave_height_max: [2.4, 5.4, 8.5],
    wave_period_max: [6.1, 6.3, 6.7],
    wave_direction_dominant: [114, 159, 142],
  },
  ...over,
});

const wxJson = (over = {}) => ({
  current: { time: '2026-07-02T08:00', temperature_2m: 75, wind_speed_10m: 15, wind_direction_10m: 168 },
  daily: {
    time: ['2026-07-01', '2026-07-02', '2026-07-03'],
    sunrise: ['2026-07-01T05:28', '2026-07-02T05:28', '2026-07-03T05:29'],
    sunset: ['2026-07-01T20:30', '2026-07-02T20:30', '2026-07-03T20:30'],
  },
  ...over,
});

/* ======================================================================
   The location indirection
   ====================================================================== */

describe('effectiveSurfSpot', () => {
  it('IS the weather location today, so there is one place to set and one label', () => {
    const cfg = { loc: { lat: 40.9384, lon: -72.3037, label: 'Bridgehampton', units: 'F' } };
    expect(effectiveSurfSpot(cfg)).toEqual({ lat: 40.9384, lon: -72.3037, label: 'Bridgehampton', units: 'F' });
  });

  it('is the single seam a future per-card override slots into: every caller goes through it', () => {
    // The renderer takes its label and its units from the helper's result, not
    // from cfg.loc directly — so changing what the helper returns changes the
    // whole widget.
    const cfg = { loc: { lat: 1, lon: 2, label: 'Elsewhere', units: 'C' } };
    const { card, body } = cardEl();
    render(body, DEMO_VMS.surf, cfg);
    expect(card.querySelector('.card__asof').textContent).toBe('Elsewhere');
    expect(body.querySelector('.sf-now__unit').textContent).toBe('m'); // units followed too
  });

  it('survives a config with no location at all', () => {
    expect(effectiveSurfSpot({})).toEqual({ lat: null, lon: null, label: '', units: 'F' });
    expect(effectiveSurfSpot(undefined).units).toBe('F');
  });
});

/* ======================================================================
   Geometry: the shore normal the model gives away for free
   ====================================================================== */

describe('snapVector (pin -> the cell the model actually answered for)', () => {
  it('derives Bridgehampton\'s shore-facing normal at ~172 degrees, ~7 km out', () => {
    const v = snapVector(SPOT, CELL);
    expect(v.bearing).toBeCloseTo(171.8, 0);
    expect(v.km).toBeCloseTo(7.12, 1);
  });

  it('derives Bondi\'s at ~42 degrees (southern hemisphere, east-facing)', () => {
    const v = snapVector({ lat: -33.8908, lon: 151.2743 }, { lat: -33.875, lon: 151.29167 });
    expect(v.bearing).toBeCloseTo(42.4, 0);
    expect(v.km).toBeCloseTo(2.38, 1);
  });

  it('answers null rather than NaN when either point is missing', () => {
    expect(snapVector(SPOT, { lat: null, lon: null })).toEqual({ km: null, bearing: null });
    expect(snapVector(undefined, CELL)).toEqual({ km: null, bearing: null });
  });

  it('angleBetween is the shortest way round, in both directions', () => {
    expect(angleBetween(350, 10)).toBe(20);
    expect(angleBetween(10, 350)).toBe(20);
    expect(angleBetween(0, 180)).toBe(180);
  });
});

describe('windQuality (all three answers, against a 172 degree seaward normal)', () => {
  const shore = 172;
  it('calls wind arriving FROM the water onshore', () => {
    expect(windQuality(172, shore)).toBe('onshore'); // dead on the normal
    expect(windQuality(168, shore)).toBe('onshore'); // the real Bridgehampton reading
    expect(windQuality(217, shore)).toBe('onshore'); // exactly 45 deg off: still onshore
    expect(windQuality(127, shore)).toBe('onshore');
  });
  it('calls wind arriving FROM the land offshore', () => {
    expect(windQuality(352, shore)).toBe('offshore'); // the reciprocal
    expect(windQuality(307, shore)).toBe('offshore'); // 135 deg away: the boundary
    expect(windQuality(37, shore)).toBe('offshore');
  });
  it('calls everything between cross, rather than rounding it to the nearest lie', () => {
    expect(windQuality(262, shore)).toBe('cross'); // 90 deg
    expect(windQuality(82, shore)).toBe('cross');
    expect(windQuality(230, shore)).toBe('cross');
  });
  it('is null when either bearing is unknown, so the label simply goes missing', () => {
    expect(windQuality(null, shore)).toBeNull();
    expect(windQuality(168, null)).toBeNull();
  });
});

/* ======================================================================
   Mapping
   ====================================================================== */

describe('mapSurf', () => {
  it('maps a full payload onto the shape both surfaces read', () => {
    const vm = mapSurf(marineJson(), wxJson(), SPOT);
    expect(vm.ocean).toBe(true);
    expect(vm.now).toMatchObject({ wave: 3.3, period: 5.2, dir: 165, sst: 71.1 });
    expect(vm.swell).toEqual({ h: 1.5, p: 6.2, d: 158 });
    expect(vm.windWave).toEqual({ h: 2.4, p: 3.4, d: 172 });
    expect(vm.shoreBearing).toBeCloseTo(171.8, 0);
    expect(vm.wind).toMatchObject({ speed: 15, dir: 168, quality: 'onshore' });
    expect(vm.air).toBe(75);
  });

  it('anchors on the API\'s own current stamp, never on the device clock', () => {
    // timezone=auto returns the SPOT's local time, which need not be the
    // board's — so "now" is found by matching cur.time in the hourly series.
    const vm = mapSurf(marineJson(), wxJson(), SPOT);
    expect(vm.hourly[vm.nowIdx].iso).toBe('2026-07-02T08:00');
    expect(vm.hourly[vm.nowIdx].wave).toBe(3.3);
  });

  it('keeps the past hours before "now" so the overlay chart has an interior mark', () => {
    const vm = mapSurf(marineJson(), wxJson(), SPOT);
    expect(vm.nowIdx).toBe(2); // the fixture only offers two past hours
    expect(vm.hourly[0].iso).toBe('2026-07-02T06:00');
  });

  it('starts the outlook at TODAY, dropping the past day past_days=1 brings back', () => {
    const vm = mapSurf(marineJson(), wxJson(), SPOT);
    expect(vm.daily.map((d) => d.iso)).toEqual(['2026-07-02', '2026-07-03']);
    expect(vm.daily[0]).toMatchObject({ day: 'Today', max: 5.4, period: 6.3, dir: 159 });
    expect(vm.daily[1].day).toBe('Fri');
  });

  it('reports no ocean, rather than throwing, when the model has no wave to give', () => {
    // An inland pin gets HTTP 200 with every value null (verified against
    // Denver). The card must keep its slot and say so.
    const vm = mapSurf(marineJson({ current: { time: '2026-07-02T08:00', wave_height: null } }), wxJson(), SPOT);
    expect(vm).toEqual({ ocean: false, spot: { label: 'Bridgehampton' } });
  });

  it('reports no ocean when the model had to snap further than the spot\'s own coast', () => {
    const far = mapSurf(marineJson({ latitude: 44.0, longitude: -72.29166 }), wxJson(), SPOT);
    expect(far.ocean).toBe(false);
    // ...and accepts a snap inside the ceiling.
    const near = mapSurf(marineJson(), wxJson(), SPOT);
    expect(near.snapKm).toBeLessThan(MAX_SNAP_KM);
    expect(near.ocean).toBe(true);
  });

  it('survives the wind call failing entirely (it is an enhancement, not the card)', () => {
    const vm = mapSurf(marineJson(), null, SPOT);
    expect(vm.ocean).toBe(true);
    expect(vm.wind).toEqual({ speed: null, dir: null, quality: null });
    expect(vm.air).toBeNull();
    expect(vm.sun).toEqual([]);
  });
});

describe('mapSurf per-field nullability (every marine variable resolves on its own grid)', () => {
  const holes = [
    ['wave_period', (vm) => vm.now.period],
    ['wave_direction', (vm) => vm.now.dir],
    ['sea_surface_temperature', (vm) => vm.now.sst],
  ];
  for (const [field, read] of holes) {
    it(`nulls ${field} independently, leaving the rest of the reading intact`, () => {
      const j = marineJson();
      j.current[field] = null;
      const vm = mapSurf(j, wxJson(), SPOT);
      expect(vm.ocean).toBe(true);
      expect(read(vm)).toBeNull();
      expect(vm.now.wave).toBe(3.3); // the field the card is built on is untouched
    });
  }

  it('nulls a whole component block without losing the total', () => {
    const j = marineJson();
    j.hourly.swell_wave_height = [null, null, null, null, null];
    j.hourly.swell_wave_period = [null, null, null, null, null];
    const vm = mapSurf(j, wxJson(), SPOT);
    expect(vm.swell.h).toBeNull();
    expect(vm.swell.p).toBeNull();
    expect(vm.swell.d).toBe(158); // direction resolved even though height did not
    expect(vm.now.wave).toBe(3.3);
  });

  it('survives a variable the response omits altogether', () => {
    const j = marineJson();
    delete j.hourly.wind_wave_period;
    delete j.daily.wave_period_max;
    const vm = mapSurf(j, wxJson(), SPOT);
    expect(vm.windWave.p).toBeNull();
    expect(vm.daily[0].period).toBeNull();
  });

  it('ends the hourly window at a hole rather than letting labels drift out of register', () => {
    const j = marineJson();
    j.hourly.wave_height = [3.2, 3.27, 3.3, null, 3.45];
    const vm = mapSurf(j, wxJson(), SPOT);
    expect(vm.hourly.map((h) => h.iso)).toEqual(['2026-07-02T06:00', '2026-07-02T07:00', '2026-07-02T08:00']);
  });

  it('renders every hole as a dash, never as NaN or undefined', () => {
    const j = marineJson();
    j.current.wave_period = null;
    j.current.wave_direction = null;
    j.current.sea_surface_temperature = null;
    const vm = mapSurf(j, null, SPOT);
    const { body } = cardEl();
    render(body, vm, { loc: SPOT });
    const text = body.textContent;
    expect(text).not.toMatch(/NaN|undefined|null/);
    expect(text).toContain('—');
  });
});

/* ======================================================================
   Units — both directions, on both surfaces
   ====================================================================== */

describe('unit conversion (the request pins feet/°F/mph; the renderer converts)', () => {
  it('prints feet on an F board and metres on a C board', () => {
    expect(heightUnit('F')).toBe('ft');
    expect(heightUnit('C')).toBe('m');
    expect(heightValue(3.3, 'F')).toBe('3.3');
    expect(heightValue(3.3, 'C')).toBe('1.0'); // 3.3 ft = 1.006 m
    expect(fmtHeight(8.5, 'F')).toBe('8.5 ft');
    expect(fmtHeight(8.5, 'C')).toBe('2.6 m');
  });

  it('prints NM on an F board and km on a C board, following the rest of the card', () => {
    expect(fmtOffshore(7.12, 'F')).toBe('3.8 NM');
    expect(fmtOffshore(7.12, 'C')).toBe('7.1 km');
  });

  it('keeps period in seconds in both systems', () => {
    expect(fmtPeriod(5.15)).toBe('5 s');
    expect(fmtPeriod(6.25, 1)).toBe('6.3 s');
  });

  it('converts a CACHED vm at render time, so a units change is never a refetch', () => {
    const vm = DEMO_VMS.surf;
    const f = cardEl();
    render(f.body, vm, { loc: { ...SPOT, units: 'F' } });
    expect(f.body.querySelector('.sf-now__val').textContent).toBe('3.3');
    expect(f.body.querySelector('.sf-now__unit').textContent).toBe('ft');
    expect(f.body.textContent).toContain('71°');   // water, °F
    expect(f.body.textContent).toContain('15 SSE'); // wind, mph

    const c = cardEl();
    render(c.body, vm, { loc: { ...SPOT, units: 'C' } }); // the SAME vm
    expect(c.body.querySelector('.sf-now__val').textContent).toBe('1.0');
    expect(c.body.querySelector('.sf-now__unit').textContent).toBe('m');
    expect(c.body.textContent).toContain('22°');   // 71.1°F -> 22°C
    expect(c.body.textContent).toContain('24 SSE'); // 15 mph -> 24 km/h
  });

  it('converts the full-screen view the same way, so the two can never disagree', () => {
    const f = surfBoard(DEMO_VMS.surf, { loc: { ...SPOT, units: 'F' } });
    const c = surfBoard(DEMO_VMS.surf, { loc: { ...SPOT, units: 'C' } });
    expect(f).toContain('>3.3<');
    expect(f).toContain('>ft<');
    expect(f).toContain('3.8 NM offshore');
    expect(c).toContain('>1.0<');
    expect(c).toContain('>m<');
    expect(c).toContain('7.1 km offshore');
  });
});

/* ======================================================================
   The FROM convention
   ====================================================================== */

describe('direction: arrow and letters describe the same swell from opposite ends', () => {
  it('points the glyph where the water TRAVELS while the letters read FROM', () => {
    // A swell FROM the south (180) travels north — the glyph rotates 360/0.
    expect(dirArrow(180)).toContain('rotate(0.0 12 12)');
    // FROM the north (0) travels south.
    expect(dirArrow(0)).toContain('rotate(180.0 12 12)');
    // The real Bridgehampton reading, 165 (SSE): travels toward 345 (NNW).
    expect(dirArrow(165)).toContain('rotate(345.0 12 12)');
  });

  it('prints the FROM compass point beside it, everywhere it appears', () => {
    const { body } = cardEl();
    render(body, DEMO_VMS.surf, { loc: SPOT });
    // 165 deg -> SSE, and the arrow beside it carries the reciprocal rotation.
    expect(body.querySelector('.sf-now__sub').textContent).toContain('SSE swell');
    expect(body.querySelector('.sf-now__sub').innerHTML).toContain('rotate(345.0 12 12)');

    const full = surfBoard(DEMO_VMS.surf, { loc: SPOT });
    expect(full).toContain('from SSE');
    expect(full).toContain('rotate(345.0 12 12)');
    expect(full).toMatch(/Groundswell[\s\S]*SSE/); // 158 -> SSE
    expect(full).toMatch(/Wind wave[\s\S]*>S</);   // 172 -> S
  });

  it('emits nothing at all when the direction is unknown', () => {
    expect(dirArrow(null)).toBe('');
    expect(dirArrow(undefined)).toBe('');
  });
});

/* ======================================================================
   Chart geometry: the two rules the mockup pinned
   ====================================================================== */

describe('zero-pinned axis (wave height is a MAGNITUDE, not a temperature)', () => {
  it('maps zero to the chart floor, so a flat afternoon cannot look like a lull', () => {
    const svg = waveChart([3, 3, 3, 3], 'g');
    // A flat series on a floating axis would draw a mid-height line; pinned at
    // zero it sits near the top, because 3 of a 3.27 domain is nearly full.
    const ys = [...svg.matchAll(/ (\d+\.\d\d)(?= |")/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThan(0);
    expect(Math.max(...ys)).toBeLessThan(30); // near the TOP of the 0..100 box
  });

  it('scales proportionally: half the height draws at half the amplitude', () => {
    const yOf = (svg) => Number(svg.match(/M0\.50 (\d+\.\d\d)/)[1]);
    const TOP = 10, BOT = 92, HEAD = 1.09;
    // Domain is 0..max*1.09, so a value v sits at TOP + (1 - v/(max*1.09))*(BOT-TOP).
    const expected = (v, max) => TOP + (1 - v / (max * HEAD)) * (BOT - TOP);
    expect(yOf(waveChart([4, 8], 'g'))).toBeCloseTo(expected(4, 8), 1);
    expect(yOf(waveChart([2, 4], 'g'))).toBeCloseTo(expected(2, 4), 1);
    // Same RATIO, same y: the axis is anchored, so shape is scale-free.
    expect(yOf(waveChart([4, 8], 'g'))).toBeCloseTo(yOf(waveChart([2, 4], 'g')), 5);
  });

  it('leaves headroom so the peak is never clipped by its own stroke', () => {
    const svg = waveChart([1, 8.5], 'g');
    const ys = [...svg.matchAll(/ (\d+\.\d\d)(?= |")/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThan(10); // TOP is 10, and the peak stays below it
  });

  it('draws nothing at all from fewer than two points', () => {
    expect(waveChart([3], 'g')).toBe('');
    expect(waveChart([], 'g')).toBe('');
  });
});

describe('peak-anchored label stepping', () => {
  it('always prints the peak column, wherever the peak lands', () => {
    for (let peak = 0; peak < 49; peak++) {
      expect(labelAnchors(49, peak)).toContain(peak);
    }
  });

  it('keeps an even rhythm of 6 either side of it', () => {
    expect(labelAnchors(49, 27)).toEqual([3, 9, 15, 21, 27, 33, 39, 45]);
    expect(labelAnchors(49, 0)).toEqual([0, 6, 12, 18, 24, 30, 36, 42, 48]);
  });

  it('marks the peak in the rendered row, so the headline number is legible as the peak', () => {
    const html = surfBoard(DEMO_VMS.surf, { loc: SPOT });
    expect(html).toContain('<span class="is-peak">8.5</span>');
    // ...and the other anchors print unmarked.
    expect(html).toMatch(/<span class="">\d\.\d<\/span>/);
  });

  it('holds a column for every unprinted hour, so curve and labels stay in register', () => {
    const html = surfBoard(DEMO_VMS.surf, { loc: SPOT });
    const row = html.match(/<div class="sff__row sff__row--h">(.*?)<\/div>/s)[1];
    expect((row.match(/<span/g) || []).length).toBe(DEMO_VMS.surf.hourly.length);
  });
});

describe('the card\'s own window', () => {
  it('samples 6 columns at 4-hour steps, or 8 at 3-hour steps once there is a 4th column', () => {
    const { hourly, nowIdx } = DEMO_VMS.surf;
    const six = cardColumns(hourly, nowIdx, 6);
    const eight = cardColumns(hourly, nowIdx, 8);
    expect(six.map((h) => h.iso.slice(11, 16))).toEqual(['08:00', '12:00', '16:00', '20:00', '00:00', '04:00']);
    expect(eight.map((h) => h.iso.slice(11, 16))).toEqual(['08:00', '11:00', '14:00', '17:00', '20:00', '23:00', '02:00', '05:00']);
  });

  it('stops early rather than running off the end of a short series', () => {
    const short = [{ iso: 'a', wave: 1 }, { iso: 'b', wave: 2 }];
    expect(cardColumns(short, 0, 6).length).toBe(1);
  });
});

describe('night bands', () => {
  it('shades from sunset to sunrise, across midnight', () => {
    const { hourly, sun } = DEMO_VMS.surf;
    const runs = nightRuns(hourly, sun);
    // Three: the tail of last night (the window opens at 02:00), the full night
    // between the two days, and the head of the next one.
    expect(runs.length).toBe(3);
    expect(hourly[runs[0][0]].iso).toBe('2026-07-02T02:00');
    expect(hourly[runs[0][1]].iso).toBe('2026-07-02T06:00'); // sunrise 05:28
    // 20:30 sunset -> 21:00 is the first dark column; 05:29 sunrise -> 05:00 is
    // still dark and 06:00 is not.
    expect(hourly[runs[1][0]].iso).toBe('2026-07-02T21:00');
    expect(hourly[runs[1][1]].iso).toBe('2026-07-03T06:00');
  });

  it('shades nothing at all when the vm carries no sun times', () => {
    expect(nightRuns(DEMO_VMS.surf.hourly, [])).toEqual([]);
    expect(nightAt('2026-07-02T23:00', [])).toBe(false);
  });

  it('positions "Night" and "NOW" as HTML, not as SVG text stretched by the canvas', () => {
    const html = surfBoard(DEMO_VMS.surf, { loc: SPOT });
    expect(html).toMatch(/<span class="sff__nowtag" style="left:13\.\d+%">NOW<\/span>/);
    // Centred on the WIDEST band (columns 19..27), not the pre-dawn sliver the
    // window opens on.
    expect(html).toMatch(/<span class="sff__nightlbl" style="left:4[78]\.\d+%">Night<\/span>/);
    expect(html).not.toMatch(/<text/); // nothing textual inside the stretched canvas
  });

  it('drops the groundswell line rather than half-drawing it', () => {
    const gapped = DEMO_VMS.surf.hourly.map((h, i) => (i === 3 ? { ...h, swell: null } : h));
    expect(surfCanvas(gapped, DEMO_VMS.surf.sun, 6, 'g')).not.toContain('sf-canvas__swell');
    expect(surfCanvas(DEMO_VMS.surf.hourly, DEMO_VMS.surf.sun, 6, 'g')).toContain('sf-canvas__swell');
  });
});

/* ======================================================================
   Render + expansion
   ====================================================================== */

function cardEl(size = [3, 3]) {
  const card = document.createElement('article');
  card.className = 'card card--surf';
  card.dataset.w = size[0];
  card.dataset.h = size[1];
  card.innerHTML = '<h2 class="card__title">Surf</h2><div class="card__body"></div>';
  document.body.appendChild(card);
  return { card, body: card.querySelector('.card__body') };
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('surf card render', () => {
  it('leads with the height and the period, and names the spot in the corner', () => {
    const { card, body } = cardEl();
    render(body, DEMO_VMS.surf, { loc: SPOT });
    expect(body.querySelector('.sf-now__val').textContent).toBe('3.3');
    expect(body.querySelector('.sf-now__label').textContent).toBe('5 s period');
    expect(card.querySelector('.card__asof').textContent).toBe('Bridgehampton');
  });

  it('shows the build: six columns at 3 wide, eight at 4 wide, both reaching the 8.5 peak', () => {
    const narrow = cardEl([3, 3]);
    render(narrow.body, DEMO_VMS.surf, { loc: SPOT });
    expect(narrow.body.querySelectorAll('.sf-trend__row:first-child > span').length).toBe(6);
    expect(narrow.body.textContent).toContain('8.1');

    const wide = cardEl([4, 3]);
    render(wide.body, DEMO_VMS.surf, { loc: SPOT });
    expect(wide.body.querySelectorAll('.sf-trend__row:first-child > span').length).toBe(8);
    expect(wide.body.textContent).toContain('8.5');
  });

  it('spends the fourth column on the groundswell height and the provenance stamp', () => {
    const narrow = cardEl([3, 3]);
    render(narrow.body, DEMO_VMS.surf, { loc: SPOT });
    expect(narrow.body.textContent).not.toContain('groundswell');
    // At 3 wide the one right-hand slot goes to the wind's quality.
    expect(narrow.body.querySelector('.sf-foot__stamp').textContent).toBe('onshore');

    const wide = cardEl([4, 3]);
    render(wide.body, DEMO_VMS.surf, { loc: SPOT });
    expect(wide.body.textContent).toContain('1.5 ft groundswell');
    expect(wide.body.querySelector('.sf-foot__q').textContent).toBe('onshore');
    expect(wide.body.querySelector('.sf-foot__stamp').textContent).toBe('Modeled 3.8 NM offshore');
  });

  it('drops the offshore stamp when the snap is grid rounding rather than a fact', () => {
    const close = { ...DEMO_VMS.surf, snapKm: 0.4 };
    const { body } = cardEl([4, 3]);
    render(body, close, { loc: SPOT });
    expect(body.textContent).not.toContain('offshore');
  });

  it('escapes nothing dangerous into the markup even from a hostile label', () => {
    const { card, body } = cardEl();
    render(body, DEMO_VMS.surf, { loc: { ...SPOT, label: '<img src=x onerror=alert(1)>' } });
    expect(card.querySelector('.card__asof').querySelector('img')).toBeNull();
  });
});

describe('surf empty state', () => {
  it('keeps the slot with a quiet message and NO press affordance', () => {
    const { card, body } = cardEl();
    render(body, { ocean: false, spot: { label: 'Bridgehampton' } }, { loc: SPOT });
    expect(body.querySelector('.empty').textContent).toBe('No ocean data for this spot right now');
    // Per the expand spec: an empty vm gets no overlay, because the press tint
    // would promise a detail view with nothing in it.
    expect(card.classList.contains('is-expandable')).toBe(false);
  });

  it('keeps naming the spot, so the card reads as a state and not as breakage', () => {
    const { card, body } = cardEl();
    render(body, { ocean: false }, { loc: SPOT });
    expect(card.querySelector('.card__asof').textContent).toBe('Bridgehampton');
    expect(body.querySelector('.alert')).toBeNull(); // no amber: nothing is stale
  });

  it('DROPS an existing expansion when a refresh loses the ocean', () => {
    const { card, body } = cardEl();
    render(body, DEMO_VMS.surf, { loc: SPOT });
    expect(card.classList.contains('is-expandable')).toBe(true);
    render(body, { ocean: false }, { loc: SPOT });
    expect(card.classList.contains('is-expandable')).toBe(false);
  });

  it('is what an undefined vm renders as, not a crash', () => {
    const { card, body } = cardEl();
    expect(() => render(body, undefined, { loc: SPOT })).not.toThrow();
    expect(body.querySelector('.empty')).not.toBeNull();
    expect(card.classList.contains('is-expandable')).toBe(false);
  });
});

describe('surf tap-for-detail', () => {
  it('registers an expansion whenever the card has data', () => {
    const { card, body } = cardEl();
    render(body, DEMO_VMS.surf, { loc: SPOT });
    expect(card.classList.contains('is-expandable')).toBe(true);
  });

  it('builds the 48-hour board: decomposition, peaks, the week, and the paired readings', () => {
    const html = surfBoard(DEMO_VMS.surf, { loc: SPOT });
    expect(html).toContain('Wave components');
    expect(html).toContain('Groundswell');
    expect(html).toContain('Wind wave');
    expect(html).toContain('Today&rsquo;s peak');
    expect(html).toContain('5.4 ft');
    expect(html).toContain('8.5 ft');
    expect(html).toContain('at 5 AM');      // the peak hour, inside the window
    expect(html).toContain('Wave height &middot; 48 hours &middot; ft');
    expect(html).toContain('Groundswell only'); // the second series has a legend
    // the seven-day strip
    expect((html.match(/class="sff__day[ "]/g) || []).length).toBe(7);
    // water paired with air, and the wind carrying its quality
    expect(html).toContain('>71°</b><span>Water<');
    expect(html).toContain('>75°</b><span>Air<');
    expect(html).toContain('Wind &middot; onshore');
    expect(html).toContain('5:28 AM');
    expect(html).toContain('8:30 PM');
  });

  it('omits "at <hour>" when tomorrow\'s peak falls outside the 48-hour window', () => {
    // Peak inside today -> the tomorrow row carries only the daily maximum.
    const vm = { ...DEMO_VMS.surf, hourly: DEMO_VMS.surf.hourly.slice(0, 10) };
    const html = surfBoard(vm, { loc: SPOT });
    expect(html).toContain('Tomorrow&rsquo;s peak');
    expect(html).not.toContain('<small>at ');
  });

  it('honors the 24-hour clock preference on every time it prints', () => {
    const html = surfBoard(DEMO_VMS.surf, { loc: SPOT, clock24: true });
    expect(html).toContain('05:28');
    expect(html).toContain('20:30');
    expect(html).toContain('>05:00<'); // the first anchored hour column
  });
});

/* ======================================================================
   The ocean gate
   ====================================================================== */

describe('ocean gate', () => {
  beforeEach(() => { installLocalStorage(); clearProbe(); });

  const ok = (loc = SPOT, t = Date.now()) =>
    writeProbe({ key: spotKey(loc), t, ocean: true, km: 7.12, bearing: 171.8 });

  it('MISS: an unprobed board does not offer the card', () => {
    expect(probeVerdict(SPOT)).toBeNull();
    expect(hasOcean(SPOT)).toBe(false);
    expect(isAddable('surf', { loc: SPOT }, 'roomboard.app')).toBe(false);
  });

  it('HIT: a cached ocean verdict offers it', () => {
    ok();
    expect(hasOcean(SPOT)).toBe(true);
    expect(isAddable('surf', { loc: SPOT }, 'roomboard.app')).toBe(true);
  });

  it('HIT, negative: a cached NO is just as binding as a miss', () => {
    writeProbe({ key: spotKey(SPOT), t: Date.now(), ocean: false, km: null, bearing: null });
    expect(hasOcean(SPOT)).toBe(false);
    expect(isAddable('surf', { loc: SPOT }, 'roomboard.app')).toBe(false);
  });

  it('STALE: a verdict older than the TTL is re-asked, not trusted', () => {
    const now = Date.now();
    ok(SPOT, now - PROBE_TTL_MS - 1);
    expect(probeVerdict(SPOT, now)).toBeNull();
    expect(hasOcean(SPOT, now)).toBe(false);
    // ...and one just inside it still stands.
    ok(SPOT, now - PROBE_TTL_MS + 1000);
    expect(hasOcean(SPOT, now)).toBe(true);
  });

  it('LOC CHANGE: a verdict taken for another spot does not travel', () => {
    ok();
    expect(hasOcean(SPOT)).toBe(true);
    expect(hasOcean({ lat: 39.7392, lon: -104.9903 })).toBe(false); // Denver
  });

  it('ignores geocoder jitter in the last decimals, which is not a move', () => {
    ok();
    expect(hasOcean({ lat: 40.93838, lon: -72.30371 })).toBe(true);
    expect(hasOcean({ lat: 40.95, lon: -72.3037 })).toBe(false);
  });

  it('survives storage being unavailable by staying hidden', () => {
    Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true });
    expect(() => writeProbe({ key: 'x', t: 1, ocean: true })).not.toThrow();
    expect(readProbe()).toBeNull();
    expect(hasOcean(SPOT)).toBe(false);
  });

  it('ignores a corrupt record rather than throwing on it', () => {
    window.localStorage.setItem('sgn.surf.probe', '{not json');
    expect(readProbe()).toBeNull();
    window.localStorage.setItem('sgn.surf.probe', '{"ocean":true}'); // no key
    expect(readProbe()).toBeNull();
  });

  it('gates ONLY the place-gated ids, and composes with the other add policies', () => {
    expect(OCEAN_WIDGETS).toEqual(['surf']);
    expect(isOceanHidden('surf', { loc: SPOT })).toBe(true);
    expect(isOceanHidden('weather', { loc: SPOT })).toBe(false);
    ok();
    expect(isOceanHidden('surf', { loc: SPOT })).toBe(false);
    // ...and the other gates still apply on top.
    expect(isAddable('iptv', { loc: SPOT, nerdMode: false }, 'beta.roomboard.app')).toBe(false);
    expect(isAddable('surf', { loc: SPOT }, 'roomboard.app')).toBe(true);
  });
});

describe('verdictFrom (what a probe response means)', () => {
  it('accepts real water within the snap ceiling', () => {
    const rec = verdictFrom(SPOT, { latitude: CELL.lat, longitude: CELL.lon, current: { wave_height: 3.3 } });
    expect(rec).toMatchObject({ key: spotKey(SPOT), ocean: true });
    expect(rec.km).toBeCloseTo(7.12, 1);
    expect(rec.bearing).toBeCloseTo(171.8, 0);
  });

  it('rejects an inland pin, which answers 200 with a null wave', () => {
    // Verified live against Denver: the model snaps to a nearby land cell and
    // returns nulls rather than an error.
    const denver = { lat: 39.7392, lon: -104.9903 };
    const rec = verdictFrom(denver, { latitude: 39.708336, longitude: -104.95833, current: { wave_height: null } });
    expect(rec.ocean).toBe(false);
    expect(rec.km).toBeLessThan(MAX_SNAP_KM); // distance alone would NOT have caught it
  });

  it('rejects a pin the model had to drag past its own coast', () => {
    const rec = verdictFrom(SPOT, { latitude: 41.5, longitude: -72.29166, current: { wave_height: 2.1 } });
    expect(rec.ocean).toBe(false);
  });
});

describe('ensureOceanProbe', () => {
  beforeEach(() => { installLocalStorage(); clearProbe(); });

  it('probes on a miss and reports the verdict back so a picker can repaint', async () => {
    const net = { fetchJSON: vi.fn().mockResolvedValue({ latitude: CELL.lat, longitude: CELL.lon, current: { wave_height: 3.3 } }) };
    const onDone = vi.fn();
    expect(ensureOceanProbe(SPOT, net, onDone)).toBe(true);
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(net.fetchJSON).toHaveBeenCalledWith(probeUrl(SPOT));
    expect(hasOcean(SPOT)).toBe(true);
  });

  it('does not re-ask while a verdict stands', () => {
    writeProbe({ key: spotKey(SPOT), t: Date.now(), ocean: true, km: 7, bearing: 172 });
    const net = { fetchJSON: vi.fn() };
    expect(ensureOceanProbe(SPOT, net)).toBe(false);
    expect(net.fetchJSON).not.toHaveBeenCalled();
  });

  it('never rejects when the probe fails: the card just stays hidden', async () => {
    const net = { fetchJSON: vi.fn().mockRejectedValue(new Error('offline')) };
    expect(() => ensureOceanProbe(SPOT, net)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(hasOcean(SPOT)).toBe(false);
  });

  it('refuses a location it cannot probe', () => {
    const net = { fetchJSON: vi.fn() };
    expect(ensureOceanProbe(null, net)).toBe(false);
    expect(ensureOceanProbe({ lat: null, lon: null }, net)).toBe(false);
    expect(net.fetchJSON).not.toHaveBeenCalled();
  });
});

/* ======================================================================
   Fetch
   ====================================================================== */

describe('fetchData', () => {
  beforeEach(() => { installLocalStorage(); clearProbe(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('asks for the marine variables natively in the canonical units', () => {
    const u = marineUrl(SPOT);
    expect(u.startsWith('https://marine-api.open-meteo.com/v1/marine?')).toBe(true);
    for (const f of ['wave_height', 'wave_period', 'wave_direction', 'sea_surface_temperature',
      'swell_wave_height', 'swell_wave_period', 'swell_wave_direction',
      'wind_wave_height', 'wind_wave_period', 'wind_wave_direction',
      'wave_height_max', 'wave_period_max', 'wave_direction_dominant']) {
      expect(u).toContain(f);
    }
    expect(u).toContain('length_unit=imperial');
    expect(u).toContain('temperature_unit=fahrenheit');
    expect(u).toContain('timezone=auto');
    expect(u).toContain('past_days=1'); // the six hours of history the overlay needs
  });

  it('takes the wind from the FORECAST api, which is the only one that serves it', () => {
    // marine-api accepts current=wind_speed_10m and answers null with unit
    // "undefined" — verified live. So the wind rides its own minimal call.
    expect(marineUrl(SPOT)).not.toContain('wind_speed_10m');
    const u = windUrl(SPOT);
    expect(u.startsWith('https://api.open-meteo.com/v1/forecast?')).toBe(true);
    expect(u).toContain('wind_speed_10m');
    expect(u).toContain('wind_direction_10m');
    expect(u).toContain('wind_speed_unit=mph');
    expect(u).toContain('sunrise,sunset');
  });

  it('stays inside its call budget: 14 marine variables + 5 forecast = 1.9 weighted', () => {
    const count = (u) => [...u.matchAll(/(?:current|hourly|daily)=([^&]+)/g)]
      .reduce((n, m) => n + m[1].split(',').length, 0);
    expect(count(marineUrl(SPOT))).toBe(14);
    expect(count(windUrl(SPOT))).toBe(5);
  });

  it('makes both calls and re-earns the add-picker verdict out of the same refresh', async () => {
    const net = {
      fetchJSON: vi.fn((url) => Promise.resolve(url.includes('marine') ? marineJson() : wxJson())),
    };
    const vm = await fetchData({ loc: SPOT }, net);
    expect(net.fetchJSON).toHaveBeenCalledTimes(2);
    expect(vm.ocean).toBe(true);
    // A board that shows the card never pays for a standalone probe.
    expect(hasOcean(SPOT)).toBe(true);
    expect(probeVerdict(SPOT).bearing).toBeCloseTo(171.8, 0);
  });

  it('records a NEGATIVE verdict too, so a spot that lost the ocean stops being offered', async () => {
    const net = {
      fetchJSON: vi.fn((url) => Promise.resolve(url.includes('marine')
        ? marineJson({ current: { time: '2026-07-02T08:00', wave_height: null } })
        : wxJson())),
    };
    const vm = await fetchData({ loc: SPOT }, net);
    expect(vm.ocean).toBe(false);
    expect(hasOcean(SPOT)).toBe(false);
  });

  it('refreshes every half hour', () => {
    expect(meta).toMatchObject({ id: 'surf', title: 'Surf', refreshMs: 30 * 60 * 1000 });
  });
});
