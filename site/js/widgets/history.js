// "This Day in History" from Wikimedia's on-this-day feed (browser-direct,
// CORS-open, keyless). Picks five events spread across the centuries.

import { escapeHtml, setMoreBadge } from '../util.js';
import { itemCapacity, cardSize } from '../capacity.js';
import { setExpandSource } from '../expand.js';

export const meta = { id: 'history', title: 'This Day in History', refreshMs: 24 * 60 * 60 * 1000 };

export function render(el, vm, _cfg) {
  if (!vm.events?.length) {
    el.innerHTML = '<div class="empty">No events for today</div>';
    setMoreBadge(el, 0);
    setExpandSource(el, null);
    return;
  }
  const [w, h] = cardSize(el, [6, 2]);
  const cap = itemCapacity('history', w, h);
  const row = (e) => `<div class="history__item">
        <span class="history__year">${e.year}</span>
        <span class="history__text">${escapeHtml(e.text)}</span>
      </div>`;
  const rows = vm.events.map(row);
  const hidden = rows.length - Math.min(cap, rows.length);
  el.innerHTML = `<div class="history">${rows.slice(0, cap).join('')}</div>`;
  // The overflow count rides the corner badge; with an expansion behind it,
  // it reads "+N more" as the tap invitation (the rail grammar).
  setMoreBadge(el, hidden, { verbose: true });
  // Whole-card tap for the whole day (Sean's pick, mockup A): the grand
  // centered reading list of every event, the card's own rows at reading size.
  setExpandSource(
    el,
    hidden > 0
      ? () => ({
          title: meta.title,
          note: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
          bodyHtml: `<div class="history history-board">${rows.join('')}</div>`,
        })
      : null,
  );
}

export function mapHistory(json, count = 9) {
  const events = (Array.isArray(json?.events) ? json.events : [])
    .filter((e) => Number.isFinite(e?.year) && typeof e?.text === 'string')
    .sort((a, b) => a.year - b.year);
  if (events.length <= count) {
    return { events: events.map((e) => ({ year: e.year, text: e.text })) };
  }
  // Spread picks evenly across the sorted list for a mix of eras.
  const picked = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i * (events.length - 1)) / (count - 1));
    picked.push(events[idx]);
  }
  const unique = [...new Map(picked.map((e) => [e.year, e])).values()];
  // Backfill if rounding collapsed picks onto the same year.
  for (const e of events) {
    if (unique.length >= count) break;
    if (!unique.some((u) => u.year === e.year)) unique.push(e);
  }
  unique.sort((a, b) => a.year - b.year);
  return { events: unique.slice(0, count).map((e) => ({ year: e.year, text: e.text })) };
}

export async function fetchData(cfg, net) {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const json = await net.fetchJSON(
    `https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/events/${mm}/${dd}`,
  );
  return mapHistory(json);
}
