/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  boroughs,
  linesForBorough,
  stationsForLine,
  alphaSections,
  moveWidget,
  toggleIn,
  applyNameKey,
  searchStations,
  nameAutoCap,
  NAME_MAX_LEN,
  expressRoutes,
  directionsForRoute,
  stopsForRouteDir,
  canAddTicker,
  TICKER_MAX,
} from '../site/js/settings/pickers.js';
import { connectBridge } from '../site/js/bridge.js';

const SUBWAY = [
  { id: '631', name: 'Grand Central-42 St', borough: 'Manhattan', lines: ['4', '5', '6'] },
  { id: 'R16', name: 'Times Sq-42 St', borough: 'Manhattan', lines: ['N', 'Q', 'R', 'W'] },
  { id: 'R01', name: 'Astoria-Ditmars Blvd', borough: 'Queens', lines: ['N', 'W'] },
];

describe('subway pickers', () => {
  it('lists boroughs and lines', () => {
    expect(boroughs(SUBWAY)).toEqual(['Manhattan', 'Queens']);
    expect(linesForBorough(SUBWAY, 'Manhattan')).toEqual(['4', '5', '6', 'N', 'Q', 'R', 'W']);
  });
  it('lists stations serving a line in a borough', () => {
    expect(stationsForLine(SUBWAY, 'Manhattan', 'N').map((s) => s.id)).toEqual(['R16']);
    expect(stationsForLine(SUBWAY, 'Queens', 'N').map((s) => s.id)).toEqual(['R01']);
  });
});

describe('ticker Add guard', () => {
  const list = (n) => Array.from({ length: n }, (_, i) => `TK${String(i).padStart(2, '0')}`);

  it('fills to 20 and refuses the 21st', () => {
    expect(TICKER_MAX).toBe(20);
    expect(canAddTicker(list(19), 'AAPL')).toBe(true); // the 20th still lands
    expect(canAddTicker(list(20), 'AAPL')).toBe(false); // the 21st is refused
  });

  it('refuses a duplicate or a malformed symbol, at any length', () => {
    expect(canAddTicker(['AAPL'], 'AAPL')).toBe(false);
    expect(canAddTicker([], 'BAD TICKER')).toBe(false);
    expect(canAddTicker([], 'aapl')).toBe(false); // callers normalize to upper first
    expect(canAddTicker([], '')).toBe(false);
  });

  it('keeps the 10-CHARACTER symbol limit, which is not the list cap', () => {
    expect(canAddTicker([], '^STOXX50E')).toBe(true); // 9 chars
    expect(canAddTicker([], 'ABCDEFGHIJ')).toBe(true); // 10 chars
    expect(canAddTicker([], 'ABCDEFGHIJK')).toBe(false); // 11 chars
  });
});

describe('alphaSections', () => {
  it('groups stations by first letter', () => {
    const sections = alphaSections([
      { id: '1', name: 'Albertson' },
      { id: '2', name: 'Amityville' },
      { id: '3', name: 'Babylon' },
    ]);
    expect(sections).toEqual([
      { letter: 'A', stations: [{ id: '1', name: 'Albertson' }, { id: '2', name: 'Amityville' }] },
      { letter: 'B', stations: [{ id: '3', name: 'Babylon' }] },
    ]);
  });
});

describe('applyNameKey (Display name keypad)', () => {
  // Drive the pure reducer through a key sequence, returning the final value.
  const type = (keys, start = '') => {
    let s = { value: start, shift: nameAutoCap(start) };
    for (const k of keys) s = applyNameKey(s, k);
    return s.value;
  };
  const letters = (word) => word.toUpperCase().split(''); // buttons emit A-Z

  it('auto-capitalizes each word hands-free', () => {
    expect(type([...letters('sean'), 'Space', ...letters('scott')])).toBe('Sean Scott');
  });
  it('types interior capitals via a momentary Shift (camelCase)', () => {
    expect(type([...letters('mc'), 'Shift', ...letters('donald')])).toBe('McDonald');
    expect(type([...letters('de'), 'Shift', ...letters('angelo')])).toBe('DeAngelo');
  });
  it('supports hyphenated names and auto-caps after the hyphen', () => {
    expect(type([...letters('jean'), '-', ...letters('paul')])).toBe('Jean-Paul');
    expect(type([...letters('mary'), '-', ...letters('kate')])).toBe('Mary-Kate');
  });
  it('lets Shift turn OFF the auto-capital for lowercase particles', () => {
    expect(type(['Shift', ...letters('van'), 'Space', 'Shift', ...letters('gogh')])).toBe('van gogh');
  });
  it('restores auto-cap state on backspace', () => {
    expect(applyNameKey({ value: 'Sean ', shift: true }, 'Backspace')).toEqual({ value: 'Sean', shift: false });
    expect(applyNameKey({ value: 'S', shift: false }, 'Backspace')).toEqual({ value: '', shift: true });
  });
  it('never leads with, doubles, or exceeds the cap on separators', () => {
    expect(applyNameKey({ value: '', shift: true }, 'Space')).toEqual({ value: '', shift: true });
    expect(applyNameKey({ value: 'Jo', shift: false }, '-')).toEqual({ value: 'Jo-', shift: true });
    expect(applyNameKey({ value: 'Jo-', shift: true }, '-')).toEqual({ value: 'Jo-', shift: true });
    const full = 'A'.repeat(NAME_MAX_LEN);
    expect(applyNameKey({ value: full, shift: false }, 'B').value).toBe(full);
  });
});

describe('moveWidget', () => {
  it('moves ids up and down with clamping', () => {
    expect(moveWidget(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveWidget(['a', 'b', 'c'], 'b', +1)).toEqual(['a', 'c', 'b']);
    expect(moveWidget(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveWidget(['a', 'b', 'c'], 'zz', 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('toggleIn', () => {
  it('adds and removes without mutating', () => {
    const list = ['4', '6'];
    expect(toggleIn(list, '5')).toEqual(['4', '6', '5']);
    expect(toggleIn(list, '4')).toEqual(['6']);
    expect(list).toEqual(['4', '6']);
  });
});

describe('connectBridge', () => {
  function mockWS() {
    const instances = [];
    class WS {
      constructor(url) {
        this.url = url;
        this.sent = [];
        instances.push(this);
      }
      send(data) {
        this.sent.push(JSON.parse(data));
      }
      close() {
        this.closed = true;
      }
    }
    return { WS, instances };
  }

  it('connects with credentials in the URL and sends framed configs', async () => {
    const { WS, instances } = mockWS();
    const p = connectBridge({ u: 'bridge', p: 's3cret', ip: '10.1.2.3' }, { WS, timeoutMs: 1000 });
    const ws = instances[0];
    expect(ws.url).toBe('wss://bridge:s3cret@10.1.2.3/ws');
    ws.onopen();
    const bridge = await p;

    const sendP = bridge.sendConfig('ENCODEDCFG');
    expect(ws.sent[0].method).toBe('xCommand/Message/Send');
    expect(ws.sent[0].params.Text).toBe('sgn1:ENCODEDCFG');
    ws.onmessage({ data: JSON.stringify({ jsonrpc: '2.0', id: ws.sent[0].id, result: {} }) });
    await expect(sendP).resolves.toBeUndefined();

    const resetP = bridge.sendReset();
    expect(ws.sent[1].params.Text).toBe('sgn1-reset');
    ws.onmessage({ data: JSON.stringify({ jsonrpc: '2.0', id: ws.sent[1].id, result: {} }) });
    await expect(resetP).resolves.toBeUndefined();
  });

  it('rejects the connect on timeout', async () => {
    vi.useFakeTimers();
    const { WS } = mockWS();
    const p = connectBridge({ u: 'u', p: 'p', ip: '10.0.0.1' }, { WS, timeoutMs: 5000 });
    const guard = expect(p).rejects.toThrow(/timeout/i);
    await vi.advanceTimersByTimeAsync(5001);
    await guard;
    vi.useRealTimers();
  });

  it('rejects sends that never get a reply', async () => {
    vi.useFakeTimers();
    const { WS, instances } = mockWS();
    const p = connectBridge({ u: 'u', p: 'p', ip: '10.0.0.1' }, { WS, timeoutMs: 5000 });
    instances[0].onopen();
    const bridge = await p;
    const sendP = bridge.sendConfig('X');
    const guard = expect(sendP).rejects.toThrow(/timeout/i);
    await vi.advanceTimersByTimeAsync(5001);
    await guard;
    vi.useRealTimers();
  });

  it('rejects when auth is incomplete', async () => {
    await expect(connectBridge({ u: 'u', p: 'p', ip: null }, {})).rejects.toThrow(/ip/i);
  });
});

// Every widget id must have a label in BOTH settings surfaces — a missing
// entry renders literal "undefined" in the Widgets and Diagnostics menus.
import { WIDGET_IDS as ALL_IDS, isRetired } from '../site/js/config.js';
const LIVE_IDS = ALL_IDS.filter((id) => !isRetired(id)); // retired ids drop from unplaced pickers
import { WIDGET_LABELS as BOARD_LABELS } from '../site/js/settings/settings.js';

describe('widget label coverage', () => {
  it('board settings labels cover every widget id', () => {
    for (const id of ALL_IDS) expect(BOARD_LABELS[id], id).toBeTruthy();
  });
  // The /setup phone wizard is an ADD surface, so it only needs labels for
  // placeable (non-retired) widgets. Guards the recurring "added a widget,
  // forgot its wizard label" plumbing gap that renders a titleless card.
  it('setup wizard labels cover every placeable widget id', () => {
    for (const id of LIVE_IDS) expect(SETUP_LABELS[id], id).toBeTruthy();
  });
});

import { WIDGET_GROUPS } from '../site/js/config.js';

describe('WIDGET_GROUPS taxonomy', () => {
  it('is an exact partition of WIDGET_IDS (every id in exactly one group, no extras)', () => {
    const grouped = WIDGET_GROUPS.flatMap((g) => g.ids);
    // no duplicates across groups
    expect(new Set(grouped).size).toBe(grouped.length);
    // same membership as WIDGET_IDS, both directions
    expect([...grouped].sort()).toEqual([...ALL_IDS].sort());
  });

  it('has the eight expected group labels in order', () => {
    expect(WIDGET_GROUPS.map((g) => g.label)).toEqual([
      'Commute', 'Weather & Air', 'Markets', 'Sports', 'News & Social', 'Images', 'Daily', 'Reference',
    ]);
  });

  // Markets & Sports split in two (2026-07-28) so the add tray could tuck the
  // sports cards behind their own expander, the way Commute already is. Sports
  // was five until the World Cup card was deleted on 2026-07-29 (it had been
  // gated out since it retired on 2026-07-20, so the tray already read 4).
  it('keeps Markets and Sports as separate groups with the right members', () => {
    const ids = (label) => WIDGET_GROUPS.find((g) => g.label === label)?.ids;
    expect(ids('Markets')).toEqual(['markets', 'marketsnews']);
    // Sports News sits next to My Teams the way Markets News sits next to
    // Markets: the feed twin follows the card it reads for.
    expect(ids('Sports')).toEqual(['sports', 'sportsnews', 'f1', 'golf', 'tennis']);
    expect(ids('Sports')).not.toContain('worldcup'); // deleted, not merely retired
    expect(WIDGET_GROUPS.map((g) => g.label)).not.toContain('Markets & Sports');
  });

  // Ambient split the same way (2026-07-28) so the picture cards got their own
  // tray expander — and then RETIRED (2026-07-29), because what was left of it
  // (a video stream and a clock) was a rump held together by nothing. Live
  // Video joined Images, the clock joined Cloud Services under Reference.
  it('retired Ambient: iptv joined Images, the clock left for Reference', () => {
    const ids = (label) => WIDGET_GROUPS.find((g) => g.label === label)?.ids;
    expect(WIDGET_GROUPS.map((g) => g.label)).not.toContain('Ambient');
    expect(ids('Images')).toEqual(['art', 'landscapes', 'photos', 'gdrivephotos', 'apod', 'iptv']);
    expect(ids('Reference')).toEqual(['worldclock', 'services']);
  });

  // Daily narrowed to the cards that are literally "of the day" (2026-07-29):
  // Cloud Services is live, not daily, and left for Reference.
  it('narrows Daily to the of-the-day cards, Cloud Services excluded', () => {
    const ids = (label) => WIDGET_GROUPS.find((g) => g.label === label)?.ids;
    expect(WIDGET_GROUPS.map((g) => g.label)).not.toContain('Daily Extras');
    expect(ids('Daily')).toEqual(['history', 'quote', 'wotd', 'chart']);
    expect(ids('Daily')).not.toContain('services');
  });

  // NAMING GUARD, decided with Sean 2026-07-29: the group holding the world
  // clock and cloud services is "Reference", never "Work" — RoomBoard is a
  // personal project and a "Work" label would imply an employer sponsors it.
  // See the comment on the group in config.js.
  it('never labels a group Work', () => {
    for (const g of WIDGET_GROUPS) expect(g.label).not.toMatch(/\bwork\b/i);
  });

  // The Settings nav is a separate hand-ordered spec with its own Images group,
  // and it is deliberately NOT the same list — it is Sean's explicit ordering
  // and does not derive from WIDGET_GROUPS. So nav ⊂ WIDGET_GROUPS, and an id
  // may be missing from the nav's Images group for exactly two reasons: it has
  // no settings pane at all (apod), or the nav carries it as its OWN top-level
  // item rather than inside the group (iptv is "Live Video", pinned near
  // Diagnostics because it is the nerd-mode card).
  it('keeps the NAV_MODEL Images group a subset of the WIDGET_GROUPS one', () => {
    const nav = NAV_MODEL.find((e) => e.type === 'group' && e.label === 'Images').items.map(([id]) => id);
    const standalone = new Set(NAV_MODEL.filter((e) => e.type === 'item').map((e) => e.id));
    const group = WIDGET_GROUPS.find((g) => g.label === 'Images').ids;
    expect(nav).toEqual(group.filter((id) => nav.includes(id))); // same relative order, no strays
    for (const id of group.filter((id) => !nav.includes(id))) {
      if (standalone.has(id)) continue; // the nav lists it on its own line
      expect(SECTION_IDS, id).not.toContain(id); // otherwise only sectionless cards may be missing
    }
  });
});

// /info is the third consumer of the taxonomy and the one with no runtime: its
// group dividers, the names under each, and the "All N of them" total are all
// hand-written, so they drift silently the moment a group moves. The guide
// deliberately documents FEWER cards than exist (nothing double-gated), so the
// guard checks shape and internal arithmetic, never "documents everything".
const guide = await readFile(resolve(process.cwd(), 'site/info.html'), 'utf8');
const folds = [...guide.matchAll(/<details class="fold" id="[^"]+">([\s\S]*?)<\/details>/g)]
  .map(([, body]) => ({
    name: (body.match(/fold__name">([^<]+)</) || [])[1]?.replace(/&amp;/g, '&'),
    listed: ((body.match(/fold__ids">([^<]*)</) || [])[1] || '').split('&middot;').filter((s) => s.trim()).length,
    rows: (body.match(/row__name/g) || []).length,
  }));

describe('/info guide tracks WIDGET_GROUPS', () => {
  it('carries one fold per group, in WIDGET_GROUPS order, and no retired label', () => {
    expect(folds.map((f) => f.name)).toEqual(WIDGET_GROUPS.map((g) => g.label));
  });

  it('agrees with itself: the at-rest name list matches the rows behind each fold', () => {
    for (const f of folds) expect(f.listed, f.name).toBe(f.rows);
  });

  it('documents no card that does not exist, and no more than the group holds', () => {
    for (const f of folds) {
      const group = WIDGET_GROUPS.find((g) => g.label === f.name);
      expect(f.rows, f.name).toBeLessThanOrEqual(group.ids.filter((id) => !isRetired(id)).length);
    }
  });

  it('the hero total is the number of cards actually documented', () => {
    const total = folds.reduce((n, f) => n + f.rows, 0);
    expect(guide).toContain(`All ${total} of them`);
  });
});

import { qwertyKeypad } from '../site/js/settings/settings.js';
describe('qwertyKeypad shiftable variant (replaced keyboard.js)', () => {
  it('cases keys by shift state and adds ⇧/⌫ to the bottom letter row', () => {
    const up = qwertyKeypad('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', [], '', { shift: true });
    expect(up).toContain('data-key="Shift"');
    expect(up).toContain('data-key="⌫"');
    expect(up).toContain('data-key="A"');
    expect(up).toContain('is-on'); // shift key lit while active
    const low = qwertyKeypad('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', [], '', { shift: false });
    expect(low).toContain('data-key="a"');
    expect(low).not.toContain('is-on');
    expect(low).toContain('data-key="1"'); // digits unaffected by case
  });
  it('drops the empty digits row for digit-less alphabets (the name pad)', () => {
    const html = qwertyKeypad('ABCDEFGHIJKLMNOPQRSTUVWXYZ', [' ', '-'], '', { shift: false });
    expect(html).not.toContain('<div class="osk__row"></div>');
    expect(html).toContain('data-key=" "'); // space bar rides the actions row
  });
  it('classic fixed-case pads are unchanged (no shift/backspace injected)', () => {
    const html = qwertyKeypad('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', ['-'], '<b>x</b>');
    expect(html).not.toContain('data-key="Shift"');
    expect(html).not.toContain('data-key="⌫"');
  });
});

import {
  widgetChecksHtml,
  WIDGET_LABELS as SETUP_LABELS,
  startingLayout,
  pickedLabel,
  stepTwoNote,
  canEncode,
  EMPTY_PICKS_NOTICE,
} from '../site/js/settings/setup.js';
import { writeProbe, spotKey } from '../site/js/surf-gate.js';
import { installLocalStorage } from './stubs/localstorage.js';
import { DEFAULT_CONFIG, normalizeConfig as normalizeCfg } from '../site/js/config.js';

// A coastal board, with the ocean verdict already cached. Surf is place-gated
// (see isOceanHidden), so "every live widget is offered" is only true on a
// board where the probe has actually answered — which is the state these
// full-inventory picker assertions mean to describe.
const COAST = { lat: 40.9384, lon: -72.3037, label: 'Bridgehampton', units: 'F' };
const onTheCoast = (extra = {}) => {
  installLocalStorage();
  writeProbe({ key: spotKey(COAST), t: Date.now(), ocean: true, km: 7.12, bearing: 171.8 });
  return { loc: COAST, ...extra };
};

describe('widgetChecksHtml (setup picker)', () => {
  it('renders every grouped section, one checkbox per widget, reflecting the placed set', () => {
    const html = widgetChecksHtml(SETUP_LABELS, new Set(['subway', 'photos']), onTheCoast({ nerdMode: true }));
    // derived, not spelled out: the canonical label list is asserted once, in
    // the WIDGET_GROUPS taxonomy suite above
    for (const { label } of WIDGET_GROUPS) {
      expect(html).toContain(`<h3 class="wpick__title">${label}</h3>`);
    }
    expect((html.match(/data-w="/g) || []).length).toBe(LIVE_IDS.length); // one per non-retired widget
    // placed widgets are checked
    expect(html).toMatch(/data-w="subway"[^>]*checked/);
    expect(html).toMatch(/data-w="photos"[^>]*checked/);
    // an unplaced widget is not checked
    expect(html).not.toMatch(/data-w="lirr"[^>]*checked/);
    // uses the passed (phone) labels
    expect(html).toContain('Metro-North (GCT)');
  });

  // /setup used to open with DEFAULT_LAYOUT's nine cards ticked, which read as a
  // list to prune and quietly shipped whatever DEFAULT_LAYOUT held onto every
  // phone-configured board — that is how a World Cup card that had retired on
  // 2026-07-20 kept arriving pre-checked for nine days. Sean's call
  // (2026-07-29): open with nothing ticked and let the user choose.
  it('opens with NOTHING checked on a fresh visit', () => {
    const html = widgetChecksHtml(SETUP_LABELS, new Set(startingLayout(DEFAULT_CONFIG, null).map((r) => r.id)), {});
    expect(html).not.toContain('checked');
    expect(html).toContain('data-w="weather"'); // the full menu is still offered
  });

  it('still opens pre-checked from a scanned board QR — that board\'s own cards', () => {
    const scannedCfg = { layout: [{ id: 'subway', x: 0, y: 0, w: 3, h: 3 }] };
    const placed = new Set(startingLayout(scannedCfg, scannedCfg).map((r) => r.id));
    const html = widgetChecksHtml(SETUP_LABELS, placed, {});
    expect(html).toMatch(/data-w="subway"[^>]*checked/);
    expect(html).not.toMatch(/data-w="weather"[^>]*checked/);
  });

  it('the blank slate cannot leak into a setup code', () => {
    // The guard exists because normalizeConfig CANNOT carry an empty layout:
    // normalizeLayout treats [] as "no opinion" and hands back DEFAULT_LAYOUT
    // (the safety net that keeps a corrupt stored config off a blank board). So
    // an unguarded empty submit would silently hand out a code for the default
    // board — exactly the surprise the blank slate was meant to remove.
    expect(normalizeCfg({ ...DEFAULT_CONFIG, layout: [] }).layout).toEqual(DEFAULT_CONFIG.layout);
    expect(canEncode([])).toBe(false);
    expect(canEncode(undefined)).toBe(false);
    expect(canEncode([{ id: 'weather', x: 0, y: 0, w: 3, h: 4 }])).toBe(true);
    expect(EMPTY_PICKS_NOTICE).toMatch(/at least one widget/i);
  });
});

describe('setup step copy for the empty states', () => {
  it('asks for a pick at zero, then reports the running count', () => {
    expect(pickedLabel(0)).toMatch(/Nothing picked yet/);
    expect(pickedLabel(1)).toBe('1 widget picked.');
    expect(pickedLabel(7)).toBe('7 widgets picked.');
  });

  it('step 2 names its two bare states differently, and says nothing when it has content', () => {
    // nothing picked at all: send them back, do not imply they are finished
    expect(stepTwoNote(0, 0)).toMatch(/Go back to step 1/);
    // picked, but every card is config-less (Tennis, History, Quote...)
    expect(stepTwoNote(3, 0)).toMatch(/Nothing to personalize/);
    // has sections: no note at all
    expect(stepTwoNote(3, 2)).toBe('');
  });
});

import { widgetGroupsHtml } from '../site/js/settings/settings.js';

describe('widgetGroupsHtml', () => {
  it('renders every group header and one toggle per widget with correct on-state', () => {
    const html = widgetGroupsHtml([{ id: 'weather', x: 0, y: 0, w: 4, h: 4 }], onTheCoast({ nerdMode: true }));
    for (const { label } of WIDGET_GROUPS) {
      expect(html).toContain(`<h3 class="wgroup__title">${label}</h3>`);
    }
    // one toggle per WIDGET_ID (21)
    expect((html.match(/data-toggle="/g) || []).length).toBe(LIVE_IDS.length);
    // weather is placed → its toggle is on
    expect(html).toMatch(/data-toggle="weather"[^>]*aria-checked="true"/);
    // subway is not placed → not on
    expect(html).toMatch(/class="toggle "[^>]*data-toggle="subway"/);
  });

  it('disables a widget that cannot fit (no room) and labels it', () => {
    // one widget filling the whole 12x8 grid leaves no room for others
    const html = widgetGroupsHtml([{ id: 'weather', x: 0, y: 0, w: 12, h: 8 }]);
    expect(html).toMatch(/data-toggle="subway"[^>]*disabled/);
    expect(html).toContain('(no room — resize others first)');
    // the placed, full-size widget is still shown as on
    expect(html).toMatch(/data-toggle="weather"[^>]*aria-checked="true"/);
  });
});

import { NAV_MODEL, navGroupForSection, SECTION_IDS, navHtml } from '../site/js/settings/settings.js';
import { widgetChecksHtml } from '../site/js/settings/setup.js';
import { widgetGroupsHtml } from '../site/js/settings/settings.js';
import { WIDGET_LABELS as SETUP_LABELS } from '../site/js/settings/setup.js';

describe('settings nav model', () => {
  it('navGroupForSection maps grouped sections and returns null for pinned/standalone', () => {
    expect(navGroupForSection('mnr')).toBe('Commute');
    expect(navGroupForSection('photos')).toBe('Images');
    expect(navGroupForSection('news')).toBe('News & Social');
    expect(navGroupForSection('widgets')).toBeNull(); // pinned
    expect(navGroupForSection('markets')).toBe('Markets'); // now a group with marketsnews
    expect(navGroupForSection('marketsnews')).toBe('Markets'); // grouped under Markets
    // My Teams stopped being a pinned item when Sports News landed, exactly as
    // Markets did: the card and its feed twin share one collapsible group,
    // which Sean named Sports (the group is bigger than the teams card now).
    expect(navGroupForSection('sports')).toBe('Sports');
    expect(navGroupForSection('sportsnews')).toBe('Sports');
    expect(navGroupForSection('weather')).toBeNull(); // standalone
    expect(navGroupForSection('worldclock')).toBeNull(); // standalone (pulled out of Images)
    expect(navGroupForSection('diag')).toBeNull();
    expect(navGroupForSection('nope')).toBeNull(); // unknown
  });
  it('gives My Teams the same two-child group shape Markets has', () => {
    const group = (label) => NAV_MODEL.find((e) => e.type === 'group' && e.label === label);
    expect(group('Markets').items).toEqual([['markets', 'Markets'], ['marketsnews', 'Markets News']]);
    expect(group('Sports').items).toEqual([['sports', 'My Teams'], ['sportsnews', 'Sports News']]);
    // ...and the old pinned entry is gone, or the section would appear twice.
    expect(NAV_MODEL.filter((e) => e.type === 'item' && e.id === 'sports')).toEqual([]);
  });

  it('NAV_MODEL covers exactly the valid section ids (none missing or orphaned)', () => {
    const navIds = NAV_MODEL.flatMap((e) => (e.type === 'group' ? e.items.map(([id]) => id) : [e.id]));
    expect(new Set(navIds).size).toBe(navIds.length); // no dupes
    expect([...navIds].sort()).toEqual([...SECTION_IDS].sort());
  });
});

import { stepTwoVisibility, SETUP_SECTIONS } from '../site/js/settings/setup.js';

describe('stepTwoVisibility', () => {
  it('shows only the sections + divider groups for the placed widgets', () => {
    const { sections, groups } = stepTwoVisibility(['subway', 'lirr']);
    expect([...sections].sort()).toEqual(['lirr-field', 'subway-field']);
    expect([...groups]).toEqual(['Commute']);
  });
  it('shows the Weather location section when Air & Sky (aqi) is placed (shared trigger)', () => {
    const { sections, groups } = stepTwoVisibility(new Set(['aqi']));
    expect(sections.has('weather-field')).toBe(true);
    expect(groups.has('Weather & Air')).toBe(true);
  });
  it('shows nothing for config-less widgets', () => {
    const { sections, groups } = stepTwoVisibility(['tennis', 'history']);
    expect(sections.size).toBe(0);
    expect(groups.size).toBe(0);
  });
  it('shows nothing at all for an empty pick set (the wizard now opens there)', () => {
    const { sections, groups } = stepTwoVisibility([]);
    expect(sections.size).toBe(0);
    expect(groups.size).toBe(0);
  });
  // Every picture card, Live Video included, now files under one Images
  // divider; the clock left for Reference with Cloud Services. A board carrying
  // only picture cards must get the Images divider and nothing else.
  it('files every picture card under Images, the clock and services under Reference', () => {
    const pics = stepTwoVisibility(['art', 'photos', 'gdrivephotos', 'landscapes', 'apod', 'iptv']);
    expect([...pics.sections].sort()).toEqual(['art-field', 'gdrivephotos-field', 'iptv-field', 'photos-field']);
    expect([...pics.groups]).toEqual(['Images']); // landscapes and apod have nothing to configure
    const ref = stepTwoVisibility(['worldclock', 'services']);
    expect([...ref.sections].sort()).toEqual(['services-field', 'wc-field']);
    expect([...ref.groups]).toEqual(['Reference']);
  });

  // Daily's only configurable card is the chart: the other three ask nothing.
  it('shows the Daily divider for the chart alone', () => {
    const daily = stepTwoVisibility(['history', 'quote', 'wotd', 'chart']);
    expect([...daily.sections]).toEqual(['chart-field']);
    expect([...daily.groups]).toEqual(['Daily']);
  });
  // applyStepTwo hides a divider whose label isn't in the visible-groups set and
  // a section whose id isn't in the visible-sections set, so a SETUP_SECTIONS
  // group with no matching <h2 data-group> (or a section with no element) is a
  // silently unreachable field. Splitting Markets & Sports is exactly the kind
  // of edit that strands one.
  it('every SETUP_SECTIONS group + section id exists in setup.html', async () => {
    // cwd-relative, not import.meta.url: under happy-dom import.meta.url is not
    // a file: URL (same reason test/bootguard.test.js resolves this way).
    const html = await readFile(resolve(process.cwd(), 'site/setup.html'), 'utf8');
    for (const s of SETUP_SECTIONS) {
      expect(html, s.id).toContain(`id="${s.id}"`);
      const divider = s.group.replace(/&/g, '&amp;');
      expect(html, s.group).toContain(`data-group="${divider}"`);
    }
  });

  // The OTHER direction, and the one that actually bit: the guard above only
  // proves that the groups SETUP_SECTIONS names have dividers. A brand-new
  // WIDGET_GROUPS label with no divider and no section is invisible in step 2
  // — its fields either never appear or sit stranded under the heading above
  // them, and nothing above notices. Retiring Ambient and adding Reference is
  // exactly that edit.
  it('every WIDGET_GROUPS label has a step-2 divider AND at least one SETUP_SECTIONS entry', async () => {
    const html = await readFile(resolve(process.cwd(), 'site/setup.html'), 'utf8');
    const claimed = new Set(SETUP_SECTIONS.map((s) => s.group));
    for (const { label } of WIDGET_GROUPS) {
      expect(html, `${label} divider`).toContain(`data-group="${label.replace(/&/g, '&amp;')}"`);
      expect(claimed.has(label), `${label} has no SETUP_SECTIONS entry`).toBe(true);
    }
    // and no divider survives for a group that no longer exists (retiring
    // Ambient must take its <h2> with it, or step 2 grows a dead heading)
    const dividers = [...html.matchAll(/data-group="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    expect([...new Set(dividers)].sort()).toEqual(WIDGET_GROUPS.map((g) => g.label).sort());
  });

  // Step-2 fields render in document order, so a divider whose fields sit above
  // it labels the WRONG section. Walk the file once: every SETUP_SECTIONS field
  // must appear after its own group's divider and before the next one.
  it('every step-2 field sits under its own divider in setup.html', async () => {
    const html = await readFile(resolve(process.cwd(), 'site/setup.html'), 'utf8');
    const at = (needle) => html.indexOf(needle);
    const dividerAt = (label) => at(`data-group="${label.replace(/&/g, '&amp;')}"`);
    const labels = WIDGET_GROUPS.map((g) => g.label);
    for (const s of SETUP_SECTIONS) {
      const fieldAt = at(`id="${s.id}"`);
      const own = dividerAt(s.group);
      expect(fieldAt, `${s.id} after its ${s.group} divider`).toBeGreaterThan(own);
      const next = labels.slice(labels.indexOf(s.group) + 1).map(dividerAt).find((i) => i > own);
      if (next !== undefined) expect(fieldAt, `${s.id} before the next divider`).toBeLessThan(next);
    }
  });

  it('SETUP_SECTIONS triggers are valid WIDGET_IDS and groups are valid WIDGET_GROUPS labels', () => {
    const validIds = new Set(ALL_IDS);
    const validGroups = new Set(WIDGET_GROUPS.map((g) => g.label));
    for (const s of SETUP_SECTIONS) {
      for (const t of s.triggers) expect(validIds.has(t)).toBe(true);
      expect(validGroups.has(s.group)).toBe(true);
    }
  });
});

describe('navHtml', () => {
  it('renders pinned items + group headers; children live in a wrapper that is closed until open', () => {
    const html = navHtml('widgets', null);
    expect(html).toContain('data-section="widgets"');          // pinned item
    expect(html).toContain('data-group="Commute"');            // group header
    expect(html).toMatch(/data-group="Commute"[^>]*aria-expanded="false"/);
    // children are always in the DOM (for the collapse animation); no group wrapper is open
    expect(html).toContain('data-section="subway"');
    expect((html.match(/settings__navkids is-open/g) || []).length).toBe(0);
    // active pinned item highlighted
    expect(html).toMatch(/class="settings__navitem is-active"[^>]*data-section="widgets"/);
  });
  it('opens exactly the active group wrapper with the active child highlighted', () => {
    const html = navHtml('subway', 'Commute');
    expect(html).toMatch(/data-group="Commute"[^>]*aria-expanded="true"/);
    expect((html.match(/settings__navkids is-open/g) || []).length).toBe(1); // only Commute open
    expect(html).toMatch(/settings__navchild is-active"[^>]*data-section="subway"/);
  });
});

const BUS = {
  routes: [
    { id: 'QM24', lineRef: 'MTABC_QM24', dirs: [
      { id: 0, headsign: 'Manhattan', stops: ['a', 'b'] },
      { id: 1, headsign: 'Bayside', stops: ['b', 'a'] } ] },
    { id: 'X27', lineRef: 'MTA NYCT_X27', dirs: [ { id: 0, headsign: 'Downtown', stops: ['c'] } ] },
  ],
  stops: { a: 'Madison Av / E 34 St', b: '5 Av / W 57 St', c: 'Water St' },
};

describe('express bus pickers', () => {
  it('lists routes with their lineRef', () => {
    expect(expressRoutes(BUS)).toEqual([
      { id: 'QM24', lineRef: 'MTABC_QM24' }, { id: 'X27', lineRef: 'MTA NYCT_X27' }]);
  });
  it('lists a route directions by headsign', () => {
    expect(directionsForRoute(BUS, 'QM24')).toEqual([
      { id: 0, headsign: 'Manhattan' }, { id: 1, headsign: 'Bayside' }]);
    expect(directionsForRoute(BUS, 'NOPE')).toEqual([]);
  });
  it('lists a route+direction stops in order with names', () => {
    expect(stopsForRouteDir(BUS, 'QM24', 1)).toEqual([
      { id: 'b', name: '5 Av / W 57 St' }, { id: 'a', name: 'Madison Av / E 34 St' }]);
    expect(stopsForRouteDir(BUS, 'QM24', 9)).toEqual([]);
  });
});

import { signageUrlFor } from '../site/js/settings/setup.js';

describe('signageUrlFor (non-touch boards)', () => {
  it('builds a cfg-only signage URL', () => {
    expect(signageUrlFor('signage.rvc.tech', 'AbC-_123')).toBe('https://signage.rvc.tech/#cfg=AbC-_123');
  });
  it('never carries auth', () => {
    expect(signageUrlFor('h.example', 'x')).not.toContain('auth');
  });
});

describe('searchStations (Citi Bike picker)', () => {
  const stations = [
    { id: 'a', name: 'W 29 St & 9 Ave' },
    { id: 'b', name: 'Broadway & W 29 St' },
    { id: 'c', name: '10 Ave & W 28 St' },
  ];
  it('includes already-chosen stations, marked added (the pre-populated-default bug)', () => {
    const out = searchStations(stations, 'W 29 ST', new Set(['a']));
    expect(out.map((s) => s.id)).toEqual(['a', 'b']);
    expect(out[0].added).toBe(true);
    expect(out[1].added).toBe(false);
  });
  it('is case-insensitive and trims', () => {
    expect(searchStations(stations, '  w 28  ', new Set())).toHaveLength(1);
  });
  it('returns nothing under 2 chars and respects the cap', () => {
    expect(searchStations(stations, 'W', new Set())).toEqual([]);
    expect(searchStations(stations, 'W 2', new Set(), 1)).toHaveLength(1);
  });
});

import { isBridgeHost } from '../site/js/bridge.js';
describe('isBridgeHost (fragment IP validation)', () => {
  it('accepts IPv4/hostname/port and bracketed IPv6', () => {
    expect(isBridgeHost('192.168.1.50')).toBe(true);
    expect(isBridgeHost('board.local')).toBe(true);
    expect(isBridgeHost('10.0.0.1:443')).toBe(true);
    expect(isBridgeHost('[fe80::1]')).toBe(true);
  });
  it('rejects anything that could redirect the socket', () => {
    expect(isBridgeHost('evil.com/ws?x=')).toBe(false);
    expect(isBridgeHost('a@b')).toBe(false);
    expect(isBridgeHost('has space')).toBe(false);
    expect(isBridgeHost(undefined)).toBe(false);
  });
});

describe('nerd-mode picker gating (every add surface routes through isAddable)', () => {
  // An advanced widget (iptv) must be absent from EVERY add surface unless
  // nerd mode is on — and still manageable once placed. One table so a new
  // surface or a new advanced card can't silently regress a single path.
  const hasIptv = {
    'settings toggles (widgetGroupsHtml)': (cfg) => widgetGroupsHtml(cfg.layout ?? [], cfg).includes('data-toggle="iptv"'),
    'setup checkboxes (widgetChecksHtml)': (cfg) => widgetChecksHtml(SETUP_LABELS, new Set((cfg.layout ?? []).map((r) => r.id)), cfg).includes('data-w="iptv"'),
    'settings nav (navHtml)': (cfg) => navHtml('widgets', null, cfg).includes('Live Video'),
  };

  it('hides iptv on every surface with nerd mode OFF', () => {
    for (const [surface, has] of Object.entries(hasIptv)) {
      expect(has({ nerdMode: false, layout: [] }), surface).toBe(false);
    }
  });

  it('shows iptv on every surface with nerd mode ON', () => {
    for (const [surface, has] of Object.entries(hasIptv)) {
      expect(has({ nerdMode: true, layout: [] }), surface).toBe(true);
    }
  });

  it('keeps a PLACED iptv visible even with nerd mode off (removal path)', () => {
    const placed = { nerdMode: false, layout: [{ id: 'iptv', x: 0, y: 0, w: 3, h: 3 }] };
    for (const [surface, has] of Object.entries(hasIptv)) {
      expect(has(placed), surface).toBe(true);
    }
  });

  it('never hides an ordinary widget', () => {
    expect(widgetGroupsHtml([], { nerdMode: false }).includes('data-toggle="weather"')).toBe(true);
    expect(widgetChecksHtml(SETUP_LABELS, new Set(), { nerdMode: false }).includes('data-w="weather"')).toBe(true);
  });
});

import { openSettings, closeSettings } from '../site/js/settings/settings.js';
import { normalizeConfig } from '../site/js/config.js';
import { CHART_TOPICS } from '../site/js/widgets/chart-topics.js';

describe('Chart of the Day pane (all topics on by default)', () => {
  // The pane is rendered for real (openSettings → renderChart) so the default
  // and the "Select all" mapping are verified against the DOM users touch,
  // not a re-implementation of the toggle logic.
  const settle = () => new Promise((r) => setTimeout(r, 30));
  const pills = () => [...document.querySelectorAll('.settings__pane [data-topic]')];
  const lit = () => pills().filter((p) => p.classList.contains('is-on')).length;
  const allBtn = () => document.querySelector('.settings__pane [data-topic-all]');
  const open = async (cfg) => {
    document.body.innerHTML = '<div id="settings-root"></div>';
    await openSettings(cfg, { focus: 'chart' });
    await settle();
  };

  it('lights every topic pill and the Select all control on a fresh config', async () => {
    await open(normalizeConfig({}));
    expect(pills().length).toBe(CHART_TOPICS.length);
    expect(lit()).toBe(CHART_TOPICS.length);
    expect(allBtn().classList.contains('is-on')).toBe(true);
    expect(allBtn().getAttribute('aria-checked')).toBe('true');
    closeSettings();
  });

  it('Select all clears to the global listing from all-on, and restores all-on from empty', async () => {
    await open(normalizeConfig({}));
    allBtn().click();
    await settle();
    expect(lit()).toBe(0); // every topic off = newest chart across everything
    expect(allBtn().classList.contains('is-on')).toBe(false);
    allBtn().click();
    await settle();
    expect(lit()).toBe(CHART_TOPICS.length);
    closeSettings();
  });

  it('turning one topic off leaves a partial selection with Select all unlit', async () => {
    await open(normalizeConfig({}));
    pills()[0].click();
    await settle();
    expect(lit()).toBe(CHART_TOPICS.length - 1);
    expect(allBtn().classList.contains('is-on')).toBe(false);
    closeSettings();
  });

  it('renders a saved partial selection as exactly those pills', async () => {
    await open(normalizeConfig({ chart: { topics: ['finance', 'sports'] } }));
    expect(lit()).toBe(2);
    expect(pills().filter((p) => p.classList.contains('is-on')).map((p) => p.dataset.topic)).toEqual(['finance', 'sports']);
    closeSettings();
  });
});

describe('Markets pane (the ordered ticker list)', () => {
  const settle = () => new Promise((r) => setTimeout(r, 30));
  const POOL = ['^DJI', '^IXIC', '^GSPC', 'AAPL', 'MSFT', 'NVDA', 'CSCO', 'TSLA', 'AMZN', 'CBG.L',
    'SAP.DE', '7203.T', 'GOOGL', 'META', 'NFLX', 'AMD', 'INTC', 'ORCL', 'CRM', 'ADBE'];
  const open = async (n, rect = { w: 4, h: 4 }) => {
    document.body.innerHTML = '<div id="settings-root"></div>';
    const cfg = normalizeConfig({
      markets: { symbols: POOL.slice(0, n) },
      layout: [{ id: 'markets', x: 0, y: 0, ...rect }],
    });
    await openSettings(cfg, { focus: 'markets' });
    await settle();
  };
  const rows = () => [...document.querySelectorAll('.settings__pane .tk-row')];
  const q = (sel) => document.querySelector(`.settings__pane ${sel}`);

  // Two columns is the whole point of this layout: the keypad has to stay put
  // while the list grows, or adding a ticker means scrolling past all 20.
  it('keeps the list and the keypad side by side', async () => {
    await open(12);
    expect(q('.pane__cols')).not.toBe(null);
    expect(document.querySelectorAll('.settings__pane .pane__col').length).toBe(2);
    expect(q('.pane__col:last-child .osk')).not.toBe(null); // keypad in the right column
    expect(q('.pane__col:first-child .tk-list')).not.toBe(null);
    closeSettings();
  });

  it('renders a row per ticker with a handle and a remove, and folds after 5 on a 4x4', async () => {
    await open(12);
    expect(rows().length).toBe(12);
    expect(document.querySelectorAll('.settings__pane [data-reorder]').length).toBe(12);
    expect(document.querySelectorAll('.settings__pane [data-remove-sym]').length).toBe(12);
    expect(q('.colhead span').textContent).toBe('Markets card is 4×4, so it shows the first 5');
    const labels = [...document.querySelectorAll('.settings__pane .tk-fold__label')].map((e) => e.textContent);
    expect(labels).toEqual(['On the card now · 5', 'Behind a tap · 7']);
    expect(document.querySelectorAll('.settings__pane .tk-row--below').length).toBe(7);
    closeSettings();
  });

  // The number is read from the layout, never hard-coded: a taller card moves
  // the line without the list changing at all.
  it('moves the fold when the card is a different size', async () => {
    await open(12, { w: 3, h: 3 });
    expect(q('.tk-fold__label').textContent).toBe('On the card now · 3');
    closeSettings();
    await open(12, { w: 4, h: 8 });
    expect(q('.tk-fold__label').textContent).toBe('On the card now · 11');
    closeSettings();
  });

  it('handles the 1, 2 and 20 edges', async () => {
    await open(1);
    expect(rows().length).toBe(1);
    expect(q('[data-reorder]')).toBe(null); // a handle that cannot reorder is a lie
    expect(q('[data-remove-sym]')).not.toBe(null);
    expect(q('.tk-fold')).toBe(null);
    expect(q('.tk-note').textContent).toMatch(/Add a second ticker/);
    closeSettings();

    await open(2);
    expect(document.querySelectorAll('.settings__pane [data-reorder]').length).toBe(2);
    expect(q('.tk-fold')).toBe(null); // both fit a 4x4 card
    expect(q('.tk-note')).toBe(null);
    closeSettings();

    await open(20);
    expect(rows().length).toBe(20);
    expect([...document.querySelectorAll('.settings__pane .tk-fold__label')].map((e) => e.textContent))
      .toEqual(['On the card now · 5', 'Behind a tap · 15']);
    expect(q('.pane__col:last-child .colhead span').textContent).toBe('0 slots left');
    closeSettings();
  });

  it('says so when the Markets card is not on the board', async () => {
    document.body.innerHTML = '<div id="settings-root"></div>';
    await openSettings(normalizeConfig({
      markets: { symbols: POOL.slice(0, 6) },
      layout: [{ id: 'weather', x: 0, y: 0, w: 3, h: 3 }],
    }), { focus: 'markets' });
    await settle();
    expect(q('.colhead span').textContent).toMatch(/isn.t on the board right now/);
    expect(q('.tk-fold')).toBe(null); // no capacity exists, so no line is drawn
    expect(rows().length).toBe(6); // the list still orders
    closeSettings();
  });

  it('still removes a ticker, and re-numbers what is left', async () => {
    await open(6);
    document.querySelector('.settings__pane [data-remove-sym="^IXIC"]').click();
    await settle();
    expect(rows().map((r) => r.dataset.sym)).toEqual(['^DJI', '^GSPC', 'AAPL', 'MSFT', 'NVDA']);
    expect([...document.querySelectorAll('.settings__pane .tk-pos')].map((e) => e.textContent))
      .toEqual(['1', '2', '3', '4', '5']);
    closeSettings();
  });

  // Reachable only by removing the last ticker in the pane — normalizeConfig
  // refills an empty list from the defaults, so no saved config lands here.
  it('offers no order UI at all once the last ticker is removed', async () => {
    await open(1);
    document.querySelector('.settings__pane [data-remove-sym]').click();
    await settle();
    expect(rows().length).toBe(0);
    expect(q('.pane__empty').textContent).toMatch(/three index defaults return on save/);
    expect(q('.osk')).not.toBe(null); // the keypad never left the right column
    closeSettings();
  });
});

/* ---------- What's new: the rail FOOTER's entry, not a 16th nav row ---------- */

// The placement is the whole point and it is load-bearing, so it is asserted
// rather than described. `.settings__nav` is the only part of the rail that
// scrolls; `.settings__railfoot` is `flex: none` and never does. Putting the
// entry in the footer is what keeps a growing Settings from pushing the rail's
// last row (Diagnostics) out of sight on a board — and it is what keeps
// NAV_MODEL === SECTION_IDS, which the coverage test above pins.
const shippedLog = JSON.parse(await readFile(resolve(process.cwd(), 'site/data/changelog.json'), 'utf8'));

describe('Settings → What’s new', () => {
  const settle = () => new Promise((r) => setTimeout(r, 30));
  const entry = () => document.querySelector('[data-whatsnew]');
  const open = async () => {
    document.body.innerHTML = '<div id="settings-root"></div>';
    window.__signage = { version: 'fa395c8b41d2' };
    await openSettings(normalizeConfig({}), {});
    await settle();
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(shippedLog), {
      status: 200, headers: { 'content-type': 'application/json' },
    })));
  });
  afterEach(() => {
    closeSettings();
    vi.unstubAllGlobals();
    delete window.__signage;
  });

  it('adds no nav row: NAV_MODEL is untouched and the entry is in the footer', async () => {
    await open();
    expect(NAV_MODEL.some((e) => e.id === 'whatsnew')).toBe(false);
    expect(SECTION_IDS).not.toContain('whatsnew');
    expect(document.querySelector('.settings__nav [data-whatsnew]')).toBeNull();
    expect(document.querySelector('.settings__railfoot [data-whatsnew]')).not.toBeNull();
    // Save and Cancel keep their place above it; the wordmark is now its face.
    const foot = [...document.querySelectorAll('.settings__railfoot > *')].map((e) => e.className.split(' ')[0]);
    expect(foot).toEqual(['btn', 'btn', 'settings__whatsnew']);
    expect(document.querySelector('.settings__whatsnew .settings__lockup')).not.toBeNull();
  });

  it('names itself and nothing else; the version stays in the pane’s colophon', async () => {
    await open();
    expect(entry().textContent.trim()).toBe('What’s new');
    expect(entry().textContent).not.toMatch(/[0-9a-f]{7}/); // no build id on the rail
    entry().click();
    await settle();
    // …and the board still answers "what version am I running", one tap in.
    expect(document.querySelector('.log__foot').textContent).toContain('fa395c8b41d2');
  });

  it('opens the notes as a pane with a back control, and back returns to the section', async () => {
    await open();
    expect(document.querySelector('.settings__pane .pane__title').textContent).toBe('Display');
    entry().click();
    await settle();
    expect(document.querySelector('.settings__pane .pane__title').textContent).toBe('What’s new');
    expect(document.querySelectorAll('.settings__pane .log__group').length).toBe(shippedLog.length);
    expect(entry().classList.contains('is-active')).toBe(true);
    // The nav highlight never moved, so back has somewhere honest to go.
    expect(document.querySelector('.settings__navitem.is-active').textContent).toBe('Display');
    document.querySelector('[data-wn-back]').click();
    await settle();
    expect(document.querySelector('.settings__pane .pane__title').textContent).toBe('Display');
    expect(entry().classList.contains('is-active')).toBe(false);
  });

  it('drops the active mark when the reader picks a nav section instead of backing out', async () => {
    await open();
    entry().click();
    await settle();
    document.querySelector('.settings__nav [data-section="widgets"]').click();
    await settle();
    expect(entry().classList.contains('is-active')).toBe(false);
    expect(document.querySelector('.settings__pane .pane__title').textContent).toContain('Widgets');
  });

  it('leaves Save and Cancel working after a trip through the notes', async () => {
    await open();
    entry().click();
    await settle();
    document.querySelector('[data-wn-back]').click();
    await settle();
    document.querySelector('.settings__close').click();
    expect(document.querySelector('.settings')).toBeNull();
  });

  it('renders one quiet line, never an error, when the notes cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await open();
    entry().click();
    await settle();
    // NOT the pane-level "Couldn't load this section" copy: loadChangelog's
    // never-throw contract turns a dead network into an absence, not an error.
    expect(document.querySelector('.pane__empty')).toBeNull();
    expect(document.querySelector('.log__empty').textContent).toContain('roomboard.app/info');
    expect(document.querySelector('.pane__title').textContent).toBe('What’s new');
    expect(document.querySelector('[data-log-more]')).toBeNull();
  });
});
