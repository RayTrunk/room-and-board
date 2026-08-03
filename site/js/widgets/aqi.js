// Air quality + sun/moon widget. AQI from Open-Meteo's air-quality API
// (browser-direct); sunrise/sunset piggyback on the weather view model;
// moon phase is computed locally.

import { escapeHtml } from '../util.js';
import { icon } from '../icons.js';
import { cardSize, sizeTier } from '../capacity.js';
import { t, currentLang } from '../i18n.js';

export const meta = { id: 'aqi', title: 'Air & Sky', refreshMs: 60 * 60 * 1000 };

const timeOnly = (iso, clock24) => {
  if (!iso) return '—';
  const h = Number(iso.slice(11, 13));
  const m = iso.slice(14, 16);
  if (clock24) return `${String(h).padStart(2, '0')}:${m}`;
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${m} ${h < 12 ? 'AM' : 'PM'}`;
};

export function render(el, vm, cfg) {
  // Two labeled stat blocks side by side (AQI and UV), then the sun/moon
  // rows. Tall cards label each reading with a head ("AIR QUALITY"); shallow
  // cards can't afford head rows, so the label rides inline instead.
  const [, h] = cardSize(el, [2, 4]);
  const shallow = sizeTier(h) === 's';
  const clock24 = cfg?.clock24;
  const stat = (band, head, value, label) => `
    <div class="sky__aqi sky__aqi--${band}">
      ${shallow ? '' : `<div class="sky__aqi-head">${head}</div>`}
      <div class="sky__aqi-reading">
        <span class="sky__aqi-value">${value}</span>
        <span class="sky__aqi-label">${label}</span>
      </div>
    </div>`;
  const aqiBand = vm.aqi <= 50 ? 'good' : vm.aqi <= 100 ? 'moderate' : 'bad';
  const uvBand = vm.uv <= 2 ? 'good' : vm.uv <= 7 ? 'moderate' : 'bad';
  const moonName = moonPhaseName(vm.moonPhase.fraction);
  el.innerHTML = `
    <div class="sky">
      <div class="sky__stats${vm.uv == null ? ' sky__stats--single' : ''}">
        ${stat(aqiBand, t('aqi.air_quality'), vm.aqi, `${shallow ? 'AQI · ' : ''}${escapeHtml(t(CATEGORY_KEY[vm.category] ?? vm.category))}`)}
        ${vm.uv != null ? stat(uvBand, t('aqi.uv_index'), vm.uv, `${shallow ? 'UV · ' : ''}${uvLabel(vm.uv)}`) : ''}
      </div>
      <div class="sky__row">${icon('sun', 'icon--sm')}<span>${t('wx.sunrise')} ${timeOnly(vm.sunrise, clock24)}</span></div>
      <div class="sky__row">${icon('sun', 'icon--sm')}<span>${t('wx.sunset')} ${timeOnly(vm.sunset, clock24)}</span></div>
      <div class="sky__row">${icon('moon', 'icon--sm')}<span>${escapeHtml(moonName)}</span></div>
    </div>`;
}

// WHO UV index bands — i18n keys
export function uvLabel(uv) {
  return t(uv <= 2 ? 'aqi.uv_low' : uv <= 5 ? 'aqi.uv_moderate' : uv <= 7 ? 'aqi.uv_high' : uv <= 10 ? 'aqi.uv_very_high' : 'aqi.uv_extreme');
}

// AQI categories — English strings kept in vm for API compat; render() translates.
const CATEGORIES = [
  [50,       'Good',            'aqi.good'],
  [100,      'Moderate',        'aqi.moderate'],
  [150,      'Sensitive groups','aqi.sensitive'],
  [200,      'Unhealthy',       'aqi.unhealthy'],
  [300,      'Very Unhealthy',  'aqi.very_unhealthy'],
  [Infinity, 'Hazardous',       'aqi.hazardous'],
];

export function aqiCategory(aqi) {
  for (const [max, label] of CATEGORIES) if (aqi <= max) return label;
  return 'Hazardous';
}

// Map English AQI label → i18n key for render()
const CATEGORY_KEY = Object.fromEntries(CATEGORIES.map(([, label, key]) => [label, key]));

// Synodic month approximation anchored at the 2000-01-06 18:14 UTC new moon.
const SYNODIC_DAYS = 29.53058867;
const ANCHOR_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

// English phase names (kept in vm for API compat) → i18n key mapping for render()
const PHASE_NAMES = [
  'New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
  'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent',
];
const PHASE_KEY = {
  'New Moon': 'moon.new_moon', 'Waxing Crescent': 'moon.waxing_crescent',
  'First Quarter': 'moon.first_quarter', 'Waxing Gibbous': 'moon.waxing_gibbous',
  'Full Moon': 'moon.full_moon', 'Waning Gibbous': 'moon.waning_gibbous',
  'Last Quarter': 'moon.last_quarter', 'Waning Crescent': 'moon.waning_crescent',
};

export function moonPhaseName(fraction) {
  const name = PHASE_NAMES[Math.round(fraction * 8) % 8];
  return t(PHASE_KEY[name] ?? name);
}

export function moonPhase(date) {
  const days = (date.getTime() - ANCHOR_NEW_MOON) / 86400000;
  const fraction = ((days / SYNODIC_DAYS) % 1 + 1) % 1;
  const index = Math.round(fraction * 8) % 8;
  return { name: PHASE_NAMES[index], fraction };
}

export function mapAqi(aqJson, sunJson, now) {
  // Open-Meteo returns us_aqi:null when it has no reading; Math.round(null) is
  // 0 ("Good") and Math.round(undefined) is NaN ("Hazardous") — both are
  // confidently-wrong dials. Throw so the stale cached reading keeps showing.
  const rawAqi = aqJson?.current?.us_aqi;
  if (!Number.isFinite(rawAqi)) throw new Error('aqi: no us_aqi reading');
  const aqi = Math.round(rawAqi);
  // CURRENT UV, not the daily max: the card is a "now" reading and the max
  // ran 3+ points hot against every consumer weather app until midday
  // (peak 8 shown at 9 AM while the sky said 5). Fall back to the daily max
  // only when the current reading is missing.
  const uvNow = sunJson?.current?.uv_index;
  const uvMax = sunJson?.daily?.uv_index_max?.[0];
  const uv = Number.isFinite(uvNow) ? uvNow : uvMax;
  return {
    aqi,
    category: aqiCategory(aqi),
    sunrise: sunJson?.daily?.sunrise?.[0] ?? null,
    sunset: sunJson?.daily?.sunset?.[0] ?? null,
    uv: Number.isFinite(uv) ? Math.round(uv) : null, // row omitted when absent
    moonPhase: moonPhase(now),
  };
}

export async function fetchData(cfg, net) {
  const { lat, lon } = cfg.loc;
  const [aq, sun] = await Promise.all([
    net.fetchJSON(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi&timezone=auto`,
    ),
    // Own tiny forecast call for sun times — no dependency on the weather
    // widget being enabled or having fetched first.
    net
      .fetchJSON(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=uv_index&daily=sunrise,sunset,uv_index_max&forecast_days=1&timezone=auto`,
      )
      .catch(() => null),
  ]);
  return mapAqi(aq, sun, new Date());
}
