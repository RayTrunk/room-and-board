/**
 * @vitest-environment happy-dom
 */
// The ordered ticker list: the fold arithmetic, the markup both surfaces
// render, and the drag controller's reducer wiring. Overflow is NOT testable
// here — happy-dom has no layout engine — so the pane's height budget is
// proved in a real browser against site/_settings-audit.html (see the
// widget-resize-fit policy).
import { describe, it, expect, vi } from 'vitest';
import { foldCounts, foldHeadHtml, tickerRowsHtml, rowLabels, attachReorder } from '../site/js/settings/reorder.js';
import { foldAt, marketsRect, moveWidget, TICKER_MAX } from '../site/js/settings/pickers.js';
import { DEFAULT_CONFIG, normalizeConfig } from '../site/js/config.js';

const syms = (n) => ['^DJI', '^IXIC', '^GSPC', 'AAPL', 'MSFT', 'NVDA', 'CSCO', 'TSLA', 'AMZN', 'CBG.L',
  'SAP.DE', '7203.T', 'GOOGL', 'META', 'NFLX', 'AMD', 'INTC', 'ORCL', 'CRM', 'ADBE'].slice(0, n);

const cfgWith = (n, rect = { w: 4, h: 4 }) => normalizeConfig({
  ...structuredClone(DEFAULT_CONFIG),
  markets: { symbols: syms(n) },
  layout: [{ id: 'markets', x: 0, y: 0, ...rect }],
});

describe('foldAt — the settings list reads the card\'s real capacity', () => {
  it('takes the number from the layout rect, not a constant', () => {
    expect(foldAt(cfgWith(12, { w: 4, h: 4 }))).toBe(5); // the board, resized
    expect(foldAt(cfgWith(12, { w: 3, h: 3 }))).toBe(3); // /setup's DEFAULT_LAYOUT card
    expect(foldAt(cfgWith(12, { w: 4, h: 8 }))).toBe(11);
  });

  it('draws no line when there is nothing to say', () => {
    expect(foldAt(cfgWith(1))).toBe(null); // "on the card now · 1" over a list of one is noise
    expect(foldAt(cfgWith(2))).toBe(null); // 4x4 holds 5 — both are on the card
    expect(foldAt(cfgWith(5))).toBe(null); // capacity === length, still no line
    expect(foldAt(cfgWith(6))).toBe(5); // one falls behind the tap; now there is
  });

  it('is null when the Markets card is not on the board at all', () => {
    const cfg = normalizeConfig({ markets: { symbols: syms(12) }, layout: [{ id: 'weather', x: 0, y: 0, w: 3, h: 3 }] });
    expect(marketsRect(cfg)).toBe(null);
    expect(foldAt(cfg)).toBe(null);
  });

  it('survives a config with no markets key or no layout', () => {
    expect(foldAt({})).toBe(null);
    expect(foldAt(undefined)).toBe(null);
    expect(foldAt({ markets: { symbols: syms(12) } })).toBe(null);
  });
});

describe('fold arithmetic', () => {
  it('splits the list at the capacity', () => {
    expect(foldCounts(5, 12)).toEqual({ on: 5, behind: 7 });
    expect(foldCounts(3, 12)).toEqual({ on: 3, behind: 9 });
    expect(foldCounts(5, 20)).toEqual({ on: 5, behind: 15 });
    expect(foldCounts(11, 20)).toEqual({ on: 11, behind: 9 });
  });
  it('returns null wherever the rule says draw nothing', () => {
    expect(foldCounts(null, 12)).toBe(null);
    expect(foldCounts(5, 5)).toBe(null); // capacity === length
    expect(foldCounts(5, 3)).toBe(null); // capacity > length
  });
  it('the two counts always add up to the whole list', () => {
    for (const total of [2, 6, 12, 20]) {
      for (const cap of [1, 3, 5, 11]) {
        const f = foldCounts(cap, total);
        if (f) expect(f.on + f.behind).toBe(total);
      }
    }
  });
});

describe('the rendered list', () => {
  const rows = (html) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host;
  };

  it('gives every row a handle, a position, a label and a remove', () => {
    const host = rows(tickerRowsHtml(syms(12), { cap: 5 }));
    expect(host.querySelectorAll('.tk-row:not(.tk-slot)').length).toBe(12);
    expect(host.querySelectorAll('[data-reorder]').length).toBe(12);
    expect(host.querySelectorAll('[data-remove-sym]').length).toBe(12);
    expect([...host.querySelectorAll('.tk-pos')].map((e) => e.textContent))
      .toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
    for (const b of host.querySelectorAll('[data-reorder],[data-remove-sym]')) {
      expect(b.getAttribute('aria-label')).toMatch(/\w/);
    }
  });

  it('cuts the fold band in after the capacity, and demotes what follows', () => {
    const host = rows(tickerRowsHtml(syms(12), { cap: 5 }));
    const kids = [...host.children];
    expect(kids.findIndex((k) => k.classList.contains('tk-fold'))).toBe(5); // after row 5
    expect(host.querySelector('.tk-fold__label').textContent).toBe('Behind a tap · 7');
    expect(host.querySelectorAll('.tk-row--below').length).toBe(7);
    expect(foldHeadHtml(5, 12)).toContain('On the card now · 5');
  });

  it('renders no band at all when the whole list reaches the card', () => {
    const host = rows(tickerRowsHtml(syms(3), { cap: 5 }));
    expect(host.querySelector('.tk-fold')).toBe(null);
    expect(host.querySelectorAll('.tk-row--below').length).toBe(0);
    expect(foldHeadHtml(null, 3)).toBe('');
  });

  // A handle that cannot reorder anything is a lie, so a one-item list has
  // none — but it keeps its ✕, and the pane keeps the hint.
  it('drops the handle (only) at one ticker', () => {
    const host = rows(tickerRowsHtml(syms(1), { cap: null }));
    expect(host.querySelectorAll('.tk-row').length).toBe(1);
    expect(host.querySelector('[data-reorder]')).toBe(null);
    expect(host.querySelector('[data-remove-sym]')).not.toBe(null);
    expect(host.querySelector('.tk-fold')).toBe(null);
  });

  it('brings the handles back at two, still with no band on a 4x4 card', () => {
    const host = rows(tickerRowsHtml(syms(2), { cap: foldAt(cfgWith(2)) }));
    expect(host.querySelectorAll('[data-reorder]').length).toBe(2);
    expect(host.querySelector('.tk-fold')).toBe(null);
  });

  it('renders the whole 20-ticker cap, band included', () => {
    const cfg = cfgWith(TICKER_MAX);
    const host = rows(tickerRowsHtml(cfg.markets.symbols, { cap: foldAt(cfg) }));
    expect(host.querySelectorAll('.tk-row').length).toBe(TICKER_MAX);
    expect(host.querySelectorAll('[data-reorder]').length).toBe(TICKER_MAX);
    expect(host.querySelector('.tk-fold__label').textContent).toBe('Behind a tap · 15');
  });

  it('renders nothing for an empty list', () => {
    expect(tickerRowsHtml([], { cap: null })).toBe('');
  });

  // Same idiom as the expand wall's tile(): an index leads with its friendly
  // name, a stock leads with its symbol. No invented badge, and the settings
  // list still reads as one flat list in config order — grouping it would
  // match the wall and LIE about the card.
  it('labels indexes and stocks the way the wall does', () => {
    expect(rowLabels('^DJI')).toEqual({ lead: 'Dow Jones', sub: '^DJI' });
    expect(rowLabels('AAPL', { AAPL: 'Apple' })).toEqual({ lead: 'AAPL', sub: 'Apple' });
    expect(rowLabels('AAPL')).toEqual({ lead: 'AAPL', sub: '' }); // no cached name yet
    expect(rowLabels('^STOXX50E')).toEqual({ lead: '^STOXX50E', sub: '' }); // unknown index
  });

  it('escapes what it interpolates', () => {
    const host = rows(tickerRowsHtml(['AAPL'], { cap: null, names: { AAPL: '<img src=x onerror=1>' } }));
    expect(host.querySelector('img')).toBe(null);
  });
});

/* ---- the drag: gesture plumbing, on top of the shipped moveWidget reducer ---- */

// happy-dom has no pointer-event constructor with pointerId, so synthesize.
function pointer(type, { id = 1, y = 0 } = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { pointerId: id, clientX: 20, clientY: y });
  return e;
}

function mount(symbols, cap = null) {
  document.body.innerHTML = `<div class="tk-list">${tickerRowsHtml(symbols, { cap })}</div>`;
  const list = document.querySelector('.tk-list');
  let order = [...symbols];
  const commit = vi.fn((next) => { order = next; });
  attachReorder(list, { order: () => order, cap, commit, scroller: list });
  return { list, commit, order: () => order };
}

describe('drag wiring', () => {
  it('starts only from the handle, never the row body', () => {
    const { list, commit } = mount(syms(4));
    const row = list.querySelector('[data-sym="AAPL"]');
    row.querySelector('.tk-txt').dispatchEvent(pointer('pointerdown', { y: 100 }));
    window.dispatchEvent(pointer('pointermove', { y: 300 }));
    window.dispatchEvent(pointer('pointerup', { y: 300 }));
    expect(commit).not.toHaveBeenCalled();
    expect(list.querySelector('.tk-slot')).toBe(null);
  });

  // Press-not-drag: a tap on the handle must not reorder anything.
  it('ignores a press that never moves', () => {
    const { list, commit } = mount(syms(4));
    list.querySelector('[data-sym="AAPL"] [data-reorder]').dispatchEvent(pointer('pointerdown', { y: 100 }));
    window.dispatchEvent(pointer('pointermove', { y: 102 })); // under the 6px threshold
    window.dispatchEvent(pointer('pointerup', { y: 102 }));
    expect(commit).not.toHaveBeenCalled();
  });

  it('lifts the row and opens a placeholder once the finger travels', () => {
    const { list } = mount(syms(4));
    list.querySelector('[data-sym="AAPL"] [data-reorder]').dispatchEvent(pointer('pointerdown', { y: 100 }));
    window.dispatchEvent(pointer('pointermove', { y: 160 }));
    expect(list.querySelector('.tk-slot')).not.toBe(null);
    expect(list.querySelector('[data-sym="AAPL"]').classList.contains('tk-row--drag')).toBe(true);
    expect(list.classList.contains('is-reordering')).toBe(true);
    window.dispatchEvent(pointer('pointerup', { y: 160 }));
    expect(list.querySelector('.tk-slot')).toBe(null); // cleaned up on drop
    expect(list.querySelector('[data-sym="AAPL"]').classList.contains('tk-row--drag')).toBe(false);
  });

  // The palm/second-finger guard the edit-mode block drag also carries: a
  // pointerup with a different pointerId must not commit an order the user
  // never chose.
  it('only the initiating pointer drives the gesture', () => {
    const { list, commit } = mount(syms(4));
    list.querySelector('[data-sym="AAPL"] [data-reorder]').dispatchEvent(pointer('pointerdown', { id: 1, y: 100 }));
    window.dispatchEvent(pointer('pointermove', { id: 1, y: 160 }));
    window.dispatchEvent(pointer('pointermove', { id: 2, y: 900 })); // a palm
    window.dispatchEvent(pointer('pointerup', { id: 2, y: 900 }));
    expect(commit).not.toHaveBeenCalled();
    expect(list.querySelector('.tk-slot')).not.toBe(null); // still dragging
    window.dispatchEvent(pointer('pointerup', { id: 1, y: 160 }));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('pointercancel aborts without changing the order', () => {
    const { list, commit, order } = mount(syms(4));
    list.querySelector('[data-sym="AAPL"] [data-reorder]').dispatchEvent(pointer('pointerdown', { y: 100 }));
    window.dispatchEvent(pointer('pointermove', { y: 160 }));
    window.dispatchEvent(pointer('pointercancel', { y: 160 }));
    expect(list.querySelector('.tk-slot')).toBe(null);
    expect(commit).toHaveBeenCalledTimes(1); // re-render only
    expect(order()).toEqual(syms(4)); // ...with the list it started with
    window.dispatchEvent(pointer('pointerup', { y: 160 })); // the stray up that follows
    expect(commit).toHaveBeenCalledTimes(1);
  });

  // The handle is a real button, so it takes focus; ↑/↓ run the same reducer
  // the drop does.
  it('the handle moves by one on ArrowUp / ArrowDown', () => {
    const { list, commit } = mount(syms(4));
    const handle = list.querySelector('[data-sym="AAPL"] [data-reorder]');
    const key = (k) => {
      const e = new Event('keydown', { bubbles: true, cancelable: true });
      e.key = k;
      handle.dispatchEvent(e);
    };
    key('ArrowUp');
    expect(commit.mock.calls[0][0]).toEqual(['^DJI', '^IXIC', 'AAPL', '^GSPC']);
    key('ArrowDown'); // reads the order the first move committed
    expect(commit.mock.calls[1][0]).toEqual(['^DJI', '^IXIC', '^GSPC', 'AAPL']);
    key('Escape');
    expect(commit).toHaveBeenCalledTimes(2);
  });

  // The drag's commit is moveWidget(list, symbol, drop − pickup), which is the
  // reducer already unit-tested above this file. Its boundaries are the drag's
  // boundaries.
  it('rests on moveWidget, whose boundaries hold at 1 and at the 20 cap', () => {
    expect(moveWidget(['AAPL'], 'AAPL', -1)).toEqual(['AAPL']);
    expect(moveWidget(['AAPL'], 'AAPL', +1)).toEqual(['AAPL']);
    const full = syms(TICKER_MAX);
    expect(moveWidget(full, 'ADBE', -(TICKER_MAX - 1))[0]).toBe('ADBE'); // bottom to top
    expect(moveWidget(full, '^DJI', TICKER_MAX - 1).at(-1)).toBe('^DJI'); // top to bottom
    expect(moveWidget(full, 'ADBE', +1)).toBe(full); // off the end: same array, by identity
  });
});
