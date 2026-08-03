// iCal Calendar widget. Fetches one or more iCal feeds via the Worker proxy
// (/ical?url=…) and shows today's events plus the next N days. Supports
// Google Calendar share links (webcal:// or https://), Apple iCloud Calendar
// public links, Nextcloud, and any standard RFC 5545 .ics feed.

import { escapeHtml } from '../util.js';
import { cardSize, sizeTier } from '../capacity.js';
import { t, currentLang } from '../i18n.js';
import { WORKER_URL } from '../env.js';

export const meta = { id: 'calendar', title: 'Calendar', refreshMs: 5 * 60 * 1000 };

// Format a time string from an ISO datetime for display.
function fmtTime(iso, clock24) {
  if (!iso) return '';
  const d = new Date(iso);
  if (clock24) {
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

// Return 'YYYY-MM-DD' from an ISO string (UTC date).
function isoDate(iso) {
  return iso ? iso.slice(0, 10) : '';
}

// Day label for a date string like '2024-08-15'.
function dayLabel(dateStr, todayStr, tomorrowStr, lang) {
  if (dateStr === todayStr) return t('cal.today');
  if (dateStr === tomorrowStr) return t('cal.tomorrow');
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString(lang, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function render(el, vm, cfg) {
  const [, h] = cardSize(el, [2, 4]);
  const compact = sizeTier(h) === 's';
  const clock24 = cfg?.clock24;
  const lang = currentLang();

  if (!vm.events?.length) {
    el.innerHTML = `<div class="cal cal--empty"><p class="cal__empty">${t(vm.feeds?.length ? 'cal.no_events' : 'ui.tap_to_configure')}</p></div>`;
    return;
  }

  const now = new Date();
  const todayStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  const tomorrow = new Date(now.getTime() + 86400000);
  const tomorrowStr = `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, '0')}-${String(tomorrow.getUTCDate()).padStart(2, '0')}`;

  // Group events by date
  const byDay = new Map();
  for (const ev of vm.events) {
    const d = isoDate(ev.start);
    if (!byDay.has(d)) byDay.set(d, { allDay: [], timed: [] });
    if (ev.allDay) byDay.get(d).allDay.push(ev);
    else byDay.get(d).timed.push(ev);
  }

  let html = '<div class="cal">';
  const maxDays = compact ? 3 : 7;
  let daysShown = 0;

  for (const [dateStr, { allDay, timed }] of byDay) {
    if (daysShown >= maxDays) break;
    const label = dayLabel(dateStr, todayStr, tomorrowStr, lang);
    html += `<div class="cal__day"><span class="cal__day-label">${escapeHtml(label)}</span>`;

    // All-day events first
    for (const ev of allDay) {
      html += `<div class="cal__event cal__event--allday">
        <span class="cal__event-time">${t('cal.all_day')}</span>
        <span class="cal__event-title">${escapeHtml(ev.summary)}</span>
        ${ev.location && !compact ? `<span class="cal__event-loc">${escapeHtml(ev.location)}</span>` : ''}
      </div>`;
    }
    // Timed events
    for (const ev of timed) {
      const startTime = fmtTime(ev.start, clock24);
      html += `<div class="cal__event">
        <span class="cal__event-time">${escapeHtml(startTime)}</span>
        <span class="cal__event-title">${escapeHtml(ev.summary)}</span>
        ${ev.location && !compact ? `<span class="cal__event-loc">${escapeHtml(ev.location)}</span>` : ''}
      </div>`;
    }

    html += '</div>';
    daysShown++;
  }
  html += '</div>';
  el.innerHTML = html;
}

export async function fetchData(cfg, net) {
  const feeds = cfg.calendar?.feeds ?? [];
  if (!feeds.length) return { events: [], feeds: [] };

  const days = cfg.calendar?.days ?? 7;

  const settled = await Promise.allSettled(
    feeds.map(({ url }) =>
      net.fetchJSON(`${WORKER_URL}/ical?url=${encodeURIComponent(url)}&days=${days}`)
    ),
  );

  const all = [];
  for (const r of settled) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) all.push(...r.value);
  }

  if (!all.length && settled.every((r) => r.status === 'rejected')) {
    throw new Error('calendar: all feeds failed');
  }

  // Merge and sort by start time
  all.sort((a, b) => a.start.localeCompare(b.start));

  return { events: all, feeds: feeds.map((f) => f.url) };
}
