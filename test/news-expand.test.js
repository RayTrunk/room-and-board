/**
 * @vitest-environment happy-dom
 */
// Wave 3 of the +N rollout: the news family's full-screen reading list.
// The five cards that share the newscore renderer (Headlines, Sports News,
// Markets News, Substack, Bluesky) all get the card-level tap by construction,
// so most of what is worth pinning is the SHARED path plus the one thing that
// is genuinely per-card (the title and the hint's noun).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { closeExpand, isExpandOpen, initExpand, setExpandSource, openExpand } from '../site/js/expand.js';
import { closeTextViewer } from '../site/js/textviewer.js';
import {
  renderHeadlines,
  listRows,
  listColumns,
  listCapacity,
  LIST_ROW_H,
  LIST_BODY_H,
  LIST_MAX_COLS,
} from '../site/js/widgets/newscore.js';
import * as news from '../site/js/widgets/news.js';
import * as sportsnews from '../site/js/widgets/sportsnews.js';
import * as marketsnews from '../site/js/widgets/marketsnews.js';
import * as substack from '../site/js/widgets/substack.js';
import * as bsky from '../site/js/widgets/bsky.js';
import { board as mountBoard } from './helpers/board.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CFG = { clock24: false };
const overlay = () => document.querySelector('#expand-view');
const viewer = () => document.querySelector('#text-viewer');

// Feed items with a story behind them (link + desc), which is what makes a row
// tappable in both places.
const items = (n, { withStory = true } = {}) =>
  Array.from({ length: n }, (_, i) => ({
    title: `Story ${i}`,
    t: Date.now() - i * 60000,
    source: 'NYT',
    ...(withStory ? { link: `https://example.com/${i}`, desc: `Summary ${i}` } : {}),
  }));

// A one-card board with the delegated listeners wired in main.js's order:
// expand FIRST, then the text viewer. That order is the whole reason the row
// exception has to exist, so the tests must reproduce it rather than a
// convenient one.
const board = (mod, n, { w = 3, h = 2, withStory = true, vm: vmOverride } = {}) => mountBoard(mod, {
  rect: { w, h },
  vm: vmOverride ?? { nowMs: Date.now(), items: items(n, { withStory }) },
  cfg: CFG,
  textviewer: { truncated: () => true },
});

const FAMILY = [news, sportsnews, marketsnews, substack, bsky];

beforeEach(() => {
  closeExpand();
  closeTextViewer();
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('news family: registration', () => {
  it('gives all five cards a card-level expansion with their own title', () => {
    for (const mod of FAMILY) {
      const { card } = board(mod, 20);
      expect(card.classList.contains('is-expandable'), `${mod.meta.id} is expandable`).toBe(true);
      expect(card.getAttribute('role')).toBe('button');
      card.click();
      expect(isExpandOpen(), `${mod.meta.id} opens`).toBe(true);
      // The overlay wears the card's OWN title, not a shared family label.
      expect(overlay().querySelector('.expand__title').textContent).toBe(mod.meta.title);
      expect(overlay().querySelector('.news-board')).not.toBeNull();
      closeExpand();
    }
  });

  it('expands even when the card hides nothing: one card, one destination', () => {
    // Only the badge tracks overflow. A card showing everything it holds still
    // owes a tap the bigger reading view (the history day-view rule).
    const { card } = board(news, 2, { w: 4, h: 8 });
    expect(card.querySelector('.card__more')).toBeNull(); // nothing hidden
    expect(card.classList.contains('is-expandable')).toBe(true);
    card.click();
    expect(isExpandOpen()).toBe(true);
    expect(overlay().querySelectorAll('.news-board .headline').length).toBe(2);
  });

  it('an emptied card goes inert again, badge and tap together', () => {
    const { card, body } = board(news, 20);
    expect(card.classList.contains('is-expandable')).toBe(true);
    news.render(body, { nowMs: Date.now(), items: [] }, CFG);
    expect(card.classList.contains('is-expandable')).toBe(false);
    expect(card.querySelector('.card__more')).toBeNull();
    card.click();
    expect(isExpandOpen()).toBe(false);
  });

  it('carries the card stale stamp into the overlay', () => {
    const { card } = board(news, 20);
    const stamp = card.querySelector('.card__stamp');
    stamp.hidden = false;
    stamp.textContent = 'as of 9:55 AM';
    card.click();
    expect(overlay().querySelector('.expand__stamp').textContent).toBe('as of 9:55 AM');
    expect(overlay().classList.contains('is-stale')).toBe(true);
  });
});

describe('news family: the row exception', () => {
  it('a headline tap on the CARD opens its story, never the reading list', () => {
    const { card } = board(news, 20);
    const row = card.querySelector('.headline');
    row.click();
    // The story view opened and the list did NOT: one tap, one destination.
    expect(viewer().hidden).toBe(false);
    expect(viewer().querySelector('.story__title').textContent).toBe('Story 0');
    expect(isExpandOpen()).toBe(false);
  });

  it('a tap on the headline TEXT is still the row, not the card', () => {
    // closest() walks up, so the exception has to catch descendants too.
    const { card } = board(news, 20);
    card.querySelector('.headline__title').click();
    expect(isExpandOpen()).toBe(false);
    expect(viewer().hidden).toBe(false);
  });

  it('taps outside the rows open the list: title, badge, and the body gaps', () => {
    for (const sel of ['.card__title', '.card__more', '.card__body']) {
      const { card } = board(news, 20);
      card.querySelector(sel).click();
      expect(isExpandOpen(), `${sel} opens the list`).toBe(true);
      expect(viewer()?.hidden ?? true).toBe(true); // and no reader underneath it
      closeExpand();
    }
  });

  it('keyboard Enter on the card opens the list (the row exception spares it)', () => {
    // Dispatched ON the card, so e.target is the card itself: the engine's
    // keydown path clicks it, and the synthesized click must clear the
    // exception (the card is not inside a .headline).
    const { card } = board(news, 20);
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(isExpandOpen()).toBe(true);
    expect(overlay().querySelector('.news-board')).not.toBeNull();
  });

  it('leaves the text viewer DEFER list alone: headline text never defers', () => {
    // The defer guard exists for status/alert copy, which a card-level
    // expansion would show anyway. A headline must NOT join it, or a row tap
    // inside an expandable card would fall through to the card and open the
    // list instead of the story. Pinned as source, since the constant is
    // module-private.
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../site/js/textviewer.js'), 'utf8');
    const defer = /const DEFER_TO_EXPAND = '([^']*)'/.exec(src)?.[1];
    expect(defer).toBe('.linestatus__text, .talert__text');
    expect(defer).not.toContain('headline');
  });
});

describe('news family: the reading list', () => {
  it('renders every item the card holds, newest first, with the card meta order', () => {
    const { card } = board(news, 12, { w: 3, h: 2 });
    const shown = card.querySelectorAll('.card__body .headline').length;
    expect(shown).toBeLessThan(12); // the card is capped; the list is not
    card.click();
    const rows = overlay().querySelectorAll('.news-board .headline');
    expect(rows.length).toBe(12);
    expect(rows[0].querySelector('.headline__title').textContent).toBe('Story 0'); // freshest leads
    expect(rows[11].querySelector('.headline__title').textContent).toBe('Story 11');
    // Source and age sit ABOVE the headline, matching the card's own order.
    const first = rows[0].children;
    expect(first[0].className).toBe('headline__meta');
    expect(first[1].className).toBe('headline__title');
  });

  it('never scrolls: the list is capped to what the overlay body seats', () => {
    const { card } = board(news, 30);
    card.click();
    const rows = overlay().querySelectorAll('.news-board .headline');
    expect(rows.length).toBe(listCapacity(30, 'news')); // 21, not 30
    expect(rows.length).toBeLessThan(30);
  });

  it('the fit is honest: the tallest column cannot outgrow the body', () => {
    const rows = listRows();
    const LIST_ROW_GAP = 19; // 8px padding + 1px hairline + 10px row-gap
    expect(rows * LIST_ROW_H + (rows - 1) * LIST_ROW_GAP).toBeLessThanOrEqual(LIST_BODY_H);
    // and one more row would genuinely not fit
    expect((rows + 1) * LIST_ROW_H + rows * LIST_ROW_GAP).toBeGreaterThan(LIST_BODY_H);
  });

  it('deals one column when few, then two, then the family maximum', () => {
    expect(listColumns(6, 3)).toBe(1);
    expect(listColumns(7, 3)).toBe(2);
    expect(listColumns(12, 3)).toBe(2);
    expect(listColumns(13, 3)).toBe(3);
    // Substack and Bluesky carry longer text and stop at two.
    expect(listColumns(30, LIST_MAX_COLS.substack)).toBe(2);
    expect(listColumns(30, LIST_MAX_COLS.bsky)).toBe(2);
  });

  it('tags the layout and balances the columns', () => {
    const { card } = board(news, 30);
    card.click();
    const list = overlay().querySelector('.news-board');
    expect(list.classList.contains('news-board--c3')).toBe(true);
    expect(list.getAttribute('style')).toContain('--list-rows:7'); // ceil(21/3)
  });

  it('gives Substack and Bluesky the two-column list and their own noun', () => {
    for (const [mod, noun] of [[substack, 'piece'], [bsky, 'post']]) {
      const { card } = board(mod, 30);
      card.click();
      const list = overlay().querySelector('.news-board');
      expect(list.classList.contains('news-board--c2'), `${mod.meta.id} deals two columns`).toBe(true);
      expect(list.querySelectorAll('.headline').length).toBe(listCapacity(30, mod.meta.id)); // 14
      expect(overlay().querySelector('.expand__hint').textContent)
        .toBe(`Tap a ${noun} to read it · Tap anywhere else to close`);
      closeExpand();
    }
  });

  it('says "headline" on the three outlet cards, and uses no dashes anywhere', () => {
    for (const mod of [news, sportsnews, marketsnews]) {
      const { card } = board(mod, 20);
      card.click();
      const hint = overlay().querySelector('.expand__hint').textContent;
      expect(hint).toBe('Tap a headline to read it · Tap anywhere else to close');
      expect(hint).not.toMatch(/[—–]/); // no em/en dashes in user-visible copy
      closeExpand();
    }
  });

  it('drops the separator on the last row of each column only', () => {
    const { card } = board(news, 30); // 21 rows over 3 columns of 7
    card.click();
    const rows = [...overlay().querySelectorAll('.news-board .headline')];
    const tails = rows.map((r, i) => (r.classList.contains('headline--tail') ? i : -1)).filter((i) => i >= 0);
    expect(tails).toEqual([6, 13, 20]); // the foot of each column, nothing else
  });

  it('marks only rows with a story as tappable', () => {
    const { card } = board(news, 8, { withStory: false });
    card.click();
    const rows = overlay().querySelectorAll('.news-board .headline');
    expect(rows.length).toBe(8);
    // Nothing to open, so nothing claims the tap: they close the overlay.
    expect(overlay().querySelectorAll('[data-expand-row]').length).toBe(0);
  });
});

describe('news family: a story tapped INSIDE the list', () => {
  it('opens the story view and leaves the list standing under it', () => {
    const { card } = board(news, 20);
    card.click();
    const row = overlay().querySelector('.news-board .headline[data-expand-row]');
    row.click();
    expect(viewer().hidden).toBe(false);
    expect(viewer().querySelector('.story__title').textContent).toBe('Story 0');
    expect(viewer().querySelector('.story__src').textContent).toBe('NYT');
    // The list is still there to come back to: a stack, not a replacement.
    expect(isExpandOpen()).toBe(true);
  });

  it('carries the row link and summary through to the story view', () => {
    const { card } = board(news, 20);
    card.click();
    const rows = overlay().querySelectorAll('.news-board .headline[data-expand-row]');
    rows[2].click();
    expect(viewer().querySelector('.story__desc').textContent).toBe('Summary 2');
    expect(viewer().querySelector('.story__more-host').textContent).toBe('example.com');
  });

  it('does not double-fire: the text viewer never sees the overlay rows', () => {
    // The overlay lives on document.body, outside #grid, so the text viewer's
    // delegated listener cannot reach it. Only the engine's rowTap runs.
    const { card } = board(news, 20);
    card.click();
    expect(overlay().closest('#grid')).toBeNull();
    const row = overlay().querySelector('[data-expand-row]');
    row.click();
    expect(document.querySelectorAll('#text-viewer').length).toBe(1);
    expect(isExpandOpen()).toBe(true);
  });

  it('a tap on the list background still closes, per the hint', () => {
    const { card } = board(news, 20);
    card.click();
    overlay().querySelector('.news-board').click();
    expect(isExpandOpen()).toBe(false);
  });
});

describe('news family: the +N cap', () => {
  it('never advertises more than the reading list can show', () => {
    // 30 items, a 3x2 card showing 2: uncapped this said "+28", but the list
    // seats 21, so the honest promise is 21 - 2.
    const { card } = board(news, 30);
    const onCard = card.querySelectorAll('.card__body .headline').length;
    const badge = Number(card.querySelector('.card__more').textContent.replace('+', ''));
    expect(badge).toBe(listCapacity(30, 'news') - onCard);
    expect(badge).toBeLessThan(30 - onCard); // strictly tighter than the old count
    // and the badge is exactly what the overlay then delivers
    card.click();
    expect(overlay().querySelectorAll('.news-board .headline').length).toBe(onCard + badge);
  });

  it('caps tighter for the two-column families', () => {
    const { card } = board(bsky, 30);
    const onCard = card.querySelectorAll('.card__body .headline').length;
    const badge = Number(card.querySelector('.card__more').textContent.replace('+', ''));
    expect(badge).toBe(listCapacity(30, 'bsky') - onCard); // 14 seats, not 21
    card.click();
    expect(overlay().querySelectorAll('.news-board .headline').length).toBe(onCard + badge);
  });

  it('leaves the count alone when the list can show everything', () => {
    const { card } = board(news, 12);
    const onCard = card.querySelectorAll('.card__body .headline').length;
    expect(card.querySelector('.card__more').textContent).toBe(`+${12 - onCard}`);
  });

  it('never goes negative', () => {
    // A card that somehow shows more than the list seats must drop the badge,
    // not paint a negative one.
    expect(Math.max(0, Math.min(30 - 25, listCapacity(30, 'bsky') - 25))).toBe(0);
  });
});

describe('expand engine: the except option', () => {
  it('is independent of trigger, and subviews still outrank both', () => {
    document.body.innerHTML = `
      <div id="grid">
        <article class="card" data-w="3" data-h="2">
          <h2 class="card__title">T</h2>
          <div class="card__body"><div class="row">r</div><div class="ban">b</div><div class="other">o</div></div>
        </article>
      </div>
      <div id="settings-root"></div><div id="edit-root"></div>`;
    const grid = document.querySelector('#grid');
    initExpand(grid);
    const card = grid.querySelector('.card');
    setExpandSource(card.querySelector('.card__body'), () => ({ title: 'card', bodyHtml: '<p>card</p>' }), {
      except: '.row',
      subviews: [{ selector: '.ban', build: () => ({ title: 'sub', bodyHtml: '<p>sub</p>' }) }],
    });

    card.querySelector('.row').click();
    expect(isExpandOpen()).toBe(false); // excepted

    card.querySelector('.other').click();
    expect(overlay().textContent).toContain('card');
    closeExpand();

    card.querySelector('.ban').click(); // a subview ignores the exception
    expect(overlay().textContent).toContain('sub');
  });

  it('keeps the default hint for every view that does not ask for one', () => {
    openExpand({ title: 'X', bodyHtml: '<p>x</p>' });
    expect(overlay().querySelector('.expand__hint').textContent).toBe('Tap anywhere to close');
  });
});
