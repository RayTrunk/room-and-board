// The widget catalogue: which cards exist, what each one is called on the
// settings surfaces, and where it files in the pickers. One entry per widget
// id, and this file is the only place any of those three facts is written down.
//
// PURE DATA, and it has to stay that way: /setup runs on a phone and
// deliberately imports no widget code, while Settings is lazily imported on the
// board. A catalogue that reached for a widget module would drag all 35 of them
// onto both surfaces (and onto the phone) the moment either asked for a label.
// So: no widget imports, no DOM, no config. Everything here is a string.
//
// SCOPE, deliberately narrow: identity and display. Geometry and capacity stay
// in the modules that measured them (layout.js MIN_SIZE/MAX_SIZE, capacity.js
// MODELS, layout-optimize.js DEMAND/FLOOR): those tables are calibrations, not
// declarations, and moving them here would only relocate the numbers. What this
// file buys instead is that every one of those tables is now bound BACK to this
// list by test/catalog.test.js, so a card can no longer ship half-wired: a new
// id with no minimum size, a retired id still sitting in the default board, a
// label typed into one surface and forgotten in the other. All three of those
// have happened here.
//
// The drift this ended: Settings and /setup each kept their own 35-key label
// map and the two had already come apart. Metro-North read "Metro-North (Grand
// Central)" on the board and "Metro-North (GCT)" on the phone; Live Video read
// "Live Video" on the board and "Live Video (HLS)" on the phone. The tests
// asserted that each map was COMPLETE and never that the two AGREED, which is
// exactly the kind of coverage that watches a divergence happen.

// Declaration order, and it is load-bearing twice over: it is the order
// WIDGET_IDS has always had, and the layout generator falls back on it as its
// last tie-break when two cards are otherwise equal (layout-optimize idRank).
// It is NOT the order the pickers read in; that is GROUPS below, a separate
// presentation fact, and the two differ (the Images group leads with
// Landscapes, this list does not).
//
// `label` is the ONE settings-facing display name for the card: the board's
// Settings widget list and Diagnostics readout, and the phone wizard's
// checkboxes and pick summary, all read it from here. Two other registers exist
// on purpose and stay where they are: the card's own title (each widget's
// `meta.title`, which is what the card wears on the wall) and the edit-mode
// tile title (edit.js TITLES, which is deliberately shorter because it has a
// grid cell to fit inside).
const ENTRIES = [
  { id: 'weather', label: 'Weather' },
  { id: 'subway', label: 'NYC Subway' },
  { id: 'lirr', label: 'LIRR (Penn Station)' },
  // Spelled out rather than "(GCT)": the parenthetical in this list names the
  // terminal, and its two siblings above and below both name theirs in full.
  { id: 'mnr', label: 'Metro-North (Grand Central)' },
  { id: 'njt', label: 'NJ Transit' },
  { id: 'amtrak', label: 'Amtrak (Moynihan)' },
  { id: 'path', label: 'PATH' },
  { id: 'ferry', label: 'NYC Ferry' },
  { id: 'bus', label: 'Express Bus' },
  { id: 'citibike', label: 'Citi Bike' },
  { id: 'tfl', label: 'TfL Status' },
  { id: 'art', label: 'Art slideshow' },
  { id: 'photos', label: 'iCloud Photos' },
  { id: 'gdrivephotos', label: 'GDrive Photos' },
  { id: 'landscapes', label: 'Landscapes' },
  { id: 'apod', label: 'NASA Daily Photo' },
  { id: 'history', label: 'This Day in History' },
  { id: 'aqi', label: 'Air & Sky' },
  { id: 'surf', label: 'Surf' },
  { id: 'quote', label: 'Quote of the Day' },
  { id: 'wotd', label: 'Word of the Day' },
  { id: 'markets', label: 'Markets' },
  { id: 'marketsnews', label: 'Markets News' },
  { id: 'worldclock', label: 'World Clock' },
  { id: 'sports', label: 'My Teams (sports)' },
  { id: 'sportsnews', label: 'Sports News' },
  { id: 'news', label: 'Headlines' },
  { id: 'substack', label: 'Substack' },
  { id: 'bsky', label: 'Bluesky' },
  { id: 'services', label: 'Cloud Services' },
  { id: 'chart', label: 'Chart of the Day' },
  { id: 'f1', label: 'Formula 1' },
  { id: 'golf', label: 'Golf (PGA)' },
  { id: 'tennis', label: 'Tennis' },
  // Plain "Live Video", not "(HLS)": every other surface already says it that
  // way (the Settings nav line, the edit-mode tile, the required-field notice),
  // and a parenthetical here names a place or a tour, not a stream format. The
  // format is stated where it is actually needed, on the /setup field itself
  // ("HLS stream link").
  { id: 'iptv', label: 'Live Video' },
];

// Display grouping for the widget pickers (board Settings and phone /setup).
// This is on-screen order + categories, and it must remain an exact partition
// of the entries above: every card in exactly one group, no strays either way
// (asserted in test/settings-logic.test.js and test/catalog.test.js). Group
// membership is written HERE and nowhere else; each entry's `group` below is
// read back off this list rather than typed a second time.
const GROUPS = [
  { label: 'Commute', ids: ['subway', 'lirr', 'mnr', 'njt', 'amtrak', 'path', 'ferry', 'bus', 'citibike', 'tfl'] },
  { label: 'Weather & Air', ids: ['weather', 'aqi', 'surf'] },
  { label: 'Markets', ids: ['markets', 'marketsnews'] },
  { label: 'Sports', ids: ['sports', 'sportsnews', 'f1', 'golf', 'tennis'] },
  { label: 'News & Social', ids: ['news', 'substack', 'bsky'] },
  // Images = every card whose content IS the picture: art, photography, apod,
  // and (since Ambient retired, 2026-07-29) the Live Video stream, which is the
  // same media surface with the pictures moving. It is a superset of the
  // Settings NAV_MODEL 'Images' group, which lists only the ones with something
  // to configure — apod has no settings pane at all.
  { label: 'Images', ids: ['art', 'landscapes', 'photos', 'gdrivephotos', 'apod', 'iptv'] },
  // Daily = the cards that are literally "of the day": one new thing lands each
  // morning and that IS the card. Cloud Services used to sit here and does not
  // belong — it is live, not daily — so it left for Reference when the group
  // narrowed and lost the "Extras" (2026-07-29).
  { label: 'Daily', ids: ['history', 'quote', 'wotd', 'chart'] },
  // Reference = "what is true right now somewhere else": the time where your
  // colleagues are, and whether the tools everyone depends on are up. Took the
  // slot Ambient vacated, which had become a rump of leftovers once Images was
  // carved out of it.
  // NAMING — decided with Sean, 2026-07-29: this group is "Reference", never
  // "Work". unsleep is his personal project and a "Work" label would imply an
  // employer sponsors it. Do not rename it back.
  { label: 'Reference', ids: ['worldclock', 'services'] },
];

const GROUP_OF = new Map();
for (const g of GROUPS) for (const id of g.ids) GROUP_OF.set(id, g.label);

// id -> { id, label, group }. The whole catalogue, keyed, for the lookups.
export const WIDGETS = Object.freeze(Object.fromEntries(
  ENTRIES.map((e) => [e.id, Object.freeze({ id: e.id, label: e.label, group: GROUP_OF.get(e.id) ?? null })]),
));

// The same entries in declaration order, for anything that wants to walk them.
export const CATALOG = Object.freeze(ENTRIES.map((e) => WIDGETS[e.id]));

// The three shapes the rest of the tree already asks for. config.js re-exports
// the first two under their long-standing names (WIDGET_IDS, WIDGET_GROUPS) so
// no consumer had to change when the vocabulary moved here.
export const CATALOG_IDS = Object.freeze(CATALOG.map((w) => w.id));
export const CATALOG_GROUPS = Object.freeze(
  GROUPS.map((g) => Object.freeze({ label: g.label, ids: Object.freeze([...g.ids]) })),
);
export const WIDGET_LABELS = Object.freeze(Object.fromEntries(CATALOG.map((w) => [w.id, w.label])));

// Falls back to the raw id rather than rendering "undefined" into a picker,
// which is what a missing label used to do.
export const labelOf = (id) => WIDGETS[id]?.label ?? id;
export const groupOf = (id) => WIDGETS[id]?.group ?? null;
export const isWidgetId = (id) => Object.hasOwn(WIDGETS, id);
