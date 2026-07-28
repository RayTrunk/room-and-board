// MTA line colors for the LIRR and Metro-North departure boards. A row's line
// name renders as a filled signage chip in the agency's official color, which
// is what makes it read as the LINE at a glance — as plain dim text it just
// looked like a repeat of the destination above it ("Babylon · 8:46 PM" under
// "Babylon"). Keys are the display names the two widgets already produce
// (lirr.js ROUTE_NAMES + TT_BRANCH_NAMES, mnr.js ROUTE_NAMES), so the table is
// a straight lookup with no extra mapping layer.
//
// `ink` is stored per line rather than derived at render time: it's a
// legibility call on the exact hue, and one table beats luminance math running
// once per row per minute. test/transit.test.js gates every pair at the 4.5:1
// AA floor (New Haven red is the one documented exception — see there).

import { escapeHtml } from './util.js';

export const LINE_COLORS = Object.freeze({
  // LIRR branches
  Babylon: Object.freeze({ bg: '#00985F', ink: '#000' }),
  Hempstead: Object.freeze({ bg: '#CE8E00', ink: '#000' }),
  'Oyster Bay': Object.freeze({ bg: '#00AF3F', ink: '#000' }),
  Ronkonkoma: Object.freeze({ bg: '#A626AA', ink: '#fff' }),
  Montauk: Object.freeze({ bg: '#006983', ink: '#fff' }),
  'Long Beach': Object.freeze({ bg: '#FF6319', ink: '#000' }),
  'Far Rockaway': Object.freeze({ bg: '#6E3219', ink: '#fff' }),
  'West Hempstead': Object.freeze({ bg: '#00A1DE', ink: '#000' }),
  'Port Washington': Object.freeze({ bg: '#C60C30', ink: '#fff' }),
  'Port Jefferson': Object.freeze({ bg: '#0039A6', ink: '#fff' }),
  'Belmont Park': Object.freeze({ bg: '#60269E', ink: '#fff' }),
  'City Terminal': Object.freeze({ bg: '#4D5357', ink: '#fff' }),
  // Metro-North lines. The three New Haven branches share the trunk's red,
  // exactly as MTA signage and maps color them.
  Hudson: Object.freeze({ bg: '#009B3A', ink: '#000' }),
  Harlem: Object.freeze({ bg: '#0039A6', ink: '#fff' }),
  'New Haven': Object.freeze({ bg: '#EE0034', ink: '#fff' }),
  'New Canaan': Object.freeze({ bg: '#EE0034', ink: '#fff' }),
  Danbury: Object.freeze({ bg: '#EE0034', ink: '#fff' }),
  Waterbury: Object.freeze({ bg: '#EE0034', ink: '#fff' }),
  'Port Jervis': Object.freeze({ bg: '#FF7900', ink: '#000' }),
  'Pascack Valley': Object.freeze({ bg: '#4D5357', ink: '#fff' }),
});

// Chip markup for one line name, in three cases:
//   known line  -> the filled chip in its official color
//   unmapped    -> the escaped name as plain text, i.e. today's rendering, so
//                  a renamed branch or an undocumented TrainTime code still
//                  shows something true instead of vanishing
//   no name     -> '' (the caller drops its separator too)
export function lineChip(name) {
  const line = String(name ?? '').trim();
  if (!line) return '';
  const c = LINE_COLORS[line];
  if (!c) return escapeHtml(line);
  return `<b class="train__linechip" style="background:${c.bg};color:${c.ink}">${escapeHtml(line)}</b>`;
}

// The line segment of a departure's meta line, separator included — the
// separator belongs to the chip, so a nameless branch reads "8:46 PM" instead
// of the stray " · 8:46 PM" the old template produced.
export function lineChipPrefix(name) {
  const chip = lineChip(name);
  return chip ? `${chip} · ` : '';
}
