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

// Two balanced columns, filled DOWN the first and then down the second — the
// reading order subway's wall deals its wells in (seven splits 4 + 3, never
// 6 + 1). A single item gets one column rather than a lonely pair.
export const ledgerColumns = (rows) => {
  if (rows.length < 2) return rows.length ? [rows] : [];
  const first = Math.ceil(rows.length / 2);
  return [rows.slice(0, first), rows.slice(first)];
};

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

const leadRow = (i) => `<div class="ledger__row ledger__row--lead">
      <div class="ledger__head">${nameHtml(i)}${stateHtml(i, true)}</div>
      ${(i.notes ?? []).map(noteHtml).join('')}
    </div>`;

const quietRow = (i) => `<div class="ledger__row">${nameHtml(i)}${stateHtml(i, false)}</div>`;

// The overlay body. Either group renders only when it has rows, so an all-quiet
// board is the two columns alone and a total outage is all lead rows — the same
// "no empty band, no reserved space" rule the subway wall follows.
export function ledgerBody(items) {
  const lead = items.filter((i) => i.alert);
  const quiet = items.filter((i) => !i.alert);
  const cols = ledgerColumns(quiet)
    .map((col) => `<div class="ledger__col">${col.map(quietRow).join('')}</div>`)
    .join('');
  return `<div class="ledger"><div class="ledger__band">${
    lead.length ? `<div class="ledger__lead">${lead.map(leadRow).join('')}</div>` : ''
  }${quiet.length ? `<div class="ledger__quiet">${cols}</div>` : ''}</div></div>`;
}
