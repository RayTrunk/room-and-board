import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { mapWeather, wmoInfo, inUS, fetchData, trendSvg } from '../site/js/widgets/weather.js';
import { mapAqi, moonPhase } from '../site/js/widgets/aqi.js';

const fixture = async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

describe('mapWeather', () => {
  it('maps the open-meteo fixture', async () => {
    const vm = mapWeather(await fixture('open-meteo-forecast.json'), null);
    expect(vm.now.temp).toBe(83); // 82.9 rounded
    expect(vm.now.feels).toBe(92);
    expect(vm.now.label).toBe('Clear');
    expect(vm.hourly).toHaveLength(8);
    // current.time is 02:15 → first hourly slot is 03:00 (next full hour)
    expect(vm.hourly[0].h).toBe('3 AM');
    expect(vm.daily).toHaveLength(5);
    expect(vm.daily[0].hi).toBe(105);
    expect(vm.daily[0].lo).toBe(80);
    expect(vm.sunrise).toBe('2026-07-02T05:28');
    expect(vm.sunset).toBe('2026-07-02T20:30');
    expect(vm.alert).toBeNull();
  });

  it('surfaces the most severe active alert', async () => {
    const vm = mapWeather(
      await fixture('open-meteo-forecast.json'),
      await fixture('nws-alerts.json'),
    );
    expect(vm.alert).not.toBeNull();
    expect(vm.alert.event).toMatch(/Heat/);
    expect(typeof vm.alert.headline).toBe('string');
  });

  it('carries the hourly chance of precipitation', async () => {
    const vm = mapWeather(await fixture('open-meteo-forecast.json'), null);
    expect(vm.hourly.map((x) => x.pp)).toEqual([0, 0, 5, 10, 25, 45, 60, 30]);
  });

  it('nulls the chance of precipitation when the payload lacks it', async () => {
    const forecast = await fixture('open-meteo-forecast.json');
    delete forecast.hourly.precipitation_probability;
    const vm = mapWeather(forecast, null);
    expect(vm.hourly).toHaveLength(8);
    expect(vm.hourly.every((x) => x.pp === null)).toBe(true);
    // A payload that carries the key but runs short (partial response) also
    // nulls out rather than leaking undefined/NaN into the markup.
    const short = await fixture('open-meteo-forecast.json');
    short.hourly.precipitation_probability = [0, 0, 0, 0, 0];
    expect(mapWeather(short, null).hourly.map((x) => x.pp))
      .toEqual([0, 0, null, null, null, null, null, null]);
  });

  it('tolerates malformed alerts payloads', async () => {
    const forecast = await fixture('open-meteo-forecast.json');
    expect(mapWeather(forecast, {}).alert).toBeNull();
    expect(mapWeather(forecast, { features: 'nope' }).alert).toBeNull();
  });
});

describe('wmoInfo', () => {
  it('maps representative codes', () => {
    expect(wmoInfo(0)).toEqual({ label: 'Clear', icon: 'clear' });
    expect(wmoInfo(3).label).toBe('Overcast');
    expect(wmoInfo(45).icon).toBe('fog');
    expect(wmoInfo(63).icon).toBe('rain');
    expect(wmoInfo(75).icon).toBe('snow');
    expect(wmoInfo(95).icon).toBe('thunder');
    expect(wmoInfo(9999)).toEqual({ label: '—', icon: 'clear' });
  });
});

describe('trendSvg domain window', () => {
  // The line path's y span, in viewBox units. The drawing band is TOP..BOT =
  // 14..86, so 72 units is a curve that fills the chart top to bottom.
  const SPAN = 72;
  const yExtent = (svg) => {
    const d = svg.match(/class="wx-trend__line" d="([^"]+)"/)[1];
    const ys = d.replace(/[ML]/g, ' ').trim().split(/\s+/).map(Number)
      .filter((_, i) => i % 2 === 1);
    return Math.max(...ys) - Math.min(...ys);
  };
  // The user's own calm night: 4 degrees of drift across the strip.
  const FLAT = [69, 68, 68, 67, 66, 66, 65, 67];

  it('keeps a flat night calm as the chart grows (window 6/10/14/18 by tier)', () => {
    // Default (h <= 5, 100px chart): unchanged, 4 degrees over a 6-degree
    // window is most of the band.
    expect(yExtent(trendSvg(FLAT, 'g'))).toBeCloseTo(44.25, 1);
    expect(yExtent(trendSvg(FLAT, 'g', 6))).toBeCloseTo(44.25, 1);
    // Taller tiers widen the window in step with the CSS chart-height ladder,
    // so the same drift stops reading as a plunge.
    expect(yExtent(trendSvg(FLAT, 'g', 10))).toBeCloseTo(26.55, 1); // h=6
    expect(yExtent(trendSvg(FLAT, 'g', 14))).toBeCloseTo(18.97, 1); // h=7
    expect(yExtent(trendSvg(FLAT, 'g', 18))).toBeCloseTo(14.75, 1); // h=8
    // At the tallest tier the calm night uses a fifth of the band, not two thirds.
    expect(yExtent(trendSvg(FLAT, 'g', 18)) / SPAN).toBeLessThan(0.25);
    expect(yExtent(trendSvg(FLAT, 'g', 6)) / SPAN).toBeGreaterThan(0.55);
  });

  it('leaves a real swing byte-identical at every tier', () => {
    // 20 degrees exceeds even the widest window, so the domain is the actual
    // range +/- 1 and the path must not move at all.
    const swing = [58, 62, 67, 72, 76, 78, 71, 63];
    const base = trendSvg(swing, 'g');
    for (const mw of [6, 10, 14, 18]) expect(trendSvg(swing, 'g', mw)).toBe(base);
  });
});

describe('mapAqi', () => {
  it('maps AQI value, category and its own sun times', async () => {
    // Sun times come from the widget's own forecast call, not the weather
    // widget's cache (which may not exist or may be disabled entirely).
    const sunJson = await fixture('open-meteo-forecast.json');
    const vm = mapAqi(await fixture('open-meteo-aq.json'), sunJson, new Date('2026-07-02T12:00:00'));
    expect(vm.aqi).toBe(66);
    expect(vm.category).toBe('Moderate');
    expect(vm.sunrise).toBe('2026-07-02T05:28');
    expect(vm.sunset).toBe('2026-07-02T20:30');
    expect(vm.uv).toBe(5); // CURRENT uv (4.6 rounded), not the daily max
    expect(vm.moonPhase.name).toBeTypeOf('string');
  });

  it('falls back to the daily max when the current uv reading is missing', () => {
    const sun = { daily: { sunrise: ['x'], sunset: ['x'], uv_index_max: [7.8] } };
    expect(mapAqi({ current: { us_aqi: 40 } }, sun, new Date('2026-07-02')).uv).toBe(8);
  });

  it('degrades to null sun times when the forecast call fails', async () => {
    const vm = mapAqi(await fixture('open-meteo-aq.json'), null, new Date('2026-07-02T12:00:00'));
    expect(vm.aqi).toBe(66);
    expect(vm.sunrise).toBeNull();
    expect(vm.sunset).toBeNull();
  });

  it('categorizes boundaries', async () => {
    const aq = (v) => ({ current: { us_aqi: v } });
    const d = new Date('2026-07-02');
    expect(mapAqi(aq(50), null, d).category).toBe('Good');
    expect(mapAqi(aq(101), null, d).category).toBe('Sensitive groups');
    expect(() => mapAqi({ current: { us_aqi: null } }, null, d)).toThrow();
    expect(() => mapAqi({ current: {} }, null, d)).toThrow();
    expect(mapAqi(aq(101), null, d).uv).toBeNull();
    expect(mapAqi(aq(40), { daily: { uv_index_max: [6.4] } }, d).uv).toBe(6);
    expect(mapAqi(aq(250), null, d).category).toBe('Very Unhealthy');
  });
});

describe('moonPhase', () => {
  it('finds the new moon on 2026-01-18', () => {
    const p = moonPhase(new Date(Date.UTC(2026, 0, 18, 20, 0)));
    expect(p.fraction).toBeLessThan(0.04);
    expect(p.name).toBe('New Moon');
  });
  it('finds the full moon on 2026-02-01', () => {
    const p = moonPhase(new Date(Date.UTC(2026, 1, 1, 22, 0)));
    expect(Math.abs(p.fraction - 0.5)).toBeLessThan(0.02);
    expect(p.name).toBe('Full Moon');
  });
});

describe('inUS + alerts gating', () => {
  it('covers NYC, Honolulu, Anchorage; excludes London and Berlin', () => {
    expect(inUS(40.75, -73.99)).toBe(true);
    expect(inUS(21.3, -157.8)).toBe(true);
    expect(inUS(61.2, -149.9)).toBe(true);
    expect(inUS(51.5, -0.12)).toBe(false);
    expect(inUS(52.52, 13.4)).toBe(false);
  });
  it('fetchData skips the NWS alerts call for a non-US point', async () => {
    const urls = [];
    const net = { fetchJSON: async (u) => { urls.push(u); return { current: { time: '2026-07-12T10:00', temperature_2m: 70, apparent_temperature: 70, weather_code: 0 }, hourly: { time: [], temperature_2m: [], weather_code: [] }, daily: { time: [], temperature_2m_max: [], temperature_2m_min: [], weather_code: [], sunrise: ['x'], sunset: ['x'] } }; } };
    await fetchData({ loc: { lat: 51.5, lon: -0.12, units: 'C' } }, net);
    expect(urls).toHaveLength(1);
    expect(urls[0]).not.toContain('api.weather.gov');
  });
  it('fetchData asks Open-Meteo for the hourly chance of precipitation', async () => {
    const urls = [];
    const net = { fetchJSON: async (u) => { urls.push(u); return { current: { time: '2026-07-12T10:00', temperature_2m: 70, apparent_temperature: 70, weather_code: 0 }, hourly: { time: [], temperature_2m: [], weather_code: [] }, daily: { time: [], temperature_2m_max: [], temperature_2m_min: [], weather_code: [], sunrise: ['x'], sunset: ['x'] } }; } };
    await fetchData({ loc: { lat: 51.5, lon: -0.12, units: 'C' } }, net);
    expect(urls[0]).toContain('hourly=temperature_2m,weather_code,precipitation_probability');
  });
});
