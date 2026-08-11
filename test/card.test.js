/**
 * @vitest-environment happy-dom
 *
 * The card itself: the article the board mounts for a widget, the geometry
 * hooks it wears, and its freshness marks. This lives in one module now, so
 * for the first time it can be pinned directly rather than inferred from
 * whichever renderer happened to be under test.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildCard, applyCardRect, cardFor, stampOf, markFresh, markStale, setCardConfigSource,
} from '../site/js/card.js';
import { fmtClock } from '../site/js/util.js';

const mod = { meta: { id: 'markets', title: 'Markets' } };
const STAMP_EPOCH = 1783000500;

beforeEach(() => {
  document.body.innerHTML = '<div id="grid"></div>';
});
afterEach(() => {
  setCardConfigSource(null); // back to the default: no board config
});

describe('buildCard', () => {
  it('is an article wearing the widget id, its title, an empty body and a hidden stamp', () => {
    const card = buildCard(mod);
    expect(card.tagName).toBe('ARTICLE');
    expect(card.className).toBe('card card--markets');
    expect(card.dataset.widget).toBe('markets');
    expect(card.querySelector('.card__title').textContent).toBe('Markets');
    expect(card.querySelector('.card__body').textContent).toBe('');
    expect(stampOf(card).hidden).toBe(true);
  });

  it('mounts nothing by itself: the caller decides where the card goes', () => {
    buildCard(mod);
    expect(document.querySelector('.card')).toBeNull();
  });
});

describe('applyCardRect', () => {
  it('places the card on the 1-based grid the rect describes', () => {
    const card = applyCardRect(buildCard(mod), { x: 2, y: 5, w: 4, h: 3 });
    expect(card.style.gridColumn).toBe('3 / span 4');
    expect(card.style.gridRow).toBe('6 / span 3');
    expect(card.dataset.w).toBe('4');
    expect(card.dataset.h).toBe('3');
  });

  it('derives the height tier: t-s to 2, t-m to 4, t-l above', () => {
    const tier = (h) => [...applyCardRect(buildCard(mod), { w: 6, h }).classList]
      .find((c) => c.startsWith('t-') && c !== 't-narrow');
    expect([1, 2, 3, 4, 5, 8].map(tier)).toEqual(['t-s', 't-s', 't-m', 't-m', 't-l', 't-l']);
  });

  it('calls 4 columns and under narrow, and nothing wider', () => {
    const narrow = (w) => applyCardRect(buildCard(mod), { w, h: 4 }).classList.contains('t-narrow');
    expect([2, 3, 4, 5, 12].map(narrow)).toEqual([true, true, true, false, false]);
  });

  it('REPLACES the tiers on a resize rather than stacking a second one', () => {
    const card = applyCardRect(buildCard(mod), { w: 3, h: 2 });
    expect(card.classList.contains('t-s')).toBe(true);
    applyCardRect(card, { w: 8, h: 6 });
    expect([...card.classList]).toEqual(['card', 'card--markets', 't-l']);
  });

  it('takes width and height alone, for a caller that only cares about size', () => {
    const card = applyCardRect(buildCard(mod), { w: 3, h: 2 });
    expect(card.style.gridColumn).toBe('1 / span 3');
    expect(card.style.gridRow).toBe('1 / span 2');
  });

  it('leaves an unplaced card alone when there is no rect', () => {
    const card = applyCardRect(buildCard(mod), null);
    expect(card.dataset.w).toBeUndefined();
    expect(card.className).toBe('card card--markets');
  });
});

describe('cardFor', () => {
  it('appends one card to the grid and hands the SAME one back next time', () => {
    const first = cardFor(mod, { x: 0, y: 0, w: 3, h: 2 });
    expect(document.querySelector('#grid').children).toHaveLength(1);
    const again = cardFor(mod, { x: 0, y: 0, w: 3, h: 2 });
    expect(again).toBe(first);
    expect(document.querySelector('#grid').children).toHaveLength(1);
  });

  it('re-places the card it already has, tiers and all', () => {
    const card = cardFor(mod, { x: 0, y: 0, w: 3, h: 2 });
    expect(card.classList.contains('t-s')).toBe(true);
    cardFor(mod, { x: 4, y: 1, w: 6, h: 5 });
    expect(card.style.gridColumn).toBe('5 / span 6');
    expect(card.classList.contains('t-l')).toBe(true);
    expect(card.classList.contains('t-s')).toBe(false);
  });
});

describe('freshness marks', () => {
  it('stamps the cache age and dims the card, then clears both', () => {
    const card = cardFor(mod, { x: 0, y: 0, w: 3, h: 2 });
    markStale(card, STAMP_EPOCH);
    expect(card.classList.contains('is-stale')).toBe(true);
    expect(stampOf(card).hidden).toBe(false);
    // Derived through the shared formatter, not a literal: CI runs UTC.
    expect(stampOf(card).textContent).toBe(`as of ${fmtClock(STAMP_EPOCH)}`);
    markFresh(card);
    expect(card.classList.contains('is-stale')).toBe(false);
    expect(stampOf(card).hidden).toBe(true);
  });

  it('dims a card with no cached timestamp without stamping an empty time', () => {
    const card = cardFor(mod, { x: 0, y: 0, w: 3, h: 2 });
    markStale(card, null);
    expect(card.classList.contains('is-stale')).toBe(true);
    expect(stampOf(card).hidden).toBe(true);
    expect(stampOf(card).textContent).toBe('');
  });

  it('reads clock24 off the board config LIVE, so a save is honored', () => {
    let cfg = { clock24: false };
    setCardConfigSource(() => cfg);
    const card = cardFor(mod, { x: 0, y: 0, w: 3, h: 2 });
    markStale(card, STAMP_EPOCH);
    expect(stampOf(card).textContent).toBe(`as of ${fmtClock(STAMP_EPOCH, false)}`);
    cfg = { clock24: true }; // the shape of a settings save: a NEW object
    markStale(card, STAMP_EPOCH);
    expect(stampOf(card).textContent).toBe(`as of ${fmtClock(STAMP_EPOCH, true)}`);
  });
});
