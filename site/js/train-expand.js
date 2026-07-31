// Tap-to-expand for the five rail departure boards (LIRR, Metro-North,
// NJ Transit, Amtrak, Ferry) — wave 2 of the +N rollout, one wiring because
// they all render the same .train rows and must behave identically. After a
// renderer has sliced to capacity, this fits the rows the browser can actually
// hold, counts what the card is NOT showing, pins the tappable "+N more" pill,
// and registers the full two-column departures overlay.
//
// The pill is the ONLY trigger (setExpandSource's trigger selector): rail rows
// may become tappable in a later wave, and a whole-card target would collide
// with that the way it would have with headlines' row taps.

import { setMoreBadge } from './util.js';
import { setExpandSource } from './expand.js';
import { fitTrainRows } from './capacity.js';

// `rows` is the FULL departure list's markup, built by the caller's own row
// template — the overlay shows exactly the rows the card would, uncapped. The
// strings are captured per render, so the tap-time snapshot is this render's.
export function wireTrainExpand(el, { title, note = '', rows }) {
  const card = el.closest?.('.card');
  fitTrainRows(el);
  const count = () => el.querySelectorAll?.('.train').length ?? 0;
  let hidden = rows.length - count();
  if (hidden > 0 && card?.classList) {
    // The pill floats over the card's bottom padding plus the reserve the
    // is-expandable-pill class adds under .trains — never over a train row.
    // Adding the reserve can itself evict the row now under it, so re-measure
    // once with the class on (monotonic, never loops).
    card.classList.add('is-expandable-pill');
    fitTrainRows(el);
    hidden = rows.length - count();
  }
  setMoreBadge(el, hidden, { pill: true });
  setExpandSource(
    el,
    hidden > 0
      ? () => ({ title, note, bodyHtml: `<div class="trains trains--board">${rows.join('')}</div>` })
      : null,
    { trigger: '.card__more' },
  );
  if (hidden <= 0) card?.classList?.remove('is-expandable-pill');
}
