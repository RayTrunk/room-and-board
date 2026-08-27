// Cloud Services: subway-board-style rows for the cloud services the office
// depends on, from their public status pages via the Worker's whitelisted
// /services/status proxy. A tap anywhere on the card opens the full-screen
// ledger; rows are not individual targets. Rows sort worst-first (see
// SEVERITY) so a problem survives the capacity slice.

import { escapeHtml, fmtClock, setupPrompt } from '../util.js';
import { setCardNote } from '../card.js';
import { WORKER_URL } from '../env.js';
import { fitList } from '../capacity.js';
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


// The prose a degraded row's tap reveals, as ledger notes. Same source the
// reader reads — the status page's real incidents when it lists any, the
// one-line summary note when it does not — so the expansion shows everything
// the per-row reader used to and nothing is lost to the deferral.
// An advisory line is deliberately terse: the workload, Microsoft's own feature
// name for the thing that is off ('Mailbox Migrations', 'Teams and Channels'),
// and the date it opened. No prose, because the whole point of the group is
// that these are the items a reader does NOT need to act on today; the count
// and the age are the information.
const shortDate = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t)
    ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric' })
    : '';
};

export function serviceAdvisories(s) {
  return (s.advisories ?? []).map((a) => ({
    text: [a.service || a.title, a.feature].filter(Boolean).join(' \u00b7 '),
    meta: shortDate(a.since),
  }));
}

// "5 open \u00b7 oldest Aug 19". The age is the honest part: it is what tells a
// reader these are a standing backlog rather than this morning's news.
export function advisoryNote(s) {
  const rows = s.advisories ?? [];
  if (!rows.length) return '';
  const times = rows.map((a) => Date.parse(a.since)).filter(Number.isFinite);
  const oldest = times.length ? shortDate(new Date(Math.min(...times)).toISOString()) : '';
  return `${rows.length} open${oldest ? ` \u00b7 oldest ${oldest}` : ''}`;
}

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
  // Microsoft's long-running advisories, kept out of the state entirely (see
  // the classification split in the Worker) but still reachable here.
  advisories: serviceAdvisories(s),
  advisoriesNote: advisoryNote(s),
}));

export function render(el, vm, cfg) {
  // Freshness note in the card header (worker check time, not render time) —
  // a clock reading, so it honors cfg.clock24.
  if (vm.updatedAt) setCardNote(el, `as of ${fmtClock(vm.updatedAt, cfg?.clock24)}`);
  // Severity-ordered once, up front: every slice, the +N count and the ledger
  // the expansion builds all read this same array, so they stay in sync.
  const all = bySeverity(vm.services ?? []);
  if (!all.length) {
    el.innerHTML = setupPrompt('services', 'pick services', 'Cloud Services');
    setExpandSource(el, null); // an unconfigured card taps into Settings, never an empty ledger
    return;
  }
  // The amber lines under a degraded row. Sean's pick 2026-08-02 (mockup A,
  // "Every line"): a service reporting several incidents lists EVERY one of
  // them, a line each, rather than the single summary note — when Microsoft has
  // Exchange, Teams and the suite all degraded, the board says so without a tap.
  // The titles arrive worker-sorted (core workloads first, then severity) and
  // worker-capped (6 for m365, 3 elsewhere), so they render in the order given:
  // no re-sorting here, and no cap of our own beyond the overflow backstop.
  // `maxLines` is that backstop (0 = no cap) and cuts from the BOTTOM, which is
  // where the least important incident already sits. A service with no incident
  // list keeps its one summary line, which is what an unknown row (a failed
  // status fetch, "Status unavailable") always has.
  const noteLines = (s, maxLines = 0) => {
    if (s.state === 'ok') return [];
    const titles = (s.incidents ?? []).map((i) => i.title).filter(Boolean);
    const lines = titles.length ? titles : (s.note ? [s.note] : []);
    return maxLines > 0 ? lines.slice(0, maxLines) : lines;
  };
  const rowHtml = (s, i, dropNote, maxLines) => `<div class="svc">
        <div class="svc__row">
          <span class="svc__name ${s.state === 'minor' || s.state === 'major' ? 'svc__name--alert' : ''}">${escapeHtml(s.label)}</span>
          <span class="svc__state svc__state--${escapeHtml(s.state)}">${STATE_LABEL[s.state] ?? escapeHtml(s.state)}</span>
        </div>
        ${dropNote ? '' : noteLines(s, maxLines).map((t) => `<div class="svc__note">${escapeHtml(t)}</div>`).join('')}
      </div>`;
  // Markup for the first n rows. The overflow count rides the corner badge,
  // which the fit stamps, so it costs no row. dropLastNote drops the final
  // row's incident notes — ALL of them, now that a row can carry several — to
  // spend leftover slack on one more service the tap still explains in full.
  const build = (n, dropLastNote = false, maxLines = 0) =>
    all.slice(0, n).map((s, i) => rowHtml(s, i, dropLastNote && i === n - 1, maxLines)).join('');
  // Stamp the elastic row-gap divisor with every rebuild so the gap math
  // tracks the rows actually shown as the trim/grow loops move n.
  const apply = (n, dropLastNote = false, maxLines = 0) => {
    el.style.setProperty('--n', String(n));
    el.innerHTML = build(n, dropLastNote, maxLines);
  };
  // Fill-to-fit: the static estimate reserves worst-case (two-line degraded)
  // height per row, but most rows are one-line "Operational", so the card
  // usually has room for more. Grow/shrink to what actually fits, and spend the
  // last of the slack on one more service drawn without its notes (the tap
  // still reveals them).
  const n = fitList(el, {
    id: meta.id,
    items: all,
    defaultSize: [3, 4],
    fallback: 5,
    measure: true,
    squeeze: true,
    badge: true,
    draw: apply,
  });
  // The floor's backstop, and the one thing the fit cannot do for this card:
  // shedding rows stops at one, but ONE service can be several lines tall on
  // its own, so a small card holding a six-incident Microsoft still clips with
  // nothing left to drop. Shed that row's note lines from the bottom, one at a
  // time, until the card fits — keeping at least one, so a degraded row never
  // goes silent. It runs AFTER the fit because every loop in there re-renders
  // from scratch and would undo the trim; by here the count is settled, and
  // one row is the only state that can still be overflowing (the grow and
  // squeeze steps revert themselves).
  // Trimmed LINES are not hidden SERVICES: the +N badge counts services only,
  // so this cannot desync the badge from the expansion, and the tap (or the
  // expansion) still shows every incident in full.
  if (n === 1 && el.clientHeight > 0 && el.scrollHeight > el.clientHeight) {
    let lines = noteLines(all[0]).length;
    while (lines > 1 && el.scrollHeight > el.clientHeight) {
      lines -= 1;
      apply(n, false, lines);
    }
  }
  const hidden = all.length - n;
  // The card ALWAYS opens (Sean 2026-08-27), which is the rule the board
  // already teaches: every card opens, and expandability is never per-card
  // chrome. This one used to follow "no badge, no expansion" and keep a
  // per-row reader when nothing overflowed, which cost two things. A reader
  // had to learn that one card sometimes answers a row tap and sometimes the
  // whole card, and the ledger is where Microsoft's advisories live, so a
  // card that happened to fit every service could not reach them at all.
  //
  // Nothing is lost with the per-row reader gone: it showed ONE service's
  // prose, and the ledger shows every service's prose uncut, including the
  // note the card clamps to a single line. The badge still counts only what
  // overflowed, so badge and expansion no longer agree — the badge is pure
  // information about hidden ROWS, which is what it always claimed to be.
  // The closure captures THIS render's list, so the ledger always shows what
  // the card was showing when it was tapped.
  const trouble = all.filter((s) => s.state !== 'ok').length;
  const note = [
    trouble ? `${trouble} of ${all.length} reporting issues` : `all ${all.length} operational`,
    vm.updatedAt ? `as of ${fmtClock(vm.updatedAt, cfg?.clock24)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  setExpandSource(el, () => ({ title: meta.title, note, bodyHtml: ledgerBody(serviceItems(all)) }));
}

export async function fetchData(cfg, net) {
  const ids = cfg.services?.list?.length ? cfg.services.list : DEFAULT_SERVICES;
  return net.fetchJSON(`${WORKER_URL}/services/status?ids=${ids.join(',')}`);
}
