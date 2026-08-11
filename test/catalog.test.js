/**
 * @vitest-environment happy-dom
 */
// The catalogue is the authority for which widgets exist; this file is what
// makes that claim mean something. Per-widget knowledge is spread across a
// dozen id-keyed tables in six shell files plus both settings surfaces, and
// until now each table was tested for INTERNAL sanity and never against the
// roster. That gap has shipped bugs twice:
//
//   - a retired World Cup card sat in DEFAULT_LAYOUT for nine days after it
//     stopped being offerable, seeding every new board with a dead card
//     (layout.js's comment on DEFAULT_LAYOUT records it);
//   - an id missing from a validation set inside normalizeConfig silently
//     deleted the user's explicit pick on every single load (config.js's
//     comment on sportsnews.sources records that one).
//
// Both are the same shape: a table that had drifted from the list it was
// supposed to mirror. So every table gets bound back to the catalogue here, and
// every failure message names the id AND the table it is missing from, because
// the whole point is that the next person should not have to go looking.
import { describe, it, expect } from 'vitest';
import {
  CATALOG, CATALOG_IDS, CATALOG_GROUPS, WIDGETS, WIDGET_LABELS, labelOf, groupOf, isWidgetId,
} from '../site/js/catalog.js';
import { WIDGET_IDS, WIDGET_GROUPS, DEFAULT_CONFIG, normalizeConfig } from '../site/js/config.js';
import { MIN_SIZE, MAX_SIZE, MIN_ALTS, DEFAULT_LAYOUT, CONTENT_CAPPED } from '../site/js/layout.js';
import { MODELS, TRIM } from '../site/js/capacity.js';
import { DEMAND, FLOOR } from '../site/js/layout-optimize.js';
import { TITLES } from '../site/js/edit.js';
import { SECTION_IDS, WIDGET_LABELS as BOARD_LABELS } from '../site/js/settings/settings.js';
import { SETUP_SECTIONS, REQUIRED_FIELDS, WIDGET_LABELS as PHONE_LABELS } from '../site/js/settings/setup.js';

const IDS = new Set(CATALOG_IDS);

// The two directions every table can be wrong in, said once. `missing` is the
// coverage gap (a card nothing knows about); `strays` is the other one and the
// quieter of the two: a key that is not a widget id is dead weight nothing will
// ever read, and it looks exactly like a typo because it usually is one.
const missing = (table, keys = Object.keys(table)) => {
  const have = new Set(keys);
  return CATALOG_IDS.filter((id) => !have.has(id));
};
const strays = (keys) => [...keys].filter((k) => !IDS.has(k));

describe('the catalogue itself', () => {
  it('names every card once, with a label and a group', () => {
    expect(new Set(CATALOG_IDS).size, 'duplicate id in the catalogue').toBe(CATALOG_IDS.length);
    for (const w of CATALOG) {
      expect(w.label, `${w.id} has no label`).toBeTruthy();
      expect(w.group, `${w.id} belongs to no group`).toBeTruthy();
    }
  });

  it('partitions itself: the groups hold every id, exactly once, and no strays', () => {
    const grouped = CATALOG_GROUPS.flatMap((g) => g.ids);
    expect(new Set(grouped).size, 'an id is in two groups').toBe(grouped.length);
    expect(strays(grouped), 'group ids that are not catalogue ids').toEqual([]);
    expect(missing({}, grouped), 'catalogue ids in no group').toEqual([]);
  });

  it('answers for an id it does not know without rendering "undefined"', () => {
    expect(labelOf('nosuchwidget')).toBe('nosuchwidget');
    expect(groupOf('nosuchwidget')).toBe(null);
    expect(isWidgetId('nosuchwidget')).toBe(false);
    expect(isWidgetId('weather')).toBe(true);
  });

  it('is what config.js hands out as WIDGET_IDS and WIDGET_GROUPS', () => {
    // Same values, same order: WIDGET_IDS' order is the layout generator's last
    // tie-break (layout-optimize idRank) and WIDGET_GROUPS' is what the pickers
    // read top to bottom, so neither is free to shuffle.
    expect(WIDGET_IDS).toEqual(CATALOG_IDS);
    expect(WIDGET_GROUPS).toEqual(CATALOG_GROUPS);
  });
});

describe('one label per card, on both settings surfaces', () => {
  // The drift this refactor closed: Settings said "Metro-North (Grand Central)"
  // and "Live Video" while /setup said "Metro-North (GCT)" and "Live Video
  // (HLS)". Both maps were tested for COVERAGE and neither for AGREEMENT, so
  // the divergence was watched rather than caught. There is one map now, and
  // this is the test that says so.
  it('the board and the phone read the same names, from the catalogue', () => {
    expect(BOARD_LABELS).toBe(WIDGET_LABELS);
    expect(PHONE_LABELS).toBe(WIDGET_LABELS);
  });

  it('covers every card', () => {
    expect(missing(WIDGET_LABELS), 'ids with no label').toEqual([]);
    expect(strays(Object.keys(WIDGET_LABELS)), 'labels for ids that do not exist').toEqual([]);
  });

  it('gives edit mode its own shorter name for every card', () => {
    // A different register, deliberately (see edit.js), but a tile with no entry
    // prints the raw id, so completeness is not optional.
    expect(missing(TITLES), 'ids with no edit-mode title').toEqual([]);
    expect(strays(Object.keys(TITLES)), 'edit-mode titles for ids that do not exist').toEqual([]);
  });
});

describe('geometry tables cover the catalogue', () => {
  // MIN_SIZE is the only one of these that must be TOTAL: normalizeLayout drops
  // any rect whose id is not in it, so a card missing here cannot be placed at
  // all. The rest are exceptions lists, where the honest test is that every
  // exception names a card that exists.
  it('MIN_SIZE has a floor for every card, and floors nothing that is not one', () => {
    expect(missing(MIN_SIZE), 'ids with no MIN_SIZE').toEqual([]);
    expect(strays(Object.keys(MIN_SIZE)), 'MIN_SIZE keys that are not catalogue ids').toEqual([]);
  });

  it('MAX_SIZE, MIN_ALTS and CONTENT_CAPPED only name cards that exist', () => {
    expect(strays(Object.keys(MAX_SIZE)), 'MAX_SIZE keys that are not catalogue ids').toEqual([]);
    expect(strays(Object.keys(MIN_ALTS)), 'MIN_ALTS keys that are not catalogue ids').toEqual([]);
    expect(strays(CONTENT_CAPPED.map(([id]) => id)), 'CONTENT_CAPPED ids that are not catalogue ids').toEqual([]);
  });

  it('every DEFAULT_LAYOUT card is a real card', () => {
    // THE WORLD CUP TEST. A dated card retired on 2026-07-20, stayed in this
    // list until 2026-07-29, and every board quick-started in between arrived
    // with a card that no longer existed. test/layout.test.js already checks
    // the default board against isAddable; this checks it against the roster,
    // which is the step before: an id deleted from the tree entirely would never
    // reach the offerability question.
    expect(strays(DEFAULT_LAYOUT.map((r) => r.id)), 'DEFAULT_LAYOUT ids that are not catalogue ids').toEqual([]);
  });
});

describe('capacity and demand tables cover the catalogue', () => {
  it('DEMAND rates every card, and nothing that is not one', () => {
    expect(missing(DEMAND), 'ids with no DEMAND entry').toEqual([]);
    expect(strays(Object.keys(DEMAND)), 'DEMAND keys that are not catalogue ids').toEqual([]);
  });

  it('MODELS, TRIM and FLOOR only name cards that exist', () => {
    // All three are exceptions lists (a card with no list has no capacity model,
    // a card that does not shed rows has no trim, a floor at or below MIN_SIZE
    // would be inert), so only the stray direction can be asserted. But a stray
    // here is a measurement calibrating nothing, which is the failure that hides
    // best.
    expect(strays(Object.keys(MODELS)), 'capacity MODELS keys that are not catalogue ids').toEqual([]);
    expect(strays(Object.keys(TRIM)), 'TRIM keys that are not catalogue ids').toEqual([]);
    expect(strays(Object.keys(FLOOR)), 'FLOOR keys that are not catalogue ids').toEqual([]);
  });
});

// The keys of DEFAULT_CONFIG that are NOT per-widget blocks: the schema's own
// fields and the board-wide preferences. Everything else in there must be a
// widget id, or it is a config block whose widget will never read it.
const SHELL_CONFIG_KEYS = new Set([
  'v', 't', 'name', 'loc', 'layout', 'screensaver', 'mode', 'schedule', 'beacon', 'clock24', 'nerdMode',
]);

describe('config blocks belong to real cards', () => {
  it('every per-widget DEFAULT_CONFIG block names a catalogue id', () => {
    const perWidget = Object.keys(DEFAULT_CONFIG).filter((k) => !SHELL_CONFIG_KEYS.has(k));
    expect(strays(perWidget), 'DEFAULT_CONFIG blocks that are not catalogue ids').toEqual([]);
  });

  it('every required /setup field names a catalogue id', () => {
    expect(strays(REQUIRED_FIELDS.map((f) => f.id)), 'REQUIRED_FIELDS ids that are not catalogue ids').toEqual([]);
  });
});

// The settings sections that are not a card: the shell's own panes.
const SHELL_SECTIONS = new Set(['display', 'widgets', 'screensaver', 'code', 'diag']);
// The one /setup section whose element id is not `${widgetId}-field`.
const SETUP_SECTION_ALIASES = { 'wc-field': 'worldclock' };
const setupSectionWidget = (sectionId) =>
  SETUP_SECTION_ALIASES[sectionId] ?? sectionId.replace(/-field$/, '');

describe('both settings surfaces reach every card that has something to set', () => {
  it('every Settings section is a card or a shell pane', () => {
    const orphans = SECTION_IDS.filter((id) => !SHELL_SECTIONS.has(id) && !IDS.has(id));
    expect(orphans, 'SECTION_RENDERERS keys that are neither a catalogue id nor a shell pane').toEqual([]);
  });

  it('every /setup section and trigger is a card, under a real group', () => {
    const labels = new Set(CATALOG_GROUPS.map((g) => g.label));
    for (const s of SETUP_SECTIONS) {
      expect(IDS.has(setupSectionWidget(s.id)), `${s.id} names no catalogue id`).toBe(true);
      expect(labels.has(s.group), `${s.id} is filed under an unknown group ${s.group}`).toBe(true);
      for (const t of s.triggers) expect(IDS.has(t), `${s.id} is triggered by unknown id ${t}`).toBe(true);
    }
  });

  // THE INVARIANT WORTH THE FILE. A card that carries its own block in
  // DEFAULT_CONFIG has something a person can change; if the board has no pane
  // for it, that setting is unreachable from the only surface that is always
  // there. (The reverse is not a rule: `weather` has a Settings pane and no
  // config block of its own, since it edits cfg.loc.)
  it('a card with its own config block has a Settings pane', () => {
    const configurable = Object.keys(DEFAULT_CONFIG).filter((k) => IDS.has(k));
    const panes = new Set(SECTION_IDS);
    for (const id of configurable) {
      expect(panes.has(id), `${id} has a DEFAULT_CONFIG block but no Settings section`).toBe(true);
    }
  });

  // ...and the phone must not be able to set something the board cannot. /setup
  // is a one-shot wizard run before the board exists; anything it asks for has
  // to stay editable afterwards, or the only way to change it is to build a new
  // setup code. (Not the reverse: Settings covers more, e.g. Landscapes'
  // rotation, which the wizard deliberately does not ask about.)
  it('anything /setup can set, Settings can set too', () => {
    const panes = new Set(SECTION_IDS);
    for (const s of SETUP_SECTIONS) {
      const id = setupSectionWidget(s.id);
      expect(panes.has(id), `${s.id} is a phone-only setting: no Settings section for ${id}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The validation-set bug class, from config.js's note on sportsnews.sources:
// "the-athletic was missing here at first, which silently deleted an explicit
// Athletic pick on every load." normalizeConfig guards several lists against a
// hand-typed Set of legal ids, and each of those Sets is a second copy of a
// vocabulary that lives in the widget module the picker reads. A copy that
// falls behind does not throw and does not warn; it quietly discards a choice
// the user made, on every boot, forever.
//
// The general form of the pin, which is the only form that survives the next
// source being added: whatever a picker OFFERS, a load must KEEP.
// ---------------------------------------------------------------------------
describe('every option a picker offers survives a load', () => {
  const survives = (raw, read) => read(normalizeConfig(raw));

  it('keeps any single markets-news source the picker lists', async () => {
    const { MARKET_SOURCES } = await import('../site/js/widgets/marketsnews.js');
    for (const [id] of MARKET_SOURCES) {
      expect(survives({ marketsnews: { sources: [id] } }, (c) => c.marketsnews.sources), id).toEqual([id]);
    }
  });

  it('keeps any single sports-news source the picker lists (the Athletic bug)', async () => {
    const { SPORTS_SOURCES, SPORTS } = await import('../site/js/widgets/sportsnews.js');
    for (const [id] of SPORTS_SOURCES) {
      expect(survives({ sportsnews: { sources: [id] } }, (c) => c.sportsnews.sources), id).toEqual([id]);
    }
    for (const [id] of SPORTS) {
      expect(survives({ sportsnews: { sports: [id] } }, (c) => c.sportsnews.sports), id).toEqual([id]);
    }
  });

  it('keeps any single cloud service the picker lists', async () => {
    const { SERVICE_CHOICES } = await import('../site/js/widgets/services.js');
    for (const [id] of SERVICE_CHOICES) {
      expect(survives({ services: { list: [id] } }, (c) => c.services.list), id).toEqual([id]);
    }
  });

  it('keeps any PATH direction the picker lists', async () => {
    const { PATH_DIRS } = await import('../site/js/widgets/path.js');
    for (const [id] of PATH_DIRS) {
      expect(survives({ path: { dir: id } }, (c) => c.path.dir), id).toBe(id);
    }
  });

  it('keeps every default the shipped config carries', () => {
    // The same failure one step further back: a default that the validator
    // rejects is silently swapped for the fallback, so the board ships with a
    // setting nobody chose. Round-tripping DEFAULT_CONFIG catches it wholesale.
    const out = normalizeConfig(structuredClone(DEFAULT_CONFIG));
    expect(out.marketsnews.sources).toEqual([...DEFAULT_CONFIG.marketsnews.sources]);
    expect(out.sportsnews.sources).toEqual([...DEFAULT_CONFIG.sportsnews.sources]);
    expect(out.services.list).toEqual([...DEFAULT_CONFIG.services.list]);
    expect(out.news.sources).toEqual([...DEFAULT_CONFIG.news.sources]);
    expect(out.chart.topics).toEqual([...DEFAULT_CONFIG.chart.topics]);
    expect(out.tfl.lines).toEqual([...DEFAULT_CONFIG.tfl.lines]);
    expect(out.path.dir).toBe(DEFAULT_CONFIG.path.dir);
  });
});
