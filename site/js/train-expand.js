// Tap-to-expand for the five rail departure boards (LIRR, Metro-North,
// NJ Transit, Amtrak, Ferry) — wave 2 of the +N rollout, one wiring because
// they all render the same .train rows and must behave identically. After a
// renderer has sliced to capacity, this fits the rows the browser can actually
// hold, counts what the card is NOT showing, pins the quiet "+N more" corner
// badge, and registers the full two-column departures overlay.
//
// The whole card is the target, the markets grammar (Sean, 2026-07-31): the
// first cut used a pill-only trigger whose touch-target reserve cost a
// visible train row on exactly-filled cards, a worse trade than reserving
// rail rows for a hypothetical future row tap. The badge's "more" is the tap
// invitation; the engine's trigger selector remains available for the news
// wave, where rows really are tappable.

import { setMoreBadge } from './util.js';
import { setExpandSource } from './expand.js';
import { fitTrainRows } from './capacity.js';

// `rows` is the FULL departure list's markup, built by the caller's own row
// template — the overlay shows exactly the rows the card would, uncapped. The
// strings are captured per render, so the tap-time snapshot is this render's.
export function wireTrainExpand(el, { title, note = '', rows }) {
  fitTrainRows(el);
  const hidden = rows.length - (el.querySelectorAll?.('.train').length ?? 0);
  setMoreBadge(el, hidden, { verbose: true });
  setExpandSource(
    el,
    hidden > 0
      ? () => ({ title, note, bodyHtml: `<div class="trains trains--board">${rows.join('')}</div>` })
      : null,
  );
}
