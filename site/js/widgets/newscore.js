// Shared news engine: RSS parse + merge, and a parameterized headline
// render/fetch reused by the Headlines and Markets-news widgets.
import { escapeHtml } from '../util.js';
import { setMoreBadge } from '../card.js';
import { WORKER_URL } from '../env.js';
import { itemCapacity, cardSize } from '../capacity.js';
import { setExpandSource, OVERLAY_BODY_H } from '../expand.js';
import { openStoryViewer } from '../textviewer.js';

// Common named HTML entities seen in news feeds (numeric refs handled inline).
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  copy: '©', reg: '®', trade: '™', deg: '°',
};
// Decode numeric (&#dd; / &#xhh;) and known-named entities; leave an unknown
// named ref untouched rather than mangling it.
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = /^#x/i.test(code) ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      // Bound to valid Unicode: a malformed entity above 0x10FFFF makes
      // String.fromCodePoint throw RangeError, which would kill this source's
      // whole parse on every refresh. Out-of-range -> leave the raw ref.
      return Number.isFinite(n) && n > 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : m;
    }
    const c = NAMED_ENTITIES[code.toLowerCase()];
    return c === undefined ? m : c;
  });
}
const stripTags = (s) => s.replace(/<[^>]+>/g, '');

// Minimal RSS <item> parser: title, pubDate, and (for the tap-to-read story
// view) the article link + a short description/summary.
export function parseRss(xml, sourceLabel) {
  const items = [];
  const itemRe = /<item[\s>][\s\S]*?<\/item>/g;
  // Strip real tags, decode entities, then strip AGAIN: some feeds entity-ENCODE
  // their markup (NPR emits "&lt;em&gt;"), so those tags only become strippable
  // after the first decode. A second decode catches double-encoded text.
  const pick = (block, tag) => {
    const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(block);
    if (!m) return '';
    let s = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    s = decodeEntities(stripTags(s));
    s = decodeEntities(stripTags(s));
    return s.replace(/\s+/g, ' ').trim();
  };
  for (const block of xml.match(itemRe) ?? []) {
    const title = pick(block, 'title');
    if (!title) continue;
    const t = Date.parse(pick(block, 'pubDate')) || 0;
    // link is a bare URL; description is a summary (HTML stripped by pick). Both
    // optional — some feeds omit the summary (Seeking Alpha), a few the link.
    const link = pick(block, 'link');
    items.push({ title, t, source: sourceLabel, link: /^https?:/i.test(link) ? link : '', desc: pick(block, 'description') });
  }
  return items;
}

// Words that carry no story identity. Small on purpose: over-stripping makes
// distinct headlines look alike, and a missed stopword only costs a merge we
// would otherwise have made.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'after',
  'before', 'over', 'under', 'vs', 'his', 'her', 'their', 'its', 'this', 'that',
  'what', 'why', 'how', 'who', 'will', 'would', 'could', 'should', 'has',
  'have', 'had', 'not', 'no', 'up', 'out', 'off', 'into', 'about', 'more',
  'per', 'amid', 'during', 'between', 'begin', 'begins', 'big', 'new',
]);

// A headline's identity: its informative tokens. Exported for tests.
export function storyTokens(title) {
  return new Set(
    title.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w)),
  );
}

// Cross-outlet near-duplicate: every outlet covers the same trade with a
// different sentence. Two stories are one when they share >= 3 informative
// tokens AND those cover >= 0.55 of the SHORTER title's tokens (containment,
// not Jaccard: one outlet writes 'Mets trade reliever A.J. Minter to Twins',
// another pads it to 'Twins add A.J. Minter as Mets begin sell-off: MLB Trade
// Grades', and the long title dilutes a union-based score below any workable
// floor — the recorded trade trio lands at 0.36-0.44 Jaccard but 0.57+
// containment). Three shared tokens is what one event produces ('minter',
// 'twins', 'mets'); 'Mets trade Minter' vs 'Mets trade Alvarez' shares only
// two. The caller also gates on time proximity, so this stays a
// same-news-cycle judgment.
export function sameStory(aTokens, bTokens) {
  let shared = 0;
  for (const t of aTokens) if (bTokens.has(t)) shared += 1;
  if (shared < 3) return false;
  const smaller = Math.min(aTokens.size, bTokens.size);
  return smaller > 0 && shared / smaller >= 0.55;
}

// One news cycle. 18h keeps overnight coverage together (an 11pm US story and
// its 7am European retelling) while a next-day analysis piece, which lands a
// full day later, stays its own row. Undated items (t=0) never fuzz-match:
// fuzzy matching needs a clock.
const SAME_CYCLE_MS = 18 * 3600e3;

export function mergeNews(perSource, nowMs, max = 30) {
  // Overlapping feeds (e.g. NYT Top Stories + NYT New York) carry the same
  // story; dedupe by normalized title after the newest-first sort so the
  // freshest copy wins and rows are never wasted on repeats.
  const seen = new Set();
  const kept = []; // {tokens, t} of survivors, for the near-duplicate pass
  return perSource
    .flat()
    .filter((i) => i.t === 0 || i.t <= nowMs + 3600e3) // drop clock-skewed future items
    .sort((a, b) => b.t - a.t)
    .filter((i) => {
      const key = i.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      // Non-ASCII text (emoji-only, CJK, Cyrillic posts) normalizes to '';
      // don't let the first such item claim that key and drop all the rest.
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      // Near-duplicate pass (Sean, 2026-07-31): the list is newest-first, so
      // the survivor of each cluster is the freshest telling and later (older)
      // retellings collapse into it. Runs before any capacity trim, so freed
      // rows show other stories.
      const tokens = storyTokens(i.title);
      if (i.t > 0 && kept.some((k) => k.t > 0 && Math.abs(k.t - i.t) < SAME_CYCLE_MS && sameStory(k.tokens, tokens))) {
        return false;
      }
      kept.push({ tokens, t: i.t });
      return true;
    })
    .slice(0, max);
}

export function ageLabel(t, nowMs) {
  if (!t) return '';
  const min = Math.max(0, Math.round((nowMs - t) / 60000));
  if (min < 60) return `${min}m`;
  if (min < 60 * 24) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}

// ---------- the expanded reading list (wave 3) ----------
//
// Every headline the card holds, at reading size, on the full-screen overlay.
// It NEVER scrolls: a passerby will not discover a scroll on a wall panel, so
// the list is capped to what honestly fits instead. The fit is arithmetic
// rather than measured because it also has to answer a question asked BEFORE
// the overlay exists — how big may the corner badge's "+N" be (see the cap in
// renderHeadlines) — and because every term below is pinned as a fixed px in
// main.css precisely so this sum stays exact on a board whose font is not the
// one the list was measured in. Same contract as OVERLAY_BODY_H itself.
const LIST_META_H = 24; // 20px source/age line, line-height pinned to 24px
const LIST_META_GAP = 4;
const LIST_TITLE_LH = 34; // 26px headline, line-height pinned to 34px
// What separates two rows: 8px under the text, the 1px hairline, then the
// grid's 10px row-gap. It is charged BETWEEN rows only, which is exactly true
// on the board because the last row of every column drops its padding and rule
// (.headline--tail) — so this model is not an estimate, it is the geometry.
const LIST_ROW_GAP = 8 + 1 + 10; // 19
// Titles clamp to two lines, so two is what a row is budgeted at. In a
// three-column list a column runs ~500px, which is ~38 characters of 26px
// type: a typical headline really does take both lines, so this is the honest
// row height and not a worst case that never happens. A one-line row simply
// leaves its slack unspent (the grid rows are min-content).
export const LIST_ROW_H = LIST_META_H + LIST_META_GAP + 2 * LIST_TITLE_LH; // 96
// The board's 52px of air between the overlay title and the first row (the
// approved mockup's breathing room) is 36px of .expand__body margin plus this,
// and this part comes out of the canvas the rows get to use.
export const LIST_TOP_PAD = 16;
export const LIST_BODY_H = OVERLAY_BODY_H - LIST_TOP_PAD; // 798

// Rows per column: n rows cost n row-heights plus the n-1 gaps BETWEEN them,
// so the trailing gap is added to the budget rather than subtracted from each
// row. Seven at the shipped numbers (7*96 + 6*19 = 786 of 798; an eighth would
// need 901).
export function listRows(bodyH = LIST_BODY_H) {
  return Math.max(1, Math.floor((bodyH + LIST_ROW_GAP) / (LIST_ROW_H + LIST_ROW_GAP)));
}

// How wide a family's list may deal. The headline outlets carry short, dense
// titles and read well three across; Substack and Bluesky carry long ones and
// were approved at two.
export const LIST_MAX_COLS = { news: 3, marketsnews: 3, sportsnews: 3, substack: 2, bsky: 2 };

// Few items stay in one grand centered column (the history day-view grammar),
// then two, then the family's maximum. Driven by the item count the card HOLDS,
// which never grows after the cap is applied, so the choice cannot oscillate
// between the capacity it implies and the count that implied it.
export function listColumns(n, maxCols) {
  if (n <= 6) return 1;
  if (n <= 12) return Math.min(2, maxCols);
  return maxCols;
}

export function listCapacity(n, widgetId) {
  return listRows() * listColumns(n, LIST_MAX_COLS[widgetId] ?? 3);
}

// Bluesky posts and Substack essays are not "headlines", and the hint line is
// the one place the board says the word out loud.
const READ_NOUN = { substack: 'piece', bsky: 'post' };

export function renderHeadlines(el, vm, { widgetId, emptyHint, title = '' }) {
  if (!vm.items?.length) {
    el.innerHTML = `<div class="empty" data-setup="${widgetId}">${emptyHint}</div>`;
    setMoreBadge(el, 0);
    setExpandSource(el, null); // an emptied card is inert again, badge and tap together
    return;
  }
  const nowMs = vm.nowMs ?? Date.now();
  // Source + age stack above the full-width headline so neither ever
  // squeezes the other (at 3 cols the old side-by-side row truncated both).
  // A story with a link or summary is tappable (opens the full-screen story
  // view); carry those on the element so the delegated handler can read them.
  // `inList` marks up the same row for the full-screen reading list. Only a row
  // with a story behind it becomes an expand-row: the engine keeps the overlay
  // open for those and closes it for every other tap, so a row that has nothing
  // to open still reads as "tap anywhere else to close" rather than as a dud.
  const itemHtml = (i, clamp, { list = false, tail = false } = {}) => {
    const more = i.link || i.desc;
    return `<div class="headline${clamp ? ' headline--clamp' : ''}${more ? ' headline--more' : ''}${tail ? ' headline--tail' : ''}"${list && more ? ' data-expand-row' : ''}${i.link ? ` data-link="${escapeHtml(i.link)}"` : ''}${i.desc ? ` data-desc="${escapeHtml(i.desc)}"` : ''}>
        <div class="headline__meta">
          <span class="headline__src">${escapeHtml(i.source)}</span>
          <span class="headline__age">${escapeHtml(ageLabel(i.t, nowMs))}</span>
        </div>
        <span class="headline__title">${escapeHtml(i.title)}</span>
      </div>`;
  };
  // Markup for the first n items. The overflow count rides the title badge
  // (setMoreBadge below), so it costs no row and isn't part of the measure.
  // clampLast renders the final item with its title clamped to one line.
  const build = (n, clampLast = false) =>
    vm.items.slice(0, n).map((it, idx) => itemHtml(it, clampLast && idx === n - 1)).join('');
  // Static estimate from the capacity model. This is the final answer when
  // there's no rendered box to measure (e.g. happy-dom in tests).
  const [w, h] = cardSize(el, [4, 4]);
  const cap = itemCapacity(widgetId, w, h) ?? 4;
  let n = Math.min(vm.items.length, cap);
  el.innerHTML = build(n);
  // Fill-to-fit: with a real rendered box, grow/shrink to the count that
  // actually fits. The static 75px/row estimate assumes worst-case two-line
  // titles; most titles are one line, so the card usually has room for more.
  if (el.clientHeight > 0) {
    while (n > 1 && el.scrollHeight > el.clientHeight) { n -= 1; el.innerHTML = build(n); }
    while (n < vm.items.length) {
      n += 1;
      el.innerHTML = build(n);
      if (el.scrollHeight > el.clientHeight) { n -= 1; el.innerHTML = build(n); break; }
    }
    // The loops fit whole rows, so when the next item doesn't fit, up to a
    // full two-line headline of slack can sit empty (visible on a 3x4 board
    // card). Spend it on one more item with its title clamped to a single
    // ellipsized line — a truncated headline beats blank space.
    if (n < vm.items.length) {
      n += 1;
      el.innerHTML = build(n, true);
      if (el.scrollHeight > el.clientHeight) { n -= 1; el.innerHTML = build(n); }
    }
  }
  // THE +N CAP (Sean, 2026-08-01). The badge is a promise about the tap, so it
  // must never advertise more than the tap can actually deliver. This is the
  // one family where that can bite: mergeNews hands over as many as 30 items
  // while the reading list seats 21 at most, so an uncapped count would offer
  // a "+26" that opens onto 21 rows. Every other card's overlay shows
  // everything it holds, which is why the cap lives here and not in
  // setMoreBadge.
  const viewCap = listCapacity(vm.items.length, widgetId);
  setMoreBadge(el, Math.max(0, Math.min(vm.items.length - n, viewCap - n)));

  // Whole-card tap for the whole list, EXCEPT on a headline row: the rows
  // already own their taps (each opens its own story) and the card owes the
  // reader everything else. Unconditional, like the history day view: the rows
  // cover the card, so one card has to mean one destination, and a card whose
  // items all fit still owes a tap the bigger reading view. Only the badge
  // tracks what is hidden.
  const shown = Math.min(vm.items.length, viewCap);
  const cols = listColumns(vm.items.length, LIST_MAX_COLS[widgetId] ?? 3);
  const perCol = Math.ceil(shown / cols);
  // The last row of each column carries no rule: a separator under the final
  // row divides it from nothing, and it is also what makes the height model
  // above exact (the tail row costs 96px, not 96 + padding + hairline).
  const listHtml = vm.items.slice(0, shown)
    .map((i, idx) => itemHtml(i, false, { list: true, tail: (idx + 1) % perCol === 0 || idx === shown - 1 }))
    .join('');
  const noun = READ_NOUN[widgetId] ?? 'headline';
  setExpandSource(
    el,
    () => ({
      title,
      hint: `Tap a ${noun} to read it · Tap anywhere else to close`,
      // Column-first, so the freshest story is top-left and the list reads down
      // one column before crossing to the next (the rail split board's grammar).
      // --list-rows balances the columns; the markup is snapshot-at-open.
      bodyHtml: `<div class="news-board news-board--c${cols}" style="--list-rows:${perCol}">${listHtml}</div>`,
      // The overlay lives outside #grid, so the text viewer's delegated listener
      // never sees these rows — this is the only handler in play, and the story
      // view stacks above the list rather than replacing it.
      onRowTap: (row) => openStoryViewer({
        title: row.querySelector('.headline__title')?.textContent.trim() ?? '',
        source: row.querySelector('.headline__src')?.textContent.trim() ?? '',
        age: row.querySelector('.headline__age')?.textContent.trim() ?? '',
        desc: row.dataset.desc ?? '',
        link: row.dataset.link ?? '',
      }),
    }),
    { except: '.headline' },
  );
}

// `filter`, when given, keeps only the items it accepts. It runs on the WHOLE
// fetched feed, before mergeNews trims to the newest 30 — a narrow filter over
// an already-trimmed list would only ever find its subject while that subject
// happened to be among the freshest stories in the whole feed.
export async function fetchHeadlines(ids, sourceById, net, { filter } = {}) {
  const settled = await Promise.allSettled(
    ids.map(async (id) => {
      const src = sourceById[id];
      if (!src) return [];
      const [, label, kind, ref] = src;
      if (kind === 'direct') {
        // net.fetchText applies the 15s timeout — a bare fetch() on a hung
        // NYT connection would stall the whole refresh cycle indefinitely.
        return parseRss(await net.fetchText(ref), label);
      }
      const payload = await net.fetchJSON(`${WORKER_URL}/news/${ref}`);
      return parseRss(payload.xml ?? '', label);
    }),
  );
  const perSource = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
  // Every source failed (not merely empty): throw so the stale cache survives.
  if (ids.length && !perSource.some((p) => p.length) && settled.some((s) => s.status === 'rejected')) {
    throw new Error('news: all sources failed');
  }
  const nowMs = Date.now();
  // Filter AFTER that check: a filter matching nothing is an empty card, not a
  // dead source, and must not be mistaken for a total upstream failure.
  const kept = filter ? perSource.map((items) => items.filter(filter)) : perSource;
  return { items: mergeNews(kept, nowMs), nowMs };
}
