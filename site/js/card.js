// One module owns what a card is.
//
// A card is the board's unit of content: an <article> placed on the 12x8 grid,
// wearing its widget's id, a title, an empty body for the renderer to fill, and
// a hidden freshness stamp. Three places mount one (the running board in
// main.js, the resize audit harness in site/_audit.html, and the tests), and
// each used to describe it in its own markup. That is how the tier classes came
// to exist on production cards and on no forged one, leaving every renderer
// test running against a card that differed from a real one in exactly the
// attribute main.css branches on.
//
// So everything a card IS lives here: its markup, the geometry hooks derived
// from its rect, its freshness marks, and the chrome operations renderers hang
// off it (the title note, the corner count, the tap affordance), each of which
// walks .closest('.card') from a body element to reach exactly this article.

import { normalizeConfig } from './config.js';
import { fmtClock } from './util.js';

const $ = (sel) => document.querySelector(sel);

// The board's live config, read through a getter rather than held. main.js
// REPLACES cfg wholesale on every save, and two card operations need whichever
// one is current: the freshness stamp follows cfg.clock24, and an unconfigured
// card's tap opens Settings long after the card was built. Reading main.js's
// binding directly would mean importing main.js, which imports this module;
// the getter keeps the reading live and the dependency one-way.
let readConfig = () => null;

export function setCardConfigSource(read) {
  readConfig = typeof read === 'function' ? read : () => null;
}

// The card's markup, and the only copy of it. Callers that own their own DOM
// (the audit harness, the test scaffolds) build through here rather than typing
// the article out again, so a mounted card and a real one cannot drift apart.
export function buildCard(mod) {
  const card = document.createElement('article');
  card.className = `card card--${mod.meta.id}`;
  card.setAttribute('data-widget', mod.meta.id);
  card.innerHTML = `
      <h2 class="card__title">${mod.meta.title}</h2>
      <div class="card__body"></div>
      <div class="card__stamp" hidden></div>`;
  return card;
}

// Unconfigured cards tap straight into their Settings section — the
// prompt names the destination; the tap saves the trip. Card-level and
// inert unless a data-setup prompt is currently showing.
//
// The board's policy, not the card's markup, which is why it is wired by
// cardFor and not by buildCard: a harness or a test mounting a card wants the
// article, not a live route into the settings pane.
function wireSetupTap(card) {
  card.addEventListener('click', async () => {
    // Retired-card prompt: straight into edit mode to swap the widget.
    if (card.querySelector('[data-edit]')) { $('#edit').click(); return; }
    const prompt = card.querySelector('[data-setup]');
    if (!prompt) return;
    const settings = await import('./settings/settings.js');
    settings.openSettings(readConfig() ?? normalizeConfig({}), { focus: prompt.dataset.setup });
  });
}

// The board's card for a widget: the one that is already on the grid, or a new
// one appended to it. Identity is the widget id, because a refresh must repaint
// the card the board is already showing rather than grow a second one.
export function cardFor(mod, rect) {
  let card = document.querySelector(`[data-widget="${mod.meta.id}"]`);
  if (!card) {
    card = buildCard(mod);
    wireSetupTap(card);
    $('#grid').appendChild(card);
  }
  applyCardRect(card, rect);
  return card;
}

// Where the card sits, and what its size makes it. Size hooks for per-size
// compact styling (container queries need a newer Chromium than gen1 boards
// have). Tier classes: t-s/t-m/t-l by height, t-narrow when 4 or fewer columns
// wide.
//
// It is exported separately from cardFor because the derivation is the part
// everybody needs and nobody should retype: whoever mounts a 3x2 card gets the
// same data-w/data-h AND the same t-s/t-narrow the board would give it. x and y
// default to the origin so a caller that only cares about SIZE (a resize sweep,
// a one-card test scaffold) can pass the width and height alone.
export function applyCardRect(card, rect) {
  if (!card || !rect) return card;
  const { x = 0, y = 0, w, h } = rect;
  card.style.gridColumn = `${x + 1} / span ${w}`;
  card.style.gridRow = `${y + 1} / span ${h}`;
  card.dataset.w = w;
  card.dataset.h = h;
  card.classList.remove('t-s', 't-m', 't-l', 't-narrow');
  card.classList.add(`t-${h <= 2 ? 's' : h <= 4 ? 'm' : 'l'}`);
  if (w <= 4) card.classList.add('t-narrow');
  return card;
}

export function stampOf(card) {
  return card.querySelector('.card__stamp');
}

export function markFresh(card) {
  card.classList.remove('is-stale');
  stampOf(card).hidden = true;
}

export function markStale(card, cachedAtSec) {
  card.classList.add('is-stale');
  const stamp = stampOf(card);
  if (cachedAtSec) {
    // Freshness stamp is a clock reading, so it follows cfg.clock24 (unlike
    // the transit schedule times in the card body).
    stamp.textContent = `as of ${fmtClock(cachedAtSec, readConfig()?.clock24)}`;
    stamp.hidden = false;
  }
}

// Small right-aligned context note in a card's title ("as of 8:16 PM",
// "stops at Mineola"). Null/empty text removes it. Reuses .card__asof so the
// amber stale stamp keeps winning the corner (.card.is-stale hides the note).
export function setCardNote(el, text) {
  const title = el.closest?.('.card')?.querySelector('.card__title');
  if (!title) return;
  let note = title.querySelector('.card__asof');
  if (!text) {
    note?.remove();
    return;
  }
  if (!note) {
    note = document.createElement('span');
    note.className = 'card__asof';
    title.appendChild(note);
  }
  note.textContent = text;
}

// ---------- the bottom-right corner badge ----------
//
// ONE form, board-wide, and it is text: "+N", the compact count alone.
// It depends on exactly one fact, the renderer's, via setMoreBadge:
//
//   hides N > 0   "+8"      every card, whatever its tap does
//   hides nothing  no badge  the corner stays empty
//
// It arrived there by subtraction, over 2026-08-01 and 08-02, each cut made off
// a rendered board rather than off a description:
//
//   the BARE MARK went first. Almost every card will eventually open into
//   something, so a per-card label for a property the whole board shares says
//   nothing, and five marks in five corners are just chrome.
//
//   the SECOND DIALECT went next. A count that read "8 more" beside the mark
//   on tappable cards and "+8" without it elsewhere made one board speak two
//   languages, which reads as inconsistency at glance distance long before it
//   reads as a distinction. The row-tap cards (the news family) open per row,
//   so a tap there is never dead, and news nesting will make the card-level
//   promise true anyway.
//
//   the GLYPH went last, 2026-08-02. It was drawn to mark WHICH cards open full
//   screen; the expand wave made card-opening effectively universal, so on a
//   board of count cards it repeated a known fact five times over and read as
//   icon clutter ("if you have a lot of cards that have +N items it feels off
//   to see so many icons", Sean). The count was carrying the whole message by
//   then, so the mark went and the count stayed.
//
// So the badge no longer knows or cares whether the card expands. Everything
// that makes a tap WORK is elsewhere and untouched: .is-expandable,
// role/tabindex/aria-label, the :active tint. markExpandable does not repaint
// the badge, because there is no longer any wording for it to flip.
//
// The corner is safe at every card width (a title badge clips beside long
// titles on 2-wide cards) and .card__stamp is top-anchored, so the badge and
// the amber "as of" stamp can never collide.
//
// It sits at EQUAL 12px insets (main.css .card__more, 2026-08-01) rather than
// on the content column's 26px edge: what sits in a corner is a corner mark,
// not reading matter, and the inherited 26/10 read as misplaced. No renderer
// owes the corner anything any more: the badge only appears where there is a
// count, and no card that shows one has a row running flush to its bottom
// edge (swept 2026-08-01), so weather's day tiles and surf's footer strip gave
// back the gutter they had been paying.

// Reads the widget's own name off the card for an aria-label. First text node
// only: a title may carry an appended .card__asof span (same idiom as the text
// viewer's title read).
function cardName(card) {
  return card.querySelector?.('.card__title')?.childNodes[0]?.textContent?.trim() ?? '';
}

export function paintMoreBadge(card) {
  // querySelector may be absent on test fakes (capacity stubs) — no-op then.
  if (!card?.querySelector) return;
  const hidden = Number(card.dataset.more) || 0;
  let badge = card.querySelector('.card__more');
  // The count is the whole trigger: no count, no corner, however tappable the
  // card is.
  if (!hidden) {
    badge?.remove();
    card.classList.remove('has-more');
    return;
  }
  if (!badge) {
    badge = document.createElement('span');
    card.appendChild(badge);
  }
  badge.className = 'card__more';
  // Text, and nothing but: no glyph, so no wrapper span to align one against
  // and no markup to escape. textContent is the whole badge.
  badge.textContent = `+${hidden}`;
  card.classList.add('has-more');
}

// The renderer's half, and now the only half: how many rows the card is NOT
// showing. Replaces the old in-flow ".more-hint" row — the count costs no list
// row, and the "enlarge the card" imperative lives only in edit mode
// (capacityLabel). hidden <= 0 drops the whole badge, expandable or not.
//
// It took a `verbose` option until 2026-08-01, to pick "+N more" over "+N" on
// a card that did not expand. One form board-wide leaves nothing for a caller
// to choose, so the option is gone rather than kept as a no-op.
export function setMoreBadge(el, hidden) {
  const card = el.closest?.('.card');
  if (!card?.querySelector) return;
  const n = hidden > 0 ? Math.round(hidden) : 0;
  if (n) card.dataset.more = String(n);
  else delete card.dataset.more;
  paintMoreBadge(card);
}

// This card opens something when you tap it. Called from setExpandSource (the
// overlay engine) and from renderImageCard (the image surface, whose
// full-screen viewer is its own expansion) — the two places a card is MARKED
// tappable — so no widget wires the affordance itself and every future
// expandable card gets it for free.
//
// role/tabindex/aria-label ride along: a card that behaves like a button says
// so, and the label names the destination rather than the card ("Expand
// Weather details"). Image cards pass their own label, which already reads
// "View image full screen".
//
// It does NOT touch the badge. It used to, back when expandability picked the
// count's wording; with one form board-wide there is nothing to flip, and the
// two concerns are properly independent again: the badge answers "how much is
// missing", this answers "does the card open".
export function markExpandable(el, expands, { label = '' } = {}) {
  const card = el?.closest?.('.card');
  if (!card?.querySelector) return;
  card.classList.toggle('is-expandable', Boolean(expands));
  if (expands) {
    const name = cardName(card);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', label || (name ? `Expand ${name} details` : 'Expand details'));
  } else {
    card.removeAttribute('role');
    card.removeAttribute('tabindex');
    card.removeAttribute('aria-label');
  }
}
