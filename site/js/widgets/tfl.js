// London TfL line status — a Subway-style board for the lines you pick, from
// the worker's /tfl/status digest. Colour dot + name + status; tap a disrupted
// line for the full reason.

import { escapeHtml, setupPrompt } from '../util.js';
import { WORKER_URL } from '../env.js';
import { fitList } from '../capacity.js';
import { openTextViewer, defersToExpand } from '../textviewer.js';
import { setExpandSource } from '../expand.js';
import { ledgerBody } from '../ledger.js';
import { TFL_LINES } from '../tfl-lines.js';

export const meta = { id: 'tfl', title: 'TfL Status', refreshMs: 2 * 60 * 1000 };
const LINE_META = new Map(TFL_LINES.map((l) => [l.id, l]));

// Every configured line as a ledger item, disrupted lines first — the same
// priority the card truncates by, applied to the whole list rather than to the
// slice that fits. The line colour rides along as the row's dot, so the wall
// keeps the one signal the card leads with. A line with no reason text still
// leads (its status word is the news); it simply carries no prose.
export const tflItems = (rows) => [...rows]
  .sort((a, b) => Number(a.ok) - Number(b.ok))
  .map((r) => ({
    name: r.name,
    state: r.status,
    alert: !r.ok,
    tone: r.ok ? '' : 'alert',
    dot: r.color,
    notes: r.reason ? [{ text: r.reason, meta: '', more: '' }] : [],
  }));

export function render(el, vm, cfg) {
  const chosen = cfg.tfl?.lines ?? [];
  if (!chosen.length) {
    el.innerHTML = setupPrompt('tfl', 'pick lines', 'TfL Status');
    setExpandSource(el, null); // an unconfigured card taps into Settings
    return;
  }
  const byId = new Map((vm.lines ?? []).map((l) => [l.id, l]));
  const rows = chosen.map((id) => {
    const m = LINE_META.get(id);
    const live = byId.get(id);
    return {
      name: m?.name ?? id, color: m?.color ?? '#888',
      ok: live ? live.ok : true, status: live ? live.status : '—', reason: live?.reason ?? '',
    };
  });
  // The rows the card ended up drawing, in the order it drew them: the tap
  // handler below indexes into this, so it is written by the draw itself.
  let ordered = rows;
  const shown = fitList(el, {
    id: meta.id,
    items: rows,
    fallback: 4,
    badge: true,
    draw: (n) => {
      // Alerting lines take priority when truncating (Subway's rule). Drawing
      // fewer than every line IS the truncation, so that is the test.
      ordered = n < rows.length
        ? [...rows].sort((a, b) => Number(a.ok) - Number(b.ok)).slice(0, n)
        : rows;
      el.style.setProperty('--n', String(ordered.length)); // elastic row-gap divisor
      el.innerHTML = ordered
        .map((r, i) => `<div class="tfl ${r.ok ? '' : 'tfl--alert'}${!r.ok && r.reason ? ' tfl--tap' : ''}" data-i="${i}">
        <span class="tfl__dot" style="background:${r.color}"></span>
        <span class="tfl__name">${escapeHtml(r.name)}</span>
        <span class="tfl__status">${escapeHtml(r.status)}</span>
      </div>`)
        .join('');
    },
  });
  const hidden = rows.length - shown;
  // Badge and expansion agree exactly: no badge, no expansion. A card showing
  // every line keeps its per-row reader, which loses nothing.
  const alerting = rows.filter((r) => !r.ok).length;
  const note = alerting ? `${alerting} of ${rows.length} lines with alerts` : `all ${rows.length} lines good`;
  setExpandSource(
    el,
    hidden > 0 ? () => ({ title: meta.title, note, bodyHtml: ledgerBody(tflItems(rows)) }) : null,
  );
  el.querySelectorAll('.tfl--tap').forEach((row) =>
    row.addEventListener('click', () => {
      // One tap, one destination: the ledger carries this reason in full.
      if (defersToExpand(row)) return;
      const r = ordered[Number(row.dataset.i)];
      openTextViewer(`${r.name} — ${r.status}`, r.reason);
    }),
  );
}

export async function fetchData(_cfg, net) {
  return net.fetchJSON(`${WORKER_URL}/tfl/status`);
}
