// The full-screen ledger shared by Cloud Services and TfL Status (Sean's pick
// 2026-08-01, mockup 6B) — one wiring for two cards, the same reasoning
// train-expand.js is one wiring for five rail boards: both cards render the
// same "name, state word, and the prose behind it" row, and they must behave
// identically.
//
// It is a TYPOGRAPHIC ledger, deliberately not the subway wall's wells: the
// trouble leads in reading type with its status prose UNCUT (the card clamps
// that note to a single line and used to need a per-row tap to complete it),
// and everything that is fine settles underneath as two quiet columns of
// hairline rows. No boxes anywhere — hairlines and type carry the structure,
// which is what keeps a full eleven-service config calm on one canvas.
//
// An item is:
//   { name, state, alert, tone = '', dot = '', notes = [{ text, meta, more }] }
// `alert` decides the group (lead or quiet), `tone` only colours the state
// word, and `dot` is TfL's line colour. Callers hand items in the order the
// CARD sorts them; the filter below is stable, so trouble-first is preserved
// inside each group without a second sort.

import { escapeHtml } from './util.js';
import { dealInto } from './columns.js';

// Two balanced columns, filled DOWN the first and then down the second — the
// reading order subway's wall deals its wells in (seven splits 4 + 3, never
// 6 + 1). A single item gets one column rather than a lonely pair, which is
// this view's row cost stated as a number: one row is all a lone column is
// allowed before the board would rather balance.
//
// No rows at all means no columns at all, and that part is the ledger's own
// rule rather than the shared deal's: dealInto answers "one empty column" so a
// view with a box to draw still gets one, and this view draws no box.
export const ledgerColumns = (rows) =>
  (rows.length ? dealInto(rows, { fitsOneColumn: 1, maxColumns: 2 }) : []);

const dotHtml = (color) =>
  (color ? `<span class="ledger__dot" style="background:${escapeHtml(color)}"></span>` : '');

// One paragraph of status prose: the incident line, its quiet "since" stamp,
// and the operator's longer update underneath when there is one. `meta` is set
// as its own span rather than joined with a dash — the text reader spells it
// "— since ...", which is punctuation this surface does not need.
const noteHtml = (n) => `<p class="ledger__note">${escapeHtml(n.text ?? '')}${
  n.meta ? ` <span class="ledger__since">${escapeHtml(n.meta)}</span>` : ''
}${n.more ? `<span class="ledger__update">${escapeHtml(n.more)}</span>` : ''}</p>`;

const nameHtml = (i) => `<span class="ledger__name">${dotHtml(i.dot)}${escapeHtml(i.name)}</span>`;

const stateHtml = (i, lead) =>
  `<span class="ledger__state${lead && i.tone ? ` ledger__state--${escapeHtml(i.tone)}` : ''}">${
    escapeHtml(i.state)
  }</span>`;

// The advisory group (Sean's pick 2026-08-27, mockup A). Microsoft publishes a
// standing backlog of long-running low-impact advisories, and the Worker keeps
// them out of the row's state so they stop painting the wall amber. They still
// belong on this surface, because "why is Outlook odd this week" is exactly the
// question a tap is asking, so they sit under their own heading as one compact
// line each: no prose, no colour, nothing that competes with the incident above.
const advisoryRow = (a) => `<div class="ledger__advrow">
        <span class="ledger__advname">${escapeHtml(a.text ?? '')}</span>
        <span class="ledger__advsince">${escapeHtml(a.meta ?? '')}</span>
      </div>`;

const advisoryHtml = (i) => ((i.advisories ?? []).length ? `<div class="ledger__adv">
      <div class="ledger__advhead">
        <span>Advisories</span><span>${escapeHtml(i.advisoriesNote ?? '')}</span>
      </div>
      ${i.advisories.map(advisoryRow).join('')}
    </div>` : '');

const leadRow = (i) => `<div class="ledger__row ledger__row--lead">
      <div class="ledger__head">${nameHtml(i)}${stateHtml(i, true)}</div>
      ${(i.notes ?? []).map(noteHtml).join('')}
      ${advisoryHtml(i)}
    </div>`;

const quietRow = (i) => `<div class="ledger__row">${nameHtml(i)}${stateHtml(i, false)}</div>`;

// The overlay body. Either group renders only when it has rows, so an all-quiet
// board is the two columns alone and a total outage is all lead rows — the same
// "no empty band, no reserved space" rule the subway wall follows.
export function ledgerBody(items) {
  // `alert` decides the group, with one addition: a service that is fine but
  // carries advisories still leads, because the quiet two-column group has no
  // room to show them and dropping them there would hide the backlog on exactly
  // the ordinary day a reader goes looking for it. Its state word stays neutral
  // (tone is '' for an ok row), so leading costs it no alarm.
  const isLead = (i) => i.alert || (i.advisories ?? []).length > 0;
  const lead = items.filter(isLead);
  const quiet = items.filter((i) => !isLead(i));
  const cols = ledgerColumns(quiet)
    .map((col) => `<div class="ledger__col">${col.map(quietRow).join('')}</div>`)
    .join('');
  return `<div class="ledger"><div class="ledger__band">${
    lead.length ? `<div class="ledger__lead">${lead.map(leadRow).join('')}</div>` : ''
  }${quiet.length ? `<div class="ledger__quiet">${cols}</div>` : ''}</div></div>`;
}
