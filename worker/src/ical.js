// iCal proxy: fetches an .ics file from any safe URL, parses VEVENT records,
// and returns them as JSON. Handles Google Calendar webcal URLs, Apple iCloud
// Calendar, Nextcloud, and any standard RFC 5545 iCalendar feed.

// Same SSRF block list as rss.js — keep in sync.
const BLOCKED_PATTERNS = [
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\./,
  /^https?:\/\/0\./,
  /^https?:\/\/\[::1\]/,
  /^https?:\/\/169\.254\./,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/metadata\./i,
  /^https?:\/\/169\.254\.169\.254/,
];

export function isSafeIcalUrl(raw) {
  if (typeof raw !== 'string') return false;
  // webcal:// is a browser alias for https://, normalize it
  const normalized = raw.replace(/^webcal:\/\//i, 'https://').replace(/^http:\/\//i, 'https://');
  let url;
  try { url = new URL(normalized); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  return !BLOCKED_PATTERNS.some((re) => re.test(url.toString()));
}

export function normalizeIcalUrl(raw) {
  return raw.replace(/^webcal:\/\//i, 'https://');
}

// Unfold RFC 5545 line continuations (CRLF + space/tab → nothing).
function unfold(text) {
  return text.replace(/\r\n[ \t]/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// Parse a single DATE or DATE-TIME value to a JS Date.
// Returns null for unrecognized formats.
function parseIcalDate(value) {
  if (!value) return null;
  // DATE-TIME with Z suffix (UTC)
  const dtUtc = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (dtUtc) {
    const [, y, mo, d, h, mi, s] = dtUtc;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  }
  // DATE-TIME local (TZID handled by treating as UTC, close enough for display)
  const dtLocal = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (dtLocal) {
    const [, y, mo, d, h, mi, s] = dtLocal;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  }
  // DATE only (all-day)
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    return new Date(Date.UTC(+y, +mo - 1, +d));
  }
  return null;
}

// Extract the raw value from a content line (strip property name + parameters).
function lineValue(line) {
  const colon = line.indexOf(':');
  return colon >= 0 ? line.slice(colon + 1).trim() : '';
}

// Check if a DTSTART property is an all-day (DATE-only) value.
function isAllDay(propLine) {
  // DATE;VALUE=DATE:20240815 or DTSTART;VALUE=DATE:20240815
  if (/;VALUE=DATE[^-]/i.test(propLine)) return true;
  // Bare DATE format: no T in the value portion
  const val = lineValue(propLine);
  return /^\d{8}$/.test(val);
}

// Parse iCalendar text into an array of event objects.
// Fields: summary, start (Date), end (Date|null), allDay (bool), location (string), uid (string)
export function parseIcal(text) {
  const lines = unfold(text).split('\n');
  const events = [];
  let inEvent = false;
  let ev = null;
  let startLine = '';

  for (const raw of lines) {
    const line = raw.trim();
    const upper = line.toUpperCase();

    if (upper === 'BEGIN:VEVENT') {
      inEvent = true;
      ev = { summary: '', start: null, end: null, allDay: false, location: '', uid: '' };
      startLine = '';
      continue;
    }
    if (upper === 'END:VEVENT') {
      inEvent = false;
      if (ev && ev.start) events.push(ev);
      ev = null;
      continue;
    }
    if (!inEvent || !ev) continue;

    if (/^SUMMARY[;:]/i.test(line)) {
      ev.summary = lineValue(line).replace(/\\,/g, ',').replace(/\\n/gi, ' ').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
    } else if (/^DTSTART[;:]/i.test(line)) {
      startLine = line;
      ev.allDay = isAllDay(line);
      ev.start = parseIcalDate(lineValue(line));
    } else if (/^DTEND[;:]/i.test(line)) {
      ev.end = parseIcalDate(lineValue(line));
    } else if (/^LOCATION[;:]/i.test(line)) {
      ev.location = lineValue(line).replace(/\\,/g, ',').replace(/\\n/gi, ', ').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
    } else if (/^UID[;:]/i.test(line)) {
      ev.uid = lineValue(line);
    } else if (/^RRULE[;:]/i.test(line)) {
      // Skip recurring events for now; flag so we can filter later if needed
      ev._hasRrule = true;
    }
  }

  return events
    .filter((e) => e.start)
    .sort((a, b) => a.start - b.start);
}

// Serialize events as a lean JSON payload (timestamps as ISO strings).
function eventsToJson(events, now, daysAhead) {
  const cutoff = new Date(now.getTime() + daysAhead * 86400000);
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  return events
    .filter((e) => {
      // Show events that haven't ended yet (or all-day events for today+)
      const end = e.end ?? e.start;
      return end >= todayStart && e.start <= cutoff;
    })
    .map((e) => ({
      summary: e.summary || '(No title)',
      start: e.start.toISOString(),
      end: e.end ? e.end.toISOString() : null,
      allDay: e.allDay,
      location: e.location || null,
      uid: e.uid || null,
    }));
}

export async function fetchIcal(url, daysAhead = 30) {
  if (!isSafeIcalUrl(url)) throw new Error('ical: blocked url');
  const safeUrl = normalizeIcalUrl(url);
  const res = await fetch(safeUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 board-pro-signage',
      'Accept': 'text/calendar, text/plain, */*',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`ical: ${res.status}`);
  const text = await res.text();
  const events = parseIcal(text);
  return eventsToJson(events, new Date(), daysAhead);
}
