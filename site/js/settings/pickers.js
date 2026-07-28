// Pure selectors behind the tap-only station pickers.

export function boroughs(stations) {
  return [...new Set(stations.map((s) => s.borough))];
}

export function linesForBorough(stations, borough) {
  const lines = new Set();
  for (const s of stations) if (s.borough === borough) for (const l of s.lines) lines.add(l);
  return [...lines].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

export function stationsForLine(stations, borough, line) {
  return stations
    .filter((s) => s.borough === borough && s.lines.includes(line))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function alphaSections(stations) {
  const sections = [];
  for (const s of stations) {
    const letter = s.name[0].toUpperCase();
    let section = sections[sections.length - 1];
    if (!section || section.letter !== letter) {
      section = { letter, stations: [] };
      sections.push(section);
    }
    section.stations.push(s);
  }
  return sections;
}

// Citi Bike station name search. Already-chosen stations are INCLUDED and
// flagged `added` — hiding them made searching a pre-populated default read
// as "no results" (the picker renders them inert instead).
export function searchStations(stations, query, chosenIds, max = 20) {
  const q = String(query ?? '').trim().toUpperCase();
  if (q.length < 2) return [];
  return stations
    .filter((s) => s.name.toUpperCase().includes(q))
    .slice(0, max)
    .map((s) => ({ ...s, added: chosenIds.has(s.id) }));
}

// Toggle membership of value in a list, returning a new list.
export function toggleIn(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

// How many tickers a board may follow. The Markets card still shows only what
// fits it, but a tap expands to a wall of ALL of them, and 20 is the count that
// still fits the 1920x1080 overlay without scrolling (markets.js tileCols and
// shelfFits carry the browser-measured geometry). config.js normalizes to the
// same number, and the Worker's /markets route fetches the same number.
export const TICKER_MAX = 20;

// A single symbol is at most 10 CHARACTERS (^GSPC, 7203.T, ^STOXX50E) — a
// different limit from how many symbols the list holds.
const TICKER_RE = /^[\^A-Z0-9.\-]{1,10}$/;

// The Add guard behind both ticker keypads (Settings and first-run Setup):
// a well-formed symbol, room left in the list, and not already followed.
export const canAddTicker = (symbols, ticker) =>
  TICKER_RE.test(ticker) && symbols.length < TICKER_MAX && !symbols.includes(ticker);

export function moveWidget(ids, id, delta) {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

// Express Bus route-first pickers (data = site/data/express-bus.json shape).
export const expressRoutes = (data) => data.routes.map((r) => ({ id: r.id, lineRef: r.lineRef }));

export function directionsForRoute(data, routeId) {
  const r = data.routes.find((x) => x.id === routeId);
  return r ? r.dirs.map((d) => ({ id: d.id, headsign: d.headsign })) : [];
}

export function stopsForRouteDir(data, routeId, dirId) {
  const r = data.routes.find((x) => x.id === routeId);
  const d = r?.dirs.find((x) => x.id === dirId);
  return d ? d.stops.map((id) => ({ id, name: data.stops[id] ?? id })) : [];
}

export const NAME_MAX_LEN = 24;

// Shift auto-capitalizes the first letter of each word (start of input, or
// after a space/hyphen) so casual names need no shifting.
export const nameAutoCap = (value) => value === '' || /[ -]$/.test(value);

// Pure reducer for the on-board name keypad: given the current {value, shift}
// and a key, return the next state. Case is explicit and saved verbatim, so
// camelCase (McDonald) and hyphenated names (Jean-Paul) are typeable — a
// momentary Shift override plus auto-cap after space/hyphen. `key` is a
// letter A-Z, '-', 'Space', 'Shift', or 'Backspace'.
export function applyNameKey({ value, shift }, key) {
  const bounded = value.length < NAME_MAX_LEN;
  const canSep = value && !/[ -]$/.test(value) && bounded;
  if (key === 'Shift') return { value, shift: !shift };
  if (key === 'Backspace') { const v = value.slice(0, -1); return { value: v, shift: nameAutoCap(v) }; }
  if (key === 'Space') return { value: canSep ? `${value} ` : value, shift: true };
  if (key === '-') return { value: canSep ? `${value}-` : value, shift: true };
  if (/^[A-Za-z]$/.test(key) && bounded) {
    const v = value + (shift ? key.toUpperCase() : key.toLowerCase());
    return { value: v, shift: nameAutoCap(v) };
  }
  return { value, shift };
}
