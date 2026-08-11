// Surf widget: Open-Meteo Marine (browser-direct, CORS-open, keyless, the same
// shape as the weather call) plus a minimal forecast call for the wind.
//
// Three things a surfer reads in this order: how big it is, how long between
// the waves, and whether the wind is helping. The card carries all three plus
// the hourly build; the tap-for-detail view decomposes the swell, prints 48
// hours, and pairs the water with the air.
//
// All time strings stay in the local timezone Open-Meteo returns
// (timezone=auto) — no Date parsing of API times, same rule as weather.js.
//
// EVERY MARINE FIELD IS INDEPENDENTLY NULLABLE: each variable resolves on its
// own model grid, so a spot can have a wave height and no period, or waves and
// no water temperature. Everything below therefore goes through num/orDash, the
// same idioms weather.js uses for its optional readings.

import { escapeHtml, chaikin } from '../util.js';
import { setCardNote } from '../card.js';
import { setExpandSource } from '../expand.js';
import { cardSize } from '../capacity.js';
import { compass, fmtTemp, fmtWind, hourLabel, timeLabel } from './weather.js';
import { snapVector, windQuality, writeProbe, spotKey, coord, MAX_SNAP_KM } from '../surf-gate.js';

export const meta = { id: 'surf', title: 'Surf', refreshMs: 30 * 60 * 1000 };

// Optional-by-construction readings, exactly as in weather.js: a vm cached by
// an older build, or a partial API response, prints a dash rather than "NaN".
const num = (v) => (Number.isFinite(v) ? v : null);
const orDash = (v, fmt) => (Number.isFinite(v) ? fmt(v) : '—');

// How much of the model's horizon the vm keeps. The card draws 6-8 columns of
// it and the overlay draws 49; the rest costs nothing, because one request
// returns the whole horizon whatever we slice off it.
const PAST_HOURS = 6;      // enough that "now" is an interior mark, not an edge
const FORWARD_HOURS = 42;  // 6 + 42 = the overlay's 48-hour window
const HOURLY_KEPT = PAST_HOURS + FORWARD_HOURS + 1;

// The single indirection the whole widget reads its location through. Today it
// IS the board's weather location — one place to set, one label in the corner,
// no second settings pane to keep in sync. A future per-card spot override
// slots in here and nothing else has to move.
export function effectiveSurfSpot(cfg) {
  const loc = cfg?.loc ?? {};
  return { lat: num(coord(loc.lat)), lon: num(coord(loc.lon)), label: loc.label ?? '', units: loc.units === 'C' ? 'C' : 'F' };
}

/* ---------------------------------------------------------------------------
   Units. The request pins ONE canonical choice (feet, °F, mph) and the renderer
   converts per cfg.loc.units — so a units change is a re-render, never a
   refetch, and a cached vm can never be in the wrong unit.
   --------------------------------------------------------------------------- */

export const heightUnit = (units) => (units === 'C' ? 'm' : 'ft');
// One decimal in both units: a surf report that reads "3.3" and "1.0" is
// telling the truth about a model that resolves to about a tenth of a foot.
export const heightValue = (ft, units) => (units === 'C' ? (ft * 0.3048).toFixed(1) : ft.toFixed(1));
export const fmtHeight = (ft, units) => `${heightValue(ft, units)} ${heightUnit(units)}`;
// Period is seconds everywhere; only the number of decimals changes with room.
export const fmtPeriod = (s, digits = 0) => `${s.toFixed(digits)} s`;

// How far offshore the model had to go to find water. Nautical miles are the
// marine idiom, but a board already reading metres of swell and km/h of wind
// should not switch measurement systems for one line — so this follows
// cfg.loc.units like every other number on the card.
export function fmtOffshore(km, units) {
  return units === 'C' ? `${km.toFixed(1)} km` : `${(km / 1.852).toFixed(1)} NM`;
}
// Below about a mile the snap is grid rounding, not a fact about the spot, and
// printing it would dress noise up as provenance.
const OFFSHORE_FLOOR_KM = 1.852;

const QUALITY_TEXT = { onshore: 'onshore', offshore: 'offshore', cross: 'cross-shore' };

// The direction glyph. The base path points NORTH and the renderer rotates it
// to the direction the water TRAVELS (bearing + 180), while the letters beside
// it keep the conventional FROM reading — arrow and letters describing the same
// swell from the two ends. Stroke-based to match icons.js.
export function dirArrow(deg, cls = 'sf-dir') {
  if (!Number.isFinite(deg)) return '';
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">`
    + `<g transform="rotate(${((deg + 180) % 360).toFixed(1)} 12 12)">`
    + '<path d="M12 4.5 V19.5"/><path d="M6.8 9.7 L12 4.5 L17.2 9.7"/></g></svg>';
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Parse as UTC noon to avoid TZ date shifts, then take the weekday (dayLabel's
// rule in weather.js).
const dayName = (isoDate) => DAY_NAMES[new Date(`${isoDate}T12:00:00Z`).getUTCDay()];

/* ---------------------------------------------------------------------------
   Mapping
   --------------------------------------------------------------------------- */

// Which day's sun times govern an hour, and whether that hour is after dark.
// Optional by construction: a vm without sun times simply gets no night wash,
// and the chart still reads. (weather.js's nightAt, over this vm's shape.)
export function nightAt(iso, days) {
  const d = days?.find((x) => x.iso === iso.slice(0, 10));
  if (!d?.sunrise || !d?.sunset) return false;
  const t = iso.slice(11, 16);
  return t < d.sunrise.slice(11, 16) || t >= d.sunset.slice(11, 16);
}

// marine + forecast → the view model both surfaces read. Returns an
// `ocean: false` vm rather than throwing when the spot has no usable water:
// a PLACED card must keep its slot and show the empty state, never vanish.
// A genuine upstream failure throws upstream of here (net.fetchJSON), which is
// what keeps the last good reading on screen with its stale stamp.
export function mapSurf(marine, wx, spot, nowMs = Date.now()) {
  const cell = { lat: num(coord(marine?.latitude)), lon: num(coord(marine?.longitude)) };
  const { km, bearing } = snapVector(spot, cell);
  const cur = marine?.current ?? {};
  const H = marine?.hourly ?? {};
  const nowWave = num(cur.wave_height);
  if (!Number.isFinite(nowWave) || !Number.isFinite(km) || km > MAX_SNAP_KM) {
    return { ocean: false, spot: { label: spot.label ?? '' } };
  }

  // Anchor on the API's own current-observation stamp, never on the device
  // clock: with timezone=auto these strings are in the SPOT's timezone, which
  // is not necessarily the board's.
  const times = Array.isArray(H.time) ? H.time : [];
  const curHour = `${cur.time ?? ''}`.slice(0, 13);
  let anchor = times.findIndex((t) => t.slice(0, 13) === curHour);
  if (anchor < 0) anchor = times.findIndex((t) => t >= (cur.time ?? ''));
  if (anchor < 0) anchor = 0;

  const start = Math.max(0, anchor - PAST_HOURS);
  const hourly = [];
  for (let i = start; i < times.length && hourly.length < HOURLY_KEPT; i++) {
    const wave = num(H.wave_height?.[i]);
    // A hole in the series would put the printed labels out of register with
    // the curve, so the window simply ends at one. Everything before it is
    // still a truthful chart.
    if (!Number.isFinite(wave)) break;
    hourly.push({ iso: times[i], wave, swell: num(H.swell_wave_height?.[i]) });
  }
  const nowIdx = Math.min(anchor - start, Math.max(hourly.length - 1, 0));

  // Components at NOW, read off the hourly grid (the `current` block carries
  // only the totals — asking it for the six component fields as well would
  // double the call's weight for numbers already in hand).
  const at = (arr) => num(arr?.[anchor]);
  const swell = { h: at(H.swell_wave_height), p: at(H.swell_wave_period), d: at(H.swell_wave_direction) };
  const windWave = { h: at(H.wind_wave_height), p: at(H.wind_wave_period), d: at(H.wind_wave_direction) };

  const D = marine?.daily ?? {};
  const today = `${cur.time ?? ''}`.slice(0, 10);
  const dTimes = Array.isArray(D.time) ? D.time : [];
  // past_days=1 puts YESTERDAY at index 0; the outlook starts at today.
  const dStart = Math.max(0, dTimes.findIndex((t) => t >= today));
  const daily = dTimes.slice(dStart).map((t, i) => ({
    iso: t,
    day: i === 0 ? 'Today' : dayName(t),
    max: num(D.wave_height_max?.[dStart + i]),
    period: num(D.wave_period_max?.[dStart + i]),
    dir: num(D.wave_direction_dominant?.[dStart + i]),
  }));

  // Sun times, per day, from the forecast call. Feeds both the overlay's night
  // wash (which runs past midnight and so needs more than today's pair) and the
  // stats band.
  const WD = wx?.daily ?? {};
  const sun = (Array.isArray(WD.time) ? WD.time : []).map((t, i) => ({
    iso: t,
    sunrise: WD.sunrise?.[i] ?? null,
    sunset: WD.sunset?.[i] ?? null,
  }));
  const wxCur = wx?.current ?? {};
  const windDir = num(wxCur.wind_direction_10m);

  return {
    ocean: true,
    spot: { lat: spot.lat, lon: spot.lon, label: spot.label ?? '' },
    cell,
    snapKm: km,
    // The shore-facing normal, free from the pin -> snapped-cell vector.
    shoreBearing: bearing,
    now: {
      iso: cur.time ?? null,
      wave: nowWave,
      period: num(cur.wave_period),
      dir: num(cur.wave_direction),
      sst: num(cur.sea_surface_temperature),
    },
    swell,
    windWave,
    hourly,
    nowIdx,
    daily,
    sun,
    wind: {
      speed: num(wxCur.wind_speed_10m),
      dir: windDir,
      quality: windQuality(windDir, bearing),
    },
    air: num(wxCur.temperature_2m),
    fetchedAt: nowMs,
  };
}

/* ---------------------------------------------------------------------------
   The card's hourly chart. trendSvg's geometry, with ONE change: wave height is
   a MAGNITUDE, so the axis is pinned at zero instead of floating with the data.
   A truncated axis would make a flat 3 ft afternoon look like a lull and turn a
   modest build into a cliff — the exact lie a surf chart must not tell.
   --------------------------------------------------------------------------- */

export function waveChart(vals, gradId, cls = 'sf-trend__chart') {
  const n = vals.length;
  if (n < 2) return '';
  const HI = Math.max(...vals) * 1.09 || 1; // 9% headroom so the peak is not clipped by the stroke
  const TOP = 10, BOT = 92;
  const px = (i) => i + 0.5;
  const py = (v) => TOP + (1 - v / HI) * (BOT - TOP);
  const sm = chaikin(vals.map((v, i) => [px(i), py(v)]));
  const xy = ([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`;
  const pts = sm.map(xy);
  return `<svg class="${cls}" viewBox="0 0 ${n} 100" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" class="sf-trend__g0"></stop><stop offset="1" class="sf-trend__g1"></stop>
      </linearGradient></defs>
      <path class="sf-trend__area" d="M${sm[0][0].toFixed(2)} 100 L${pts.join(' L')} L${sm[sm.length - 1][0].toFixed(2)} 100 Z" fill="url(#${gradId})"></path>
      <path class="sf-trend__line" d="M${pts.join(' L')}"></path>
    </svg>`;
}

// The card's chart samples the next 24 hours at whatever step fills its
// columns: six columns at 4-hour steps on a 3-wide card, eight at 3-hour steps
// once there is a fourth column to spend. Both windows land on the same 24
// hours, so the story ("3.3 now, 8.5 by tomorrow afternoon") is the same one at
// either width.
export function cardColumns(hourly, nowIdx, n) {
  const step = Math.round(24 / n);
  const out = [];
  for (let i = 0; i < n; i++) {
    const h = hourly[nowIdx + i * step];
    if (!h) break;
    out.push(h);
  }
  return out;
}

/* ---------------------------------------------------------------------------
   Tap-for-detail: the full-screen surf board.

   The SECOND class of expansion (docs/superpowers/specs/2026-07-27-expand-
   overlay-design.md): nothing on the card is capped away, so instead of
   uncapping a list the overlay derives a richer reading from the very same
   payload — 48 hours instead of 6, the swell split out from the wind chop, the
   week ahead, and the air/sun readings the card has never had room for. Still
   one refresh, still no fetch at open.
   --------------------------------------------------------------------------- */

// One printed reading every sixth column, ANCHORED ON THE PEAK. Stepping from
// column 0 would leave the single number the whole chart is about unprinted
// perhaps five times in six; anchoring on it guarantees the headline reading is
// always one of the labelled ones, and the rhythm is just as even either way.
export function labelAnchors(n, peak, step = 6) {
  const out = [];
  for (let c = ((peak % step) + step) % step; c < n; c += step) out.push(c);
  return out;
}

// Contiguous runs of dark, in column coordinates. Feeds both the wash rects and
// the single "Night" caption: two unlabelled slabs on a 48-hour canvas read as
// highlighted regions rather than as darkness, and the word is cheaper than a
// second legend entry.
export function nightRuns(hours, days) {
  const runs = [];
  let open = -1;
  hours.forEach((h, i) => {
    const dark = nightAt(h.iso, days);
    if (dark && open < 0) open = i;
    if (!dark && open >= 0) { runs.push([open, i]); open = -1; }
  });
  if (open >= 0) runs.push([open, hours.length]);
  return runs;
}

export function surfCanvas(hours, days, nowIdx, gradId) {
  const n = hours.length;
  if (n < 2) return '';
  const waves = hours.map((h) => h.wave);
  const HI = Math.max(...waves) * 1.09 || 1;
  const TOP = 8, BOT = 92;
  const px = (i) => i + 0.5;
  const py = (v) => TOP + (1 - v / HI) * (BOT - TOP);
  const xy = ([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`;
  const smooth = (vals) => chaikin(vals.map((v, i) => [px(i), py(v)])).map(xy);
  const total = smooth(waves);
  // The groundswell line only draws when every hour has one: a half-drawn
  // second series would read as the swell dying rather than as a gap.
  const hasSwell = hours.every((h) => Number.isFinite(h.swell));
  const swell = hasSwell ? smooth(hours.map((h) => h.swell)) : null;
  // Plain rects and lines only: gen1 Qt WebEngine has no clipPath, no filters.
  const night = nightRuns(hours, days)
    .map(([a, b]) => `<rect class="sf-canvas__night" x="${a}" y="0" width="${b - a}" height="100"/>`)
    .join('');
  return `<svg class="sf-canvas" viewBox="0 0 ${n} 100" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" class="sf-canvas__g0"></stop><stop offset="1" class="sf-canvas__g1"></stop>
        </linearGradient></defs>
        ${night}
        <path class="sf-canvas__area" d="M${px(0).toFixed(2)} 100 L${total.join(' L')} L${px(n - 1).toFixed(2)} 100 Z" fill="url(#${gradId})"></path>
        ${swell ? `<path class="sf-canvas__swell" d="M${swell.join(' L')}"></path>` : ''}
        <path class="sf-canvas__line" d="M${total.join(' L')}"></path>
        <line class="sf-canvas__now" x1="${px(nowIdx)}" y1="0" x2="${px(nowIdx)}" y2="100"></line>
      </svg>`;
}

const statCell = (value, label) => `<div class="sff__stat"><b>${value}</b><span>${label}</span></div>`;

export function surfBoard(vm, cfg) {
  const units = cfg?.loc?.units ?? 'F';
  const clock24 = Boolean(cfg?.clock24);
  const hours = vm.hourly;
  const n = hours.length;
  let peak = 0;
  hours.forEach((h, i) => { if (h.wave > hours[peak].wave) peak = i; });
  const anchors = new Set(labelAnchors(n, peak));
  // The word rides the WIDEST dark band, not simply the first: a window that
  // opens before dawn starts on a two-hour sliver of last night, and a caption
  // centred there would hang off the left edge of the canvas.
  const night = nightRuns(hours, vm.sun).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0] ?? null;
  const pct = (col) => (((col + 0.5) / n) * 100).toFixed(3);

  const heightRow = hours
    .map((h, i) => (anchors.has(i)
      ? `<span class="${i === peak ? 'is-peak' : ''}">${heightValue(h.wave, units)}</span>`
      : '<span></span>'))
    .join('');
  let lastDay = '';
  const hourRow = hours
    .map((h, i) => {
      if (!anchors.has(i)) return '<span></span>';
      const d = dayName(h.iso.slice(0, 10));
      const tag = d === lastDay ? '' : `<span class="sff__day2">${d}</span>`;
      lastDay = d;
      return `<span>${escapeHtml(hourLabel(h.iso, clock24))}${tag}</span>`;
    })
    .join('');

  const days = vm.daily.slice(0, 7).map((d, i) => `<div class="sff__day${i === 0 ? ' sff__day--today' : ''}">
          <span class="sff__dayname">${escapeHtml(d.day)}</span>
          <span class="sff__dayhi">${orDash(d.max, (v) => heightValue(v, units))}</span>
          <span class="sff__dayper">${orDash(d.period, (v) => fmtPeriod(v, 1))}</span>
          <span class="sff__daydir">${orDash(d.dir, compass)}</span>
        </div>`).join('');

  const cmp = (label, c) => `<span>${label}</span>`
    + `<b>${orDash(c.h, (v) => fmtHeight(v, units))}</b>`
    + `<b>${orDash(c.p, (v) => fmtPeriod(v, 1))}</b>`
    + `<span class="sff__cmpdir">${dirArrow(c.d)}${orDash(c.d, compass)}</span>`;

  const d0 = vm.daily[0] ?? {};
  const d1 = vm.daily[1] ?? {};
  // "at 2 PM" is only honest when the window actually contains tomorrow's peak
  // hour; past the 48-hour horizon the daily maximum is all we know.
  const peakIso = hours[peak]?.iso ?? '';
  const peakIsTomorrow = d1.iso && peakIso.slice(0, 10) === d1.iso;
  const sunToday = vm.sun.find((s) => s.iso === d0.iso) ?? {};

  return `<div class="sff">
      <div class="sff__split">

        <div class="sff__nowpane">
          <div class="sff__block">
            <div class="sff__hero"><span class="sff__val">${heightValue(vm.now.wave, units)}</span><span class="sff__unit">${heightUnit(units)}</span></div>
            <div class="sff__sub">${dirArrow(vm.now.dir)}<span>from ${orDash(vm.now.dir, compass)}</span>
              <span class="sff__sep">&middot;</span><span>${orDash(vm.now.period, (v) => fmtPeriod(v, 1))} period</span></div>
            ${vm.snapKm > OFFSHORE_FLOOR_KM ? `<p class="sff__src">Modeled ${fmtOffshore(vm.snapKm, units)} offshore</p>` : ''}
          </div>

          <div class="sff__block">
            <p class="sff__lbl">Wave components</p>
            <div class="sff__cmps">${cmp('Groundswell', vm.swell)}${cmp('Wind wave', vm.windWave)}</div>
          </div>

          <div class="sff__block">
            <div class="sff__rule"></div>
            <div class="sff__kv"><span>Today&rsquo;s peak</span><b>${orDash(d0.max, (v) => fmtHeight(v, units))}</b></div>
            <div class="sff__kv"><span>Tomorrow&rsquo;s peak</span><b>${orDash(d1.max, (v) => fmtHeight(v, units))}${peakIsTomorrow ? `<small>at ${escapeHtml(hourLabel(peakIso, clock24))}</small>` : ''}</b></div>
          </div>
        </div>

        <div class="sff__colright">
          <div class="sff__chart">
            <div class="sff__charthead">
              <p class="sff__lbl">Wave height &middot; 48 hours &middot; ${heightUnit(units)}</p>
              <div class="sff__legend">
                <span class="sff__leg"><i class="sff__legswatch"></i>Total</span>
                <span class="sff__leg"><i class="sff__legswatch sff__legswatch--swell"></i>Groundswell only</span>
              </div>
            </div>
            <div class="sff__row sff__row--h">${heightRow}</div>
            <div class="sff__canvaswrap">
              ${surfCanvas(hours, vm.sun, vm.nowIdx, 'sf-canvas-grad')}
              <span class="sff__nowtag" style="left:${pct(vm.nowIdx)}%">NOW</span>
              ${night ? `<span class="sff__nightlbl" style="left:${pct((night[0] + night[1]) / 2 - 0.5)}%">Night</span>` : ''}
            </div>
            <div class="sff__row sff__row--hours">${hourRow}</div>
          </div>
          <div class="sff__days">${days}</div>
        </div>

      </div>
      <div class="sff__stats">
        ${statCell(orDash(vm.now.sst, (v) => fmtTemp(Math.round(v), units)), 'Water')}
        ${statCell(orDash(vm.air, (v) => fmtTemp(Math.round(v), units)), 'Air')}
        ${statCell(orDash(vm.wind.speed, (v) => fmtWind(v, units) + (Number.isFinite(vm.wind.dir) ? ` ${compass(vm.wind.dir)}` : '')),
    `Wind${vm.wind.quality ? ` &middot; ${QUALITY_TEXT[vm.wind.quality]}` : ''}`)}
        ${statCell(sunToday.sunrise ? timeLabel(sunToday.sunrise, clock24) : '—', 'Sunrise')}
        ${statCell(sunToday.sunset ? timeLabel(sunToday.sunset, clock24) : '—', 'Sunset')}
      </div>
    </div>`;
}

/* ---------------------------------------------------------------------------
   Render
   --------------------------------------------------------------------------- */

export function render(el, vm, cfg) {
  const spot = effectiveSurfSpot(cfg);
  setCardNote(el, spot.label);
  const units = spot.units;
  // Clear first, register at the end: the empty state and any render that
  // throws partway must leave the card inert, never expandable onto the
  // previous render's data.
  setExpandSource(el, null);

  // A spot that lost its water — or a model that has stopped answering for it —
  // keeps its slot and says so plainly. No amber stamp (nothing is stale), no
  // retry button (the widget retries on its own cadence), and deliberately NOT
  // expandable: a press tint would promise a detail view with nothing in it.
  if (!vm?.ocean) {
    el.innerHTML = '<p class="empty">No ocean data for this spot right now</p>';
    return;
  }

  const [w] = cardSize(el, [3, 3]);
  const wide = w >= 4;
  const cols = cardColumns(vm.hourly, vm.nowIdx, wide ? 8 : 6);

  const valueRow = cols.map((h) => `<span>${heightValue(h.wave, units)}</span>`).join('');
  const hourRow = cols.map((h) => `<span>${escapeHtml(hourLabel(h.iso, cfg?.clock24))}</span>`).join('');

  // The swell bearing, and — where the fourth column pays for it — how much of
  // the total is real groundswell rather than local chop.
  const swellText = [
    Number.isFinite(vm.now.dir) ? `${compass(vm.now.dir)} swell` : '',
    wide && Number.isFinite(vm.swell.h) ? `${fmtHeight(vm.swell.h, units)} groundswell` : '',
  ].filter(Boolean).join(' · ');

  const quality = vm.wind.quality ? QUALITY_TEXT[vm.wind.quality] : '';
  // Honesty stamp. A 3-wide foot has room for exactly one thing on the right,
  // and the wind's quality outranks provenance there; the fourth column buys
  // the offshore distance back, and the full-screen view always carries it.
  const stamp = wide && vm.snapKm > OFFSHORE_FLOOR_KM
    ? `Modeled ${fmtOffshore(vm.snapKm, units)} offshore`
    : (!wide ? quality : '');

  el.innerHTML = `
    <div class="sf-now">
      <span class="sf-now__val">${heightValue(vm.now.wave, units)}</span><span class="sf-now__unit">${heightUnit(units)}</span>
      <div class="sf-now__meta">
        <span class="sf-now__label">${orDash(vm.now.period, (v) => fmtPeriod(v))} period</span>
        <span class="sf-now__sub">${dirArrow(vm.now.dir)}${escapeHtml(swellText)}</span>
      </div>
    </div>
    <div class="sf-trend">
      <div class="sf-trend__row">${valueRow}</div>
      ${waveChart(cols.map((h) => h.wave), 'sf-trend-grad')}
      <div class="sf-trend__row sf-trend__row--hours">${hourRow}</div>
    </div>
    <div class="sf-foot">
      <div class="sf-foot__item"><span class="sf-foot__k">Water</span><span class="sf-foot__v">${orDash(vm.now.sst, (v) => fmtTemp(Math.round(v), units))}</span></div>
      <div class="sf-foot__item"><span class="sf-foot__k">Wind</span><span class="sf-foot__v">${orDash(vm.wind.speed, (v) => `${Math.round(units === 'C' ? v * 1.609344 : v)}${Number.isFinite(vm.wind.dir) ? ` ${compass(vm.wind.dir)}` : ''}`)}</span>${wide && quality ? `<span class="sf-foot__q">${quality}</span>` : ''}</div>
      ${stamp ? `<span class="sf-foot__stamp">${escapeHtml(stamp)}</span>` : ''}
    </div>`;

  // Surf ALWAYS has detail once it has data: nothing on the card is capped
  // away, so there is no hidden-row condition to gate on and no "+N" badge to
  // agree with. The closure captures THIS render's vm, so the overlay always
  // shows what the card was showing when it was tapped.
  setExpandSource(el, () => ({
    title: meta.title,
    note: spot.label,
    bodyHtml: surfBoard(vm, cfg),
  }));
}

/* ---------------------------------------------------------------------------
   Fetch

   TWO calls, ~1.9 weighted Open-Meteo units per refresh (their weight is
   variables/10). The marine endpoint accepts `current=wind_speed_10m` but
   answers null with unit "undefined" — it serves marine variables only —
   so the wind has to come from the forecast API. It is fetched here rather
   than borrowed from the weather widget's cache for the reason aqi.js states
   for its own sun-times call: no dependency on another widget being enabled,
   or having fetched first. At a 30-minute cadence that is ~91 weighted calls a
   day per board against a free ceiling of 10,000.
   --------------------------------------------------------------------------- */

export function marineUrl({ lat, lon }) {
  // past_days=1 buys the six hours of history that put "now" in the interior of
  // the overlay's chart instead of hard against its left edge.
  return `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}`
    + '&current=wave_height,wave_period,wave_direction,sea_surface_temperature'
    + '&hourly=wave_height,swell_wave_height,swell_wave_period,swell_wave_direction,wind_wave_height,wind_wave_period,wind_wave_direction'
    + '&daily=wave_height_max,wave_period_max,wave_direction_dominant'
    + '&past_days=1&forecast_days=7&timezone=auto&length_unit=imperial&temperature_unit=fahrenheit';
}

export function windUrl({ lat, lon }) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + '&current=temperature_2m,wind_speed_10m,wind_direction_10m'
    + '&daily=sunrise,sunset'
    + '&past_days=1&forecast_days=3&timezone=auto&temperature_unit=fahrenheit&wind_speed_unit=mph';
}

export async function fetchData(cfg, net) {
  const spot = effectiveSurfSpot(cfg);
  const [marine, wx] = await Promise.all([
    net.fetchJSON(marineUrl(spot)),
    // The wind is an enhancement: without it the card still reads the water and
    // only the quality word goes missing.
    net.fetchJSON(windUrl(spot)).catch(() => null),
  ]);
  const vm = mapSurf(marine, wx, spot);
  // A placed card re-earns the add-picker gate for free out of the refresh it
  // was making anyway, so a board that already shows Surf never pays for a
  // standalone probe.
  writeProbe({
    key: spotKey(spot),
    t: Date.now(),
    ocean: vm.ocean,
    km: Number.isFinite(vm.snapKm) ? Number(vm.snapKm.toFixed(2)) : null,
    bearing: Number.isFinite(vm.shoreBearing) ? Number(vm.shoreBearing.toFixed(1)) : null,
  });
  return vm;
}
