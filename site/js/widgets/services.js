// Cloud Services: subway-board-style rows for the cloud services the office
// depends on, from their public status pages via the Worker's whitelisted
// /services/status proxy. Degraded rows are tappable — the existing
// full-screen text viewer shows the incident detail. Rows sort worst-first
// (see SEVERITY) so a problem survives the capacity slice.

import { escapeHtml, fmtClock, setCardNote, setMoreBadge, setupPrompt } from '../util.js';
import { WORKER_URL } from '../env.js';
import { itemCapacity, cardSize } from '../capacity.js';
import { openTextViewer, defersToExpand } from '../textviewer.js';
import { setExpandSource } from '../expand.js';
import { ledgerBody } from '../ledger.js';

export const meta = { id: 'services', title: 'Cloud Services', refreshMs: 5 * 60 * 1000 };

// [id, label] pairs for the settings pickers; ids mirror the Worker registry.
export const SERVICE_CHOICES = [
  ['webex', 'Webex'],
  ['zoom', 'Zoom'],
  ['slack', 'Slack'],
  ['ubiquiti', 'Ubiquiti'],
  ['cloudflare', 'Cloudflare'],
  ['github', 'GitHub'],
  ['m365', 'Microsoft 365'],
  ['gworkspace', 'Google Workspace'],
  ['aws', 'AWS'],
  ['claude', 'Claude'],
  ['openai', 'OpenAI'],
];
export const DEFAULT_SERVICES = ['webex', 'slack', 'm365']; // mirrors DEFAULT_CONFIG.services.list

const STATE_LABEL = { ok: 'Operational', minor: 'Minor issue', major: 'Major outage', unknown: 'Unknown' };

// Trouble first, the way the subway wall floats alerting lines above Good
// Service: a long list gets sliced to the card's capacity, and the row that
// matters must not be the one the +N badge eats. 'unknown' is a failed status
// fetch (the Worker never fakes green) — it MIGHT be a problem, so it outranks
// Operational, but it is not a confirmed one, so it stays below major/minor.
// A state this map has never heard of is treated as unknown for that same
// reason. The widget already renders unknown as its own thing (tappable, note
// shown, but no alert-red name), and this ranking follows that middle reading.
const SEVERITY = { major: 0, minor: 1, unknown: 2, ok: 3 };
const severity = (s) => SEVERITY[s?.state] ?? SEVERITY.unknown;

// Array#sort is stable, so services of equal severity keep the user's chosen
// config order — the tiebreak is "the order you picked", and an all-quiet board
// renders exactly as it did before. Sorted before the capacity slice, so the
// ordering decides who makes the cut, not just who sits where.
export const bySeverity = (services) => [...services].sort((a, b) => severity(a) - severity(b));

// "since Jul 11, 10:12 AM" — the ledger's phrasing, set as its own quiet span
// beside the incident title. The reader spells the same fact with a leading
// dash; here the dash goes and the WORD stays, because the word is what says
// what the date means. A bare stamp trailing a headline reads as noise.
const sinceText = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t)
    ? `since ${new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
    : '';
};

// The text reader's own phrasing, which joins the stamp onto the incident title
// with a dash. Byte-for-byte what it always was: a card with nothing hidden is
// not expandable, so its rows still open the reader and this is still what
// they say.
const sinceLabel = (iso) => {
  const text = sinceText(iso);
  return text ? ` — ${text}` : '';
};

// The prose a degraded row's tap reveals, as ledger notes. Same source the
// reader reads — the status page's real incidents when it lists any, the
// one-line summary note when it does not — so the expansion shows everything
// the per-row reader used to and nothing is lost to the deferral.
export function serviceNotes(s) {
  if (s.incidents?.length) {
    return s.incidents.map((i) => ({ text: i.title ?? '', meta: sinceText(i.since), more: i.update ?? '' }));
  }
  return s.note ? [{ text: s.note, meta: '', more: '' }] : [];
}

// Every configured service as a ledger item, in the order the CARD sorts them
// (bySeverity: major, minor, unknown, then operational). Trouble leads with its
// prose; the operational tail is the quiet two-column group.
//
// `tone` is what colours the state word, and it keeps the card's three-way
// reading: --bad for a confirmed outage, --warn for a minor one, and --warn
// again for unknown, because the card has always said "Status unavailable" in
// amber under an unknown row (.svc__note) even while its state word rested
// quiet. This surface has no second line to carry that amber, so the state
// word takes it. Unknown stays out of --bad: a failed status fetch is a "might
// be" and never a confirmed outage. The name is left at the shared lead weight
// for every item, so the alarm lives in exactly one place.
const TONE = { minor: 'minor', major: 'major' };
export const serviceItems = (all) => all.map((s) => ({
  name: s.label,
  state: STATE_LABEL[s.state] ?? s.state,
  alert: s.state !== 'ok',
  // Anything non-ok that is not a CONFIRMED problem tones as unknown, which is
  // the same reading bySeverity takes of a state it has never heard of. That
  // keeps the class to one of three known values, so a junk state out of a
  // status page can never invent a selector.
  tone: s.state === 'ok' ? '' : (TONE[s.state] ?? 'unknown'),
  notes: serviceNotes(s),
}));

export function render(el, vm, cfg) {
  // Freshness note in the card header (worker check time, not render time) —
  // a clock reading, so it honors cfg.clock24.
  if (vm.updatedAt) setCardNote(el, `as of ${fmtClock(vm.updatedAt, cfg?.clock24)}`);
  // Severity-ordered once, up front: every slice, the +N count and the tap
  // handler's data-svc index all read this same array, so they stay in sync.
  const all = bySeverity(vm.services ?? []);
  if (!all.length) {
    el.innerHTML = setupPrompt('services', 'pick services', 'Cloud Services');
    setExpandSource(el, null); // an unconfigured card taps into Settings, never an empty ledger
    return;
  }
  const rowHtml = (s, i, dropNote) => `<div class="svc ${s.state !== 'ok' ? 'svc--tap' : ''}" data-svc="${i}">
        <div class="svc__row">
          <span class="svc__name ${s.state === 'minor' || s.state === 'major' ? 'svc__name--alert' : ''}">${escapeHtml(s.label)}</span>
          <span class="svc__state svc__state--${escapeHtml(s.state)}">${STATE_LABEL[s.state] ?? escapeHtml(s.state)}</span>
        </div>
        ${!dropNote && s.state !== 'ok' && s.note ? `<div class="svc__note">${escapeHtml(s.note)}</div>` : ''}
      </div>`;
  // Markup for the first n rows. The overflow count rides the title badge
  // (setMoreBadge below), so it costs no row. dropLastNote drops the final
  // row's incident note to spend leftover slack (the note is one line taller).
  const build = (n, dropLastNote = false) =>
    all.slice(0, n).map((s, i) => rowHtml(s, i, dropLastNote && i === n - 1)).join('');
  // Stamp the elastic row-gap divisor with every rebuild so the gap math
  // tracks the rows actually shown as the trim/grow loops move n.
  const apply = (n, dropLastNote = false) => {
    el.style.setProperty('--n', String(n));
    el.innerHTML = build(n, dropLastNote);
  };
  // Static estimate from the capacity model — the final answer when there's no
  // rendered box to measure (happy-dom tests).
  const [w, h] = cardSize(el, [3, 4]);
  const cap = itemCapacity('services', w, h) ?? 5;
  let n = Math.min(all.length, cap);
  apply(n);
  // Fill-to-fit: the static estimate reserves worst-case (two-line degraded)
  // height per row, but most rows are one-line "Operational", so the card
  // usually has room for more. Grow/shrink to what actually fits.
  if (el.clientHeight > 0) {
    while (n > 1 && el.scrollHeight > el.clientHeight) { n -= 1; apply(n); }
    while (n < all.length) {
      n += 1;
      apply(n);
      if (el.scrollHeight > el.clientHeight) { n -= 1; apply(n); break; }
    }
    // Rows fit whole, so a degraded row's note-line of slack can sit empty.
    // Spend it: show one more service without its note (tap still reveals it).
    if (n < all.length) {
      n += 1;
      apply(n, true);
      if (el.scrollHeight > el.clientHeight) { n -= 1; apply(n); }
    }
  }
  const hidden = all.length - n;
  setMoreBadge(el, hidden);
  // The corner badge and the expansion must agree exactly: no badge, no
  // expansion (the subway/rail contract). A card showing every service keeps
  // its per-row reader instead, which loses nothing — the reader shows that
  // one service's prose in full, and there is no hidden row to reveal.
  // The closure captures THIS render's list, so the ledger always shows what
  // the card was showing when it was tapped.
  const trouble = all.filter((s) => s.state !== 'ok').length;
  const note = [
    trouble ? `${trouble} of ${all.length} reporting issues` : `all ${all.length} operational`,
    vm.updatedAt ? `as of ${fmtClock(vm.updatedAt, cfg?.clock24)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  setExpandSource(
    el,
    hidden > 0 ? () => ({ title: meta.title, note, bodyHtml: ledgerBody(serviceItems(all)) }) : null,
  );
  // Tap a degraded row for the full incident picture (existing text viewer;
  // 20s idle auto-dismiss keeps an abandoned board on the dashboard). Attached
  // once on the settled DOM; data-svc indexes into the full services array.
  el.querySelectorAll('.svc--tap').forEach((row) =>
    row.addEventListener('click', () => {
      // One tap, one destination. On an expandable card the ledger shows this
      // very prose, uncut, alongside every other service — so the row tap
      // defers and lets the card's own expansion take it.
      if (defersToExpand(row)) return;
      const s = all[Number(row.dataset.svc)];
      const items = s.incidents?.length ? s.incidents : [{ title: s.note, since: '', update: '' }];
      const body = items
        .map((i) => `${i.title}${sinceLabel(i.since)}${i.update ? `\n${i.update}` : ''}`)
        .join('\n\n');
      openTextViewer(`${s.label} — ${STATE_LABEL[s.state] ?? s.state}`, body);
    }),
  );
}

export async function fetchData(cfg, net) {
  const ids = cfg.services?.list?.length ? cfg.services.list : DEFAULT_SERVICES;
  return net.fetchJSON(`${WORKER_URL}/services/status?ids=${ids.join(',')}`);
}
