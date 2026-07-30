/**
 * @vitest-environment happy-dom
 */
// happy-dom only because this file imports setup.js for the scanned-board rule
// (setup.js touches `document` at module scope). The generator itself is pure and
// has no DOM anywhere near it.
//
// The content-aware layout generator. Two halves:
//
//   1. INVARIANTS — determinism, validity, the round trip through
//      normalizeLayout, the column structure, the presentable floors.
//   2. METRICS over the ten-persona corpus (test/fixtures/layout-personas.js).
//      This is the half that protects users from a future capacity change: a
//      tweak to capacity.js that makes a generated board leave holes, or hide a
//      list the user typed in, fails here instead of shipping to a wall.
import { describe, it, expect } from 'vitest';
import {
  optimizeLayout, measure, legibleFloor, DEMAND, FLOOR, GROUP_ORDER,
} from '../site/js/layout-optimize.js';
import {
  GRID, MIN_SIZE, MAX_SIZE, DEFAULT_LAYOUT, contentMaxH, normalizeLayout, meetsMin, rectsOverlap, minAlternatives,
} from '../site/js/layout.js';
import { itemCapacity } from '../site/js/capacity.js';
import { WIDGET_IDS, WIDGET_GROUPS, normalizeConfig, DEFAULT_CONFIG } from '../site/js/config.js';
import { QUICKSTART_CONFIG } from '../site/js/quickstart.js';
import { layoutFor, crowdedNote } from '../site/js/settings/setup.js';
import { PERSONAS } from './fixtures/layout-personas.js';

const cfgFor = (p) => normalizeConfig(structuredClone(p.cfg));
const CASES = PERSONAS.map((p) => ({ ...p, cfg: cfgFor(p), out: optimizeLayout(p.widgets, cfgFor(p)) }));
const cells = (layout) => layout.reduce((s, r) => s + r.w * r.h, 0);

describe('the demand model is complete and cited', () => {
  it('covers every widget id, and nothing that is not one', () => {
    expect(Object.keys(DEMAND).sort()).toEqual([...WIDGET_IDS].sort());
  });

  it('names the same groups WIDGET_GROUPS does', () => {
    // The generator's left-to-right reading order is its own list, on purpose:
    // WIDGET_GROUPS' order is picker ergonomics, this one is how a board reads.
    // But it must name the same GROUPS — rename or add one without touching this
    // list and its widgets silently sort last, behind the wallpaper.
    expect([...GROUP_ORDER].sort()).toEqual(WIDGET_GROUPS.map((g) => g.label).sort());
    // And every widget must belong to a group, or it ranks last for the same reason.
    const grouped = new Set(WIDGET_GROUPS.flatMap((g) => g.ids));
    expect([...WIDGET_IDS].filter((id) => !grouped.has(id))).toEqual([]);
  });

  it('rests on capacity being a function of height alone', () => {
    // This is the fact the whole design depends on: content demand sets HEIGHT,
    // and width is free for packing. If a capacity model ever starts reading w,
    // the generator's single-width probe becomes a lie.
    for (const id of WIDGET_IDS) {
      for (let h = 1; h <= GRID.rows; h++) {
        const at = (w) => itemCapacity(id, w, h);
        for (let w = 1; w <= GRID.cols; w++) expect(at(w), `${id} ${w}x${h}`).toBe(at(1));
      }
    }
  });

  it('lists no inert presentable floor', () => {
    // A floor at or below the widget's own minimum height is decoration: it can
    // never change a placement, and it makes the table read as if it does.
    for (const [id, f] of Object.entries(FLOOR)) {
      const colW = MAX_SIZE[id]?.[0] ?? GRID.cols;
      const base = legibleFloor(id, colW)[1];
      const cfg = normalizeConfig(structuredClone(DEFAULT_CONFIG));
      let want = f.minH ?? base;
      if (f.items) {
        for (let h = base; h <= GRID.rows; h++) {
          const cap = itemCapacity(id, MIN_SIZE[id][0], h);
          const trim = typeof DEMAND[id].trim === 'function' ? DEMAND[id].trim(cfg) : (DEMAND[id].trim ?? 0);
          if (Math.max(1, cap - trim) >= f.items) { want = Math.max(want, h); break; }
        }
      }
      expect(want, `${id} floor is inert`).toBeGreaterThan(base);
    }
  });
});

describe('optimizeLayout invariants', () => {
  it('is deterministic and order-independent', () => {
    for (const p of CASES) {
      const again = optimizeLayout(p.widgets, cfgFor(p));
      const reversed = optimizeLayout([...p.widgets].reverse(), cfgFor(p));
      expect(JSON.stringify(again.layout), p.key).toBe(JSON.stringify(p.out.layout));
      expect(JSON.stringify(reversed.layout), p.key).toBe(JSON.stringify(p.out.layout));
    }
  });

  it('emits only legal rects: in bounds, no overlaps, above MIN, below MAX', () => {
    for (const p of CASES) {
      for (const [i, r] of p.out.layout.entries()) {
        expect(meetsMin(r.id, r.w, r.h), `${p.key} ${r.id} ${r.w}x${r.h}`).toBe(true);
        expect(r.w, `${p.key} ${r.id}`).toBeLessThanOrEqual(MAX_SIZE[r.id]?.[0] ?? GRID.cols);
        expect(r.h, `${p.key} ${r.id}`).toBeLessThanOrEqual(MAX_SIZE[r.id]?.[1] ?? GRID.rows);
        expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= GRID.cols && r.y + r.h <= GRID.rows, `${p.key} ${r.id}`).toBe(true);
        for (const s of p.out.layout.slice(i + 1)) {
          expect(rectsOverlap(r, s), `${p.key} ${r.id} overlaps ${s.id}`).toBe(false);
        }
      }
    }
  });

  it('survives normalizeLayout under the content caps, byte for byte', () => {
    // config.js re-clamps every layout on load and on save. A generated board
    // that does not survive that round trip has its holes silently re-opened,
    // which is exactly the bug the content-aware height caps used to cause.
    for (const p of CASES) {
      const round = normalizeLayout(p.out.layout, contentMaxH(p.cfg));
      expect(JSON.stringify(round), p.key).toBe(JSON.stringify(p.out.layout));
    }
  });

  it('keeps every card inside one of 2..6 vertical columns', () => {
    // The machine-checkable form of "calm, not bin-packing soup": every card is a
    // full-width slice of a column whose edges run the height of the grid.
    for (const p of CASES) {
      const edges = new Set([0, GRID.cols]);
      for (const r of p.out.layout) edges.add(r.x);
      const sorted = [...edges].sort((a, b) => a - b);
      expect(sorted.length - 1, `${p.key} column count`).toBeGreaterThanOrEqual(1);
      expect(sorted.length - 1, `${p.key} column count`).toBeLessThanOrEqual(6);
      for (const r of p.out.layout) {
        expect(sorted, `${p.key} ${r.id} left edge`).toContain(r.x);
        // A card may be narrower than its column when MAX_SIZE caps it, but it
        // must never straddle a boundary.
        const next = sorted[sorted.indexOf(r.x) + 1];
        expect(r.x + r.w, `${p.key} ${r.id} right edge`).toBeLessThanOrEqual(next);
      }
    }
  });

  it('never refuses a widget, for any corpus pick', () => {
    for (const p of CASES) expect(p.out.dropped, p.key).toEqual([]);
  });

  it('leaves an empty pick empty (the /setup guard still has something to block)', () => {
    const cfg = normalizeConfig(structuredClone(DEFAULT_CONFIG));
    expect(optimizeLayout([], cfg).layout).toEqual([]);
    expect(optimizeLayout(['not-a-widget'], cfg).layout).toEqual([]);
  });

  it('puts the reading order on the board: weather top-left, pictures last', () => {
    const withWeather = CASES.filter((p) => p.widgets.includes('weather'));
    expect(withWeather.length).toBeGreaterThan(5);
    for (const p of withWeather) {
      const first = p.out.layout[0];
      expect(first, p.key).toMatchObject({ id: 'weather', x: 0, y: 0 });
    }
  });
});

describe('presentable floors', () => {
  it('never puts a data card below its floor when the pick has the room', () => {
    // The floors bind for every pick the board can hold well. `crowded` is the
    // generator saying out loud that this pick could not, and /setup repeats it.
    for (const p of CASES) {
      for (const r of p.out.layout) {
        const f = FLOOR[r.id];
        if (!f || p.out.crowded.includes(r.id)) continue;
        if (f.minH) expect(r.h, `${p.key} ${r.id}`).toBeGreaterThanOrEqual(f.minH);
        if (f.items) {
          const trim = typeof DEMAND[r.id].trim === 'function' ? DEMAND[r.id].trim(p.cfg) : (DEMAND[r.id].trim ?? 0);
          const shows = Math.max(1, itemCapacity(r.id, r.w, r.h) - trim);
          const owed = DEMAND[r.id].kind === 'exact'
            ? Math.min(f.items, DEMAND[r.id].count(p.cfg) || f.items)
            : f.items;
          expect(shows, `${p.key} ${r.id} ${r.w}x${r.h}`).toBeGreaterThanOrEqual(owed);
        }
      }
    }
  });

  it('would rather crowd a card than refuse it', () => {
    // Kitchen sink: twelve widgets against a board whose presentable floors add
    // up to more than 32 rows. The honest outcome is every card placed, some of
    // them small, and a page that says so — not a card the user ticked going
    // missing.
    const sink = CASES.find((p) => p.key === 'kitchensink');
    expect(sink.out.dropped).toEqual([]);
    expect(sink.out.crowded.length).toBeGreaterThan(0);
    expect(crowdedNote(sink.out.crowded.length)).toMatch(/cards will be small/);
    expect(crowdedNote(1)).toMatch(/One card will be small/);
    expect(crowdedNote(0)).toBe('');
  });

  it('degrades canvas polish before it breaks a configured list', () => {
    // The order that costs the user least: a picture gives back area (it loses
    // polish, not facts) before a card that shows named items loses one.
    for (const p of CASES) {
      const byId = new Map(p.out.layout.map((r) => [r.id, r]));
      const broken = p.out.layout.filter((r) => {
        if (DEMAND[r.id].kind !== 'exact') return false;
        const trim = typeof DEMAND[r.id].trim === 'function' ? DEMAND[r.id].trim(p.cfg) : (DEMAND[r.id].trim ?? 0);
        const total = DEMAND[r.id].count(p.cfg) || 0;
        return total > Math.max(1, itemCapacity(r.id, r.w, r.h) - trim);
      });
      for (const b of broken) {
        // ...unless the list cannot fit on ANY card, which is a fact about the
        // list, not a choice the generator made.
        let ceiling = 0;
        for (let h = MIN_SIZE[b.id][1]; h <= GRID.rows; h++) ceiling = Math.max(ceiling, itemCapacity(b.id, b.w, h));
        const impossible = (DEMAND[b.id].count(p.cfg) || 0) > ceiling;
        const canvasAbove = p.out.layout.some((r) =>
          DEMAND[r.id].kind === 'canvas' && r.x === b.x && r.h > legibleFloor(r.id, r.w)[1]);
        expect(impossible || !canvasAbove, `${p.key}: ${b.id} broke while a canvas card in its column had room to give`).toBe(true);
      }
    }
  });
});

describe('metrics over the corpus: zero holes, zero avoidable broken promises', () => {
  // The numbers that made the case for this change, pinned so they cannot rot.
  // A capacity edit that costs a generated board a row lands here first.
  //
  // Every pick gets zero blank cells and zero avoidable broken promises. The one
  // exception is the deliberately oversubscribed pick: twelve widgets against a
  // board that holds about nine well. Its breakage is budgeted rather than
  // asserted away, so an improvement passes and a regression does not.
  const AVOIDABLE_BUDGET = { kitchensink: 4 };
  const trimOf = (id, cfg) =>
    (typeof DEMAND[id].trim === 'function' ? DEMAND[id].trim(cfg) : DEMAND[id].trim) ?? 0;
  // The most this widget could EVER show, at any legal height.
  const ceilingOf = (id, cfg) => {
    let best = 0;
    for (let h = MIN_SIZE[id][1]; h <= (MAX_SIZE[id]?.[1] ?? GRID.rows); h++) {
      best = Math.max(best, Math.max(1, itemCapacity(id, MIN_SIZE[id][0], h) - trimOf(id, cfg)));
    }
    return best;
  };

  for (const p of PERSONAS) {
    it(`${p.key}: fills the board and keeps the promises`, () => {
      const cfg = cfgFor(p);
      const out = optimizeLayout(p.widgets, cfg);
      const m = measure(out.layout, cfg, out.dropped);
      expect(cells(out.layout), 'cells used').toBe(GRID.cols * GRID.rows);
      expect(m.blank, 'blank cells').toBe(0);
      expect(out.dropped, 'widgets refused').toEqual([]);

      // Rows used per column, so a broken promise can be checked against whether
      // the board actually had a row left to give it.
      const usedInColumn = new Map();
      for (const r of out.layout) usedInColumn.set(r.x, (usedInColumn.get(r.x) ?? 0) + r.h);

      let avoidable = 0;
      for (const r of out.layout) {
        if (DEMAND[r.id].kind !== 'exact') continue;
        const total = DEMAND[r.id].count(cfg) || 0;
        const shown = Math.min(total, Math.max(1, itemCapacity(r.id, r.w, r.h) - trimOf(r.id, cfg)));
        if (shown >= total) continue;
        // A list no card size could ever have shown is a fact about the list.
        if (total > ceilingOf(r.id, cfg)) continue;
        avoidable += total - shown;
        // ...and whatever is left short must be short because the board ran out,
        // not because the generator left a row unspent next to it.
        const capped = r.h >= Math.min(MAX_SIZE[r.id]?.[1] ?? GRID.rows, contentMaxH(cfg)[r.id] ?? GRID.rows);
        expect(capped || usedInColumn.get(r.x) === GRID.rows,
          `${p.key}: ${r.id} shows ${shown} of ${total} with a spare row in its column`).toBe(true);
      }
      expect(avoidable, `avoidable broken promises: ${m.detail.join(', ')}`)
        .toBeLessThanOrEqual(AVOIDABLE_BUDGET[p.key] ?? 0);
    });
  }

  it('beats today\'s first-fit-at-minimum board on every persona', () => {
    // Today: check a box, get the widget at MIN_SIZE in the first free slot.
    let before = 0;
    let after = 0;
    for (const p of PERSONAS) {
      const cfg = cfgFor(p);
      let layout = [];
      for (const id of WIDGET_GROUPS.flatMap((g) => g.ids)) {
        if (!p.widgets.includes(id)) continue;
        const [w, h] = minAlternatives(id)[0];
        // first-fit, y-major, exactly as layout.js firstFit scans
        outer: for (let y = 0; y + h <= GRID.rows; y++) {
          for (let x = 0; x + w <= GRID.cols; x++) {
            const rect = { id, x, y, w, h };
            if (!layout.some((r) => rectsOverlap(r, rect))) { layout.push(rect); break outer; }
          }
        }
      }
      const mb = measure(normalizeLayout(layout, contentMaxH(cfg)), cfg, []);
      const out = optimizeLayout(p.widgets, cfg);
      const ma = measure(out.layout, cfg, out.dropped);
      before += mb.blank + mb.hiddenExact;
      after += ma.blank + ma.hiddenExact;
      expect(ma.blank, `${p.key} blank`).toBeLessThan(mb.blank);
      expect(ma.hiddenExact, `${p.key} broken promises`).toBeLessThanOrEqual(mb.hiddenExact);
    }
    expect(after).toBeLessThan(before / 5);
  });
});

describe('the two hand-arranged presets are left alone', () => {
  it('quick start still tiles all 96 cells itself', () => {
    expect(cells(QUICKSTART_CONFIG.layout)).toBe(GRID.cols * GRID.rows);
  });
  it('the default board still tiles all 96 cells itself', () => {
    expect(cells(DEFAULT_LAYOUT)).toBe(GRID.cols * GRID.rows);
  });
});

describe('layoutFor: the scanned-board preserve rule', () => {
  const cfg = normalizeConfig(structuredClone(DEFAULT_CONFIG));
  const scanned = [
    { id: 'weather', x: 0, y: 0, w: 6, h: 4 },
    { id: 'news', x: 6, y: 0, w: 6, h: 4 },
    { id: 'markets', x: 0, y: 4, w: 4, h: 4 },
  ];
  const ids = scanned.map((r) => r.id);

  it('hands a scanned board straight back while the pick set matches', () => {
    const res = layoutFor(ids, cfg, scanned);
    expect(res.scannedKept).toBe(true);
    expect(res.layout).toEqual(scanned);
    // order of the picks is irrelevant; it is a SET comparison
    expect(layoutFor([...ids].reverse(), cfg, scanned).layout).toEqual(scanned);
  });

  it('generates as soon as the set differs, by one added or one removed', () => {
    expect(layoutFor([...ids, 'quote'], cfg, scanned).scannedKept).toBe(false);
    expect(layoutFor(ids.slice(1), cfg, scanned).scannedKept).toBe(false);
  });

  it('is a comparison, not a latch: unticking and re-ticking restores the board', () => {
    expect(layoutFor(ids.slice(1), cfg, scanned).scannedKept).toBe(false);
    expect(layoutFor(ids, cfg, scanned).layout).toEqual(scanned);
  });

  it('generates from scratch when there was no scan', () => {
    const res = layoutFor(ids, cfg, null);
    expect(res.scannedKept).toBe(false);
    expect(res.layout).not.toEqual(scanned);
    // Not 96 cells: with the stock three tickers, Markets is capped at 4 columns
    // by MAX_SIZE and at 3 rows by contentMaxH, so it can occupy at most 12 of
    // them and this three-card pick has nothing to hand the rest to. Filling that
    // corner would mean dead air inside the Markets card, which is the thing
    // contentMaxH exists to prevent.
    expect(cells(res.layout)).toBeGreaterThan(0.8 * GRID.cols * GRID.rows);
  });

  it('never lets a scanned board be re-flowed by a list edit', () => {
    // Same ids, a config with twelve tickers instead of three: the generator
    // would give Markets a much taller card, and it must not.
    const rich = normalizeConfig({
      ...structuredClone(DEFAULT_CONFIG),
      markets: { symbols: ['^DJI', '^IXIC', '^GSPC', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'BRK-B', 'JPM'] },
    });
    expect(layoutFor(ids, rich, scanned).layout).toEqual(scanned);
    expect(layoutFor(ids, rich, null).layout.find((r) => r.id === 'markets').h).toBeGreaterThan(4);
  });
});
