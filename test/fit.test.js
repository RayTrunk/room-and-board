/**
 * @vitest-environment happy-dom
 */
// The fit: one question, how many rows fit.
//
// Nineteen renderers used to ask it themselves, in six dialects of the same
// clamp and two copies of the same measured walk. This file is where the walk
// is driven directly, so the per-widget tests can go back to being about
// widgets. happy-dom for the corner-count half (a real card, the real badge);
// the measured half runs on a fake body, because happy-dom has no layout engine
// and the loops read exactly two numbers.
import { describe, it, expect } from 'vitest';
import { fitList, itemCapacity } from '../site/js/capacity.js';
import { mountCard } from './helpers/board.js';
import * as subway from '../site/js/widgets/subway.js';
import * as f1 from '../site/js/widgets/f1.js';

// A body whose height is DERIVED from what was last drawn into it: n rows at
// rowPx, with the squeezed row costing squeezedPx instead. That is the same
// harness sports-news.test.js and renderers.test.js drive their own copies of
// the loop with, reduced to the two numbers the fit actually reads.
function measurable({ clientHeight = 0, rowPx = 10, squeezedPx = 4, size = [4, 4] } = {}) {
  const el = {
    n: 0,
    squeezed: false,
    calls: [],
    closest: () => (size ? { dataset: { w: String(size[0]), h: String(size[1]) } } : null),
    clientHeight,
    get scrollHeight() {
      return this.squeezed ? (this.n - 1) * rowPx + squeezedPx : this.n * rowPx;
    },
  };
  el.draw = (n, squeezed = false) => {
    el.n = n;
    el.squeezed = squeezed;
    el.calls.push([n, squeezed]);
  };
  return el;
}
// Every call site's draw is "render n items"; the harness records it.
const drawInto = (el) => (n, squeezed) => el.draw(n, squeezed);

describe('the estimate, which is the whole answer without a rendered box', () => {
  it('draws the capacity model of the card it is standing on', () => {
    const el = measurable({ size: [4, 4] });
    const shown = fitList(el, { id: 'news', items: Array(30).fill(0), draw: drawInto(el) });
    expect(itemCapacity('news', 4, 4)).toBe(4); // the table, restated so this reads
    expect(shown).toBe(4);
    expect(el.n).toBe(4);
    expect(el.calls).toHaveLength(1); // no measuring, so exactly one draw
  });

  it('never promises more rows than there are items', () => {
    const el = measurable({ size: [4, 4] });
    expect(fitList(el, { id: 'news', items: [1, 2], draw: drawInto(el) })).toBe(2);
  });

  it('falls back to the size a bare div is given when there is no card', () => {
    const el = measurable({ size: null }); // closest() finds nothing, as in a test scaffold
    const shown = fitList(el, {
      id: 'history', items: Array(9).fill(0), defaultSize: [6, 2], draw: drawInto(el),
    });
    expect(shown).toBe(itemCapacity('history', 6, 2));
    expect(shown).toBe(2);
  });
});

// The six dialects the call sites used to write by hand, now arguments. Each
// case is named for the widgets that wrote it.
describe('the clamps, one per idiom', () => {
  const unknown = 'no-model-for-this-id';

  it('min: Math.max(1, ...) still draws a row when the model knows nothing (rail)', () => {
    const el = measurable();
    expect(fitList(el, { id: unknown, min: 1, draw: drawInto(el) })).toBe(1);
  });

  it('fallback: ?? 4 and ?? 5 are what the model-less card draws (ferry, services)', () => {
    const el = measurable();
    expect(fitList(el, { id: unknown, fallback: 4, draw: drawInto(el) })).toBe(4);
    expect(fitList(el, { id: unknown, fallback: 5, draw: drawInto(el) })).toBe(5);
  });

  it('bare: no model and no fallback draws nothing, exactly as slice(0, null) did', () => {
    // Unreachable for the seven widgets that wrote it bare (every one of their
    // ids has a model), and pinned here so it stays the same nothing if it ever
    // is reached.
    const el = measurable();
    expect(fitList(el, { id: unknown, items: [1, 2, 3], draw: drawInto(el) })).toBe(0);
    expect(el.n).toBe(0);
  });

  it('reserve: PATH pays for its section labels before it counts rows', () => {
    const el = measurable();
    // The compound this replaced: max(showBoth ? 2 : 1, (cap ?? 4) - (showBoth ? 1 : 0)).
    expect(fitList(el, { id: 'no-model', fallback: 4, reserve: 1, min: 2, draw: drawInto(el) })).toBe(3);
    // ...and the floor wins when the reserve would eat the card.
    expect(fitList(el, { id: 'no-model', fallback: 2, reserve: 1, min: 2, draw: drawInto(el) })).toBe(2);
  });

  it('the model is still clamped by the list, whatever the idiom', () => {
    const el = measurable();
    expect(fitList(el, { id: 'no-model', fallback: 9, items: [1, 2, 3], min: 1, draw: drawInto(el) })).toBe(3);
  });
});

describe('the measured walk', () => {
  it('sheds rows until the drawn box fits (subway, services, the news family)', () => {
    const el = measurable({ clientHeight: 25, rowPx: 10, size: [4, 4] });
    // The estimate is 4 rows of 10px against a 25px box: two of them fit.
    const shown = fitList(el, {
      id: 'news', items: Array(30).fill(0), measure: true, draw: drawInto(el),
    });
    expect(shown).toBe(2);
    expect(el.scrollHeight).toBeLessThanOrEqual(el.clientHeight);
  });

  it('sheds down to the last row and no further', () => {
    const el = measurable({ clientHeight: 3, rowPx: 10, size: [4, 4] });
    expect(fitList(el, { id: 'news', items: Array(30).fill(0), measure: true, draw: drawInto(el) })).toBe(1);
  });

  it('stops at the floor the widget set instead (F1 draws one a side, never less)', () => {
    const el = measurable({ clientHeight: 3, rowPx: 10 });
    expect(fitList(el, {
      id: 'no-model', fallback: 16, min: 2, measure: true, draw: drawInto(el),
    })).toBe(2);
  });

  it('never measures a box the browser has not laid out', () => {
    // clientHeight 0 is happy-dom, and a card mid-mount: the estimate stands
    // even though the fake would happily report an overflow.
    const el = measurable({ clientHeight: 0, rowPx: 1000, size: [4, 4] });
    expect(fitList(el, { id: 'news', items: Array(30).fill(0), measure: true, draw: drawInto(el) })).toBe(4);
  });

  it('grows back into a card with room to spare, when told to fill it', () => {
    // squeezedPx 9 leaves no room for the squeezed row (69 > 65), so this case
    // is the grow loop alone.
    const el = measurable({ clientHeight: 65, rowPx: 10, squeezedPx: 9, size: [4, 4] });
    // Estimate 4, and six rows of 10px fit the 65px box; a seventh (70) does not.
    const shown = fitList(el, {
      id: 'news', items: Array(30).fill(0), measure: true, squeeze: true, draw: drawInto(el),
    });
    expect(shown).toBe(6);
  });

  it('spends the last of the slack on one row drawn short', () => {
    const el = measurable({ clientHeight: 64, rowPx: 10, squeezedPx: 4, size: [4, 4] });
    // Six full rows (60) fit and a seventh (70) does not, but six plus a
    // squeezed one (54 + 4 = 64) lands exactly on the floor.
    const shown = fitList(el, {
      id: 'news', items: Array(30).fill(0), measure: true, squeeze: true, draw: drawInto(el),
    });
    expect(shown).toBe(7);
    expect(el.squeezed).toBe(true);
  });

  it('takes the squeezed row back when even short it does not fit', () => {
    const el = measurable({ clientHeight: 62, rowPx: 10, squeezedPx: 9, size: [4, 4] });
    const shown = fitList(el, {
      id: 'news', items: Array(30).fill(0), measure: true, squeeze: true, draw: drawInto(el),
    });
    expect(shown).toBe(6);
    expect(el.squeezed).toBe(false); // and the card is left drawn full, not squeezed
  });

  it('never squeezes past the end of the list', () => {
    const el = measurable({ clientHeight: 500, rowPx: 10, size: [4, 4] });
    const shown = fitList(el, {
      id: 'news', items: [1, 2, 3], measure: true, squeeze: true, draw: drawInto(el),
    });
    expect(shown).toBe(3);
    expect(el.squeezed).toBe(false);
  });

  it('shrinks WITHOUT growing for the two callers that must not grow (subway, F1)', () => {
    // The room is there; the count stays at the estimate, because the rows past
    // it are the ones subway's priority order already ruled out.
    const el = measurable({ clientHeight: 500, rowPx: 10, size: [4, 4] });
    const shown = fitList(el, {
      id: 'subway', items: Array(30).fill(0), measure: true, draw: drawInto(el),
    });
    expect(shown).toBe(itemCapacity('subway', 4, 4));
    expect(shown).toBe(6);
  });

  it('tolerates exactly the slack it is given (F1 ships with one pixel)', () => {
    const overBy1 = () => measurable({ clientHeight: 39, rowPx: 10, size: [4, 4] });
    const tolerant = overBy1();
    expect(fitList(tolerant, {
      id: 'news', items: Array(30).fill(0), measure: true, slack: 1, draw: drawInto(tolerant),
    })).toBe(4);
    const strict = overBy1();
    expect(fitList(strict, {
      id: 'news', items: Array(30).fill(0), measure: true, draw: drawInto(strict),
    })).toBe(3);
  });
});

describe('the corner count', () => {
  // A real card, because the badge is a real element the fit hangs off the
  // .closest('.card') walk.
  const card = (w, h) => mountCard({ id: 'news', title: 'Headlines' }, { w, h });
  const bodyOf = (c) => c.querySelector('.card__body');
  const rows = (body) => (n) => { body.innerHTML = '<div class="r"></div>'.repeat(n); };
  const badge = (c) => c.querySelector('.card__more')?.textContent ?? null;

  it('stamps what the fit left out', () => {
    const c = card(4, 4);
    const body = bodyOf(c);
    fitList(body, { id: 'news', items: Array(9).fill(0), badge: true, draw: rows(body) });
    expect(body.querySelectorAll('.r')).toHaveLength(4);
    expect(badge(c)).toBe('+5');
    c.remove();
  });

  it('leaves the corner empty when the card shows everything', () => {
    const c = card(4, 4);
    const body = bodyOf(c);
    fitList(body, { id: 'news', items: [1, 2], badge: true, draw: rows(body) });
    expect(badge(c)).toBeNull();
    c.remove();
  });

  it('counts what the MEASURED walk shed, not what the estimate promised', () => {
    const c = card(4, 4);
    const body = bodyOf(c);
    Object.defineProperty(body, 'clientHeight', { configurable: true, get: () => 25 });
    Object.defineProperty(body, 'scrollHeight', {
      configurable: true, get: () => body.querySelectorAll('.r').length * 10,
    });
    const shown = fitList(body, {
      id: 'news', items: Array(9).fill(0), measure: true, badge: true, draw: rows(body),
    });
    expect(shown).toBe(2);
    expect(badge(c)).toBe('+7'); // not the +5 the estimate would have stamped
    c.remove();
  });

  it('never touches the corner unless it is asked to', () => {
    // The three families whose count is not items-minus-shown: the rail boards
    // count after their own fit, the news family caps at what its reading list
    // seats, and bus counts stops while it fits rows.
    const c = card(4, 4);
    const body = bodyOf(c);
    fitList(body, { id: 'news', items: Array(9).fill(0), draw: rows(body) });
    expect(badge(c)).toBeNull();
    c.remove();
  });

  it('has nothing to count when no list was handed over', () => {
    const c = card(4, 4);
    const body = bodyOf(c);
    fitList(body, { id: 'no-model', fallback: 3, badge: true, draw: rows(body) });
    expect(badge(c)).toBeNull();
    c.remove();
  });
});

// ---------------------------------------------------------------------------
// The two card loops that had no test of their own before the fit became one
// operation. Both are shrink-only, and both are shrink-only for a reason worth
// pinning: they are the cases where growing would be wrong.
// ---------------------------------------------------------------------------

// happy-dom has no layout, so the two numbers the walk reads are derived from
// the markup actually rendered, the same way the services tests do it.
function measured(body, clientHeight, height) {
  Object.defineProperty(body, 'clientHeight', { configurable: true, get: () => clientHeight });
  Object.defineProperty(body, 'scrollHeight', { configurable: true, get: () => height(body) });
}

describe('subway sheds to the corner count', () => {
  const line = (id, ok) => ({ line: id, ok, headers: ok ? [] : [`${id} trains are delayed`] });
  const mount = () => {
    const card = mountCard(subway, { w: 4, h: 4 });
    const body = card.querySelector('.card__body');
    measured(body, 25, (el) => el.querySelectorAll('.linestatus').length * 10);
    return { card, body };
  };
  const shown = (body) => [...body.querySelectorAll('.bullet')].map((b) => b.textContent);

  it('drops the rows the alert wrapping cost, and counts them in the corner', () => {
    const { card, body } = mount();
    subway.render(body, { lines: ['1', '2', '3', '4', '5'].map((id) => line(id, true)) }, {});
    // The estimate seats all five (capacity is 6 at 4x4); the box holds two.
    expect(shown(body)).toEqual(['1', '2']);
    expect(card.querySelector('.card__more').textContent).toBe('+3');
    card.remove();
  });

  it('keeps line order when the ESTIMATE seated everything, even if measuring does not', () => {
    // Deliberate, and the reason this card never grows: the priority sort is a
    // truncation rule, and a card whose estimate fits every line was never
    // truncated. A shed row comes off the bottom rather than re-ranking the
    // board as it shrinks.
    const { card, body } = mount();
    subway.render(body, { lines: [line('1', true), line('2', true), line('F', false)] }, {});
    expect(shown(body)).toEqual(['1', '2']);
    card.remove();
  });

  it('floats the alerting line when the estimate itself truncates', () => {
    const { card, body } = mount();
    const lines = ['1', '2', '3', '4', '5', '6', '7'].map((id) => line(id, true));
    lines.push(line('F', false));
    subway.render(body, { lines }, {});
    expect(shown(body)[0]).toBe('F'); // survived the slice and then the shed
    expect(card.querySelector('.card__more').textContent).toBe('+6');
    card.remove();
  });
});

describe('F1 shrinks its two standings columns together', () => {
  const drivers = Array.from({ length: 10 }, (_, i) => ({ pos: i + 1, cid: 'ferrari', nat: 'Italian', name: `D${i}`, pts: 100 - i }));
  const teams = Array.from({ length: 10 }, (_, i) => ({ pos: i + 1, cid: 'mclaren', name: `T${i}`, pts: 200 - i }));
  const cols = (body) => [...body.querySelectorAll('.f1-col')].map((c) => c.querySelectorAll('.f1-row').length);
  const mount = (clientHeight) => {
    const card = mountCard(f1, { w: 3, h: 4 });
    const body = card.querySelector('.card__body');
    // Side by side on the board, so the taller column is what the card must fit.
    measured(body, clientHeight, (el) => Math.max(0, ...cols(el)) * 10);
    return { card, body };
  };

  it('deals eight a side wherever there is nothing to measure', () => {
    const card = mountCard(f1, { w: 3, h: 4 });
    const body = card.querySelector('.card__body');
    f1.render(body, { drivers, teams }, {});
    expect(cols(body)).toEqual([8, 8]);
    card.remove();
  });

  it('sheds a row from each column in turn until the taller one fits', () => {
    const { card, body } = mount(45);
    f1.render(body, { drivers, teams }, {});
    expect(cols(body)).toEqual([4, 4]);
    card.remove();
  });

  it('gives the odd row to the drivers column', () => {
    const { card, body } = mount(45);
    f1.render(body, { drivers, teams: teams.slice(0, 3) }, {});
    // Constructors run out at three, so only the drivers column can overflow.
    expect(cols(body)[0]).toBe(4);
    card.remove();
  });

  it('tolerates the one pixel of overflow it has always tolerated', () => {
    // 40px of rows in a 39px box is one over, and this card does not shed for
    // one: at zero tolerance the same board loses a driver.
    const { card, body } = mount(39);
    f1.render(body, { drivers, teams }, {});
    expect(cols(body)).toEqual([4, 4]);
    card.remove();
  });
});
