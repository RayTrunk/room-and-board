// Public cloud-service status, normalized for the Service Status widget.
// Every endpoint is public — no keys, no auth. A whitelisted registry maps
// service ids to their status APIs (never caller-supplied URLs), one small
// mapper per provider family normalizes to
//   { state: 'ok'|'minor'|'major'|'unknown', note, incidents: [{title, since, update}] }
// and a fetch/parse failure reports 'unknown' — a status board must never
// fake green. Shapes were probe-verified live 2026-07-11 and are pinned by
// the recorded fixtures in test/worker/fixtures/svc-*.json.
// See spec docs/superpowers/specs/2026-07-11-service-status-widget-design.md.

import { htmlToText } from './htmltext.js';

// Every string that reaches the widget goes through htmlToText first: several
// of these feeds (Slack notes, Microsoft messages, AWS event logs, some
// Statuspage bodies) publish incident prose as HTML, and the board escapes at
// render time — so an unsanitized tag prints literally on the wall.
// text() for one-liners, clamp() for incident bodies, firstLine() for Google's
// markdown-ish blob. Sanitize BEFORE truncating, so the budget buys real words.
const text = (s) => htmlToText(s);
const clamp = (s) => htmlToText(s).slice(0, 500);
const firstLine = (s) => htmlToText(s).replace(/\*/g, '').split('\n')[0].slice(0, 140);

export function mapStatuspage(json) {
  const ind = json?.status?.indicator;
  const state = ind === 'none' ? 'ok' : ind === 'minor' || ind === 'maintenance' ? 'minor'
    : ind === 'major' || ind === 'critical' ? 'major' : 'unknown';
  return {
    state,
    note: text(json?.status?.description),
    incidents: (json?.incidents ?? []).slice(0, 3).map((i) => ({
      title: text(i.name),
      since: String(i.started_at ?? i.created_at ?? ''),
      update: clamp(i.incident_updates?.[0]?.body),
    })),
  };
}

export function mapSlack(json) {
  const active = json?.active_incidents ?? [];
  if (!active.length) return { state: json?.status === 'ok' ? 'ok' : 'unknown', note: 'All systems operational', incidents: [] };
  return {
    state: active.some((i) => i.type === 'outage') ? 'major' : 'minor',
    note: text(active[0].title ?? 'Active incident'),
    incidents: active.slice(0, 3).map((i) => ({
      title: text(i.title), since: String(i.date_created ?? ''), update: clamp(i.notes?.[0]?.body),
    })),
  };
}

// ---------------------------------------------------------------------------
// Microsoft 365: a two-source composite.
//
// The old portal.office.com/api/servicestatus/index feed (mapMicrosoft, removed
// 2026-08-02) is decommissioned — a permanent hard 404, so the row had been
// reporting "Status unavailable" for every reader. Microsoft's replacement is
// split in two, and neither half alone is the answer an OFFICE needs:
//   * the consumer feed covers Outlook.com, OneDrive, Teams Free — real, but
//     none of it is what a company runs on;
//   * the enterprise picture only exists behind an authenticated Graph call
//     (serviceAnnouncement), which a keyless public worker cannot make.
// So the row reads both: the consumer feed direct, and one tenant's Graph
// health republished as static JSON for the enterprise half. Either source may
// be missing without blanking the row; only losing BOTH reports unknown.

// Severity ordering for "worst of". Only present sources are ranked — an absent
// source is dropped entirely rather than counted as a state.
const RANK = { ok: 0, minor: 1, major: 2 };

// 'serviceDegradation' -> 'service degradation', 'Service degradation' -> same.
// Both feeds' vocabularies land on one phrasing, so the note reads identically
// whichever half of Microsoft reported the trouble.
const humanize = (s) => String(s ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().trim();

// The consumer feed's Status enum. Anything unrecognized is NO SIGNAL: it does
// not degrade the row (a new word is not evidence of an outage) and it does not
// paint green either, since a source that says nothing recognizable about any
// service is treated as absent below.
const CONSUMER_STATE = {
  'operational': 'ok', 'available': 'ok', 'service restored': 'ok', 'resolved': 'ok',
  'service degradation': 'minor',
  'service interruption': 'major',
};

// Microsoft Graph's serviceAnnouncement health enums, as republished by the
// mirror. 'investigating' is Microsoft admitting it does not yet know, which an
// office feels as trouble, so it degrades rather than reads green.
const MIRROR_STATE = {
  serviceoperational: 'ok', servicerestored: 'ok', resolved: 'ok', falsepositive: 'ok',
  postincidentreviewpublished: 'ok', investigationsuspended: 'ok',
  servicedegradation: 'minor', investigating: 'minor',
  extendedrecovery: 'minor', restoringservice: 'minor',
  serviceinterruption: 'major',
};

// The workloads an office actually FEELS. The mirror carries 33 services, most
// of which (Defender, Purview, Intune, Power BI...) are an admin's problem and
// not a reason to paint the board's Microsoft row amber — a permanent yellow
// from some back-office workload would make the signal worthless, the same
// lesson Webex's maintenance filter learned. Non-core trouble still appears in
// incidents; it just does not set the row's state.
// Matched on the mirror's own service names, lowercased and trimmed (its feed
// ships "Microsoft Clipchamp " with a trailing space, so trimming is required).
// 'onedrive for business' is Microsoft's older name for the same workload and
// is accepted in case the mirror reverts to it.
const M365_CORE = new Set([
  'exchange online',
  'microsoft teams',
  'sharepoint online',
  'microsoft onedrive',
  'onedrive for business',
  'microsoft 365 suite',
]);

// Past this age the mirror is not evidence of anything. It republishes on a ~2h
// cadence, so 6h means its publisher has missed several runs — and a stale copy
// must never claim green (the outage may have started after it froze) NOR red
// (the incident may be long resolved). Absent is the honest answer.
const MIRROR_MAX_AGE_MS = 6 * 3600e3;

// One entry per degraded workload, from both halves. Higher than the 3 the
// single-source adapters keep: a real Microsoft incident routinely lights four
// or five workloads at once, and the expanded ledger is exactly where a reader
// goes to see the whole picture.
const M365_INCIDENT_CAP = 6;

// Returns null (source ABSENT) rather than a state when the payload is not the
// shape this feed promises — a top-level ARRAY of service rows. An object here
// means Microsoft reshaped the endpoint, and guessing at a reshaped payload is
// how a status board fakes green.
export function mapM365Consumer(json) {
  if (!Array.isArray(json) || !json.length) return null;
  const rows = json.filter((r) => r && typeof r.Status === 'string' && typeof r.ServiceDisplayName === 'string');
  if (!rows.length) return null;
  const graded = rows
    .map((r) => ({ row: r, state: CONSUMER_STATE[humanize(r.Status)] }))
    .filter((g) => g.state);
  if (!graded.length) return null; // nothing recognizable said about any service
  const bad = graded.filter((g) => g.state !== 'ok').sort((a, b) => RANK[b.state] - RANK[a.state]);
  if (!bad.length) return { state: 'ok', note: 'All systems operational', incidents: [] };
  return {
    state: bad[0].state,
    note: `${text(bad[0].row.ServiceDisplayName)}: ${humanize(bad[0].row.Status)}`,
    incidents: bad.map(({ row }) => ({
      title: `${text(row.ServiceDisplayName)}: ${humanize(row.Status)}`,
      // Deliberately no timestamp: LastUpdatedTime churns on EVERY request
      // (it is the response's own clock, not the incident's), so showing it
      // would tell a reader every outage started seconds ago.
      since: '',
      update: clamp(row.Message || row.Title),
    })),
  };
}

// Returns null (source ABSENT) when unusable: wrong shape, or too old to mean
// anything. nowMs is passed in so the freshness gate is testable.
export function mapM365Mirror(json, nowMs) {
  if (!json || !Array.isArray(json.services) || !json.services.length) return null;
  const generated = Date.parse(json.generated_at);
  if (!Number.isFinite(generated) || nowMs - generated > MIRROR_MAX_AGE_MS) return null;

  const name = (s) => String(s ?? '').trim();
  const graded = json.services
    .map((s) => ({ svc: s, name: name(s.service), state: MIRROR_STATE[humanize(s.status).replace(/ /g, '')] }))
    .filter((g) => g.state && g.name);
  if (!graded.length) return null;

  // An open issue for the same workload carries the prose a reader wants; the
  // services[] row only carries the verdict.
  const open = (json.issues ?? []).filter((i) => i && !i.is_resolved);
  const issueFor = (workload) => open.find((i) => name(i.service).toLowerCase() === workload.toLowerCase());

  // Core workloads lead, then severity. The row's note names the worst core
  // finding, so that same workload must be the first thing a tap reveals —
  // sorting by severity alone put a back-office incident above the Exchange
  // outage the row was actually reporting.
  const isCore = (g) => M365_CORE.has(g.name.toLowerCase());
  const bad = graded.filter((g) => g.state !== 'ok')
    .sort((a, b) => (isCore(b) - isCore(a)) || (RANK[b.state] - RANK[a.state]));
  const core = bad.filter(isCore);
  const incidents = bad.map((g) => {
    const issue = issueFor(g.name);
    return {
      title: `${text(g.name)}: ${humanize(g.svc.status)}`,
      since: String(issue?.start_time ?? ''),
      update: clamp(issue?.impact || issue?.title),
    };
  });
  if (!core.length) return { state: 'ok', note: 'All systems operational', incidents };
  return {
    state: core[0].state,
    note: `${text(core[0].name)}: ${humanize(core[0].svc.status)}`,
    incidents,
  };
}

// Compose the row from whichever halves answered. Either argument may be null
// (that fetch failed) or unusable (guarded above); only losing both reports
// unknown, and an unknown ALWAYS carries a note — a blank one rendered as an
// empty amber line on the board.
export function mapM365(consumerJson, mirrorJson, nowMs) {
  // Mirror first: on an equal-severity tie its note wins, because the workload
  // an office actually feels is the more useful sentence to put on the wall.
  const sources = [mapM365Mirror(mirrorJson, nowMs), mapM365Consumer(consumerJson)].filter(Boolean);
  if (!sources.length) return { state: 'unknown', note: 'Status unavailable', incidents: [] };
  const worst = sources.reduce((a, b) => (RANK[b.state] > RANK[a.state] ? b : a));
  return {
    state: worst.state,
    note: worst.state === 'ok' ? 'All systems operational' : worst.note,
    incidents: sources.flatMap((s) => s.incidents).slice(0, M365_INCIDENT_CAP),
  };
}

export function mapGoogle(json, nowMs) {
  const active = (Array.isArray(json) ? json : []).filter((i) => !i.end || Date.parse(i.end) > nowMs);
  if (!active.length) return { state: 'ok', note: 'All systems operational', incidents: [] };
  return {
    state: 'minor',
    note: firstLine(active[0].external_desc),
    incidents: active.slice(0, 3).map((i) => ({
      title: firstLine(i.external_desc), since: String(i.begin ?? ''),
      update: clamp(i.updates?.[0]?.text ?? i.external_desc),
    })),
  };
}

export function mapWebex(json) {
  // Webex lists routine scheduled maintenance under unResolvedIncidents —
  // permanent yellow would make the signal worthless, so maintenance is not
  // "degraded" here (fixture: 3 open entries, all maintenance → ok).
  const isMaint = (i) => /maintenance/i.test(String(i.impact ?? '')) || /maintenance/i.test(String(i.incidentType ?? ''));
  const open = (json?.unResolvedIncidents ?? []).filter((i) => !i.deleted && !isMaint(i));
  if (!open.length) return { state: 'ok', note: 'All systems operational', incidents: [] };
  return {
    state: open.some((i) => /major|critical|outage/i.test(String(i.impact ?? ''))) ? 'major' : 'minor',
    note: text(open[0].incidentName ?? 'Active incident'),
    incidents: open.slice(0, 3).map((i) => ({
      title: text(i.incidentName), since: String(i.createTime ?? ''), update: clamp(i.impact),
    })),
  };
}

export function mapAws(json, nowMs) {
  // data.json mixes resolved history into the same array (fixture events are
  // months old) — only an event from the last six hours counts as active.
  const RECENT_MS = 6 * 3600e3;
  const events = (Array.isArray(json) ? json : []).filter((e) => nowMs - Number(e.date) * 1000 < RECENT_MS);
  if (!events.length) return { state: 'ok', note: 'All systems operational', incidents: [] };
  return {
    state: 'minor',
    note: `${text(events[0].service_name)}: ${text(events[0].summary)}`,
    incidents: events.slice(0, 3).map((e) => ({
      title: `${text(e.service_name)} (${text(e.region_name)}): ${text(e.summary)}`,
      since: new Date(Number(e.date) * 1000).toISOString(),
      update: clamp(e.event_log?.[e.event_log.length - 1]?.message),
    })),
  };
}

// AWS serves data.json as UTF-16 with a BOM — and it's big-endian (FE FF),
// which a hardcoded 'utf-16le' silently byte-swaps into garbage. Sniff the
// BOM so either endianness (or a future switch to UTF-8) parses correctly.
export function decodeBomJson(buffer) {
  const b = new Uint8Array(buffer);
  const enc = b[0] === 0xFE && b[1] === 0xFF ? 'utf-16be'
    : b[0] === 0xFF && b[1] === 0xFE ? 'utf-16le'
    : 'utf-8';
  return JSON.parse(new TextDecoder(enc).decode(b).replace(/^﻿/, ''));
}

const MAPPERS = { statuspage: mapStatuspage, slack: mapSlack, google: mapGoogle, webex: mapWebex, aws: mapAws };

export const SERVICES = {
  zoom: { label: 'Zoom', adapter: 'statuspage', url: 'https://status.zoom.us/api/v2/summary.json' },
  ubiquiti: { label: 'Ubiquiti', adapter: 'statuspage', url: 'https://status.ui.com/api/v2/summary.json' },
  cloudflare: { label: 'Cloudflare', adapter: 'statuspage', url: 'https://www.cloudflarestatus.com/api/v2/summary.json' },
  github: { label: 'GitHub', adapter: 'statuspage', url: 'https://www.githubstatus.com/api/v2/summary.json' },
  slack: { label: 'Slack', adapter: 'slack', url: 'https://status.slack.com/api/v2.0.0/current' },
  // Two URLs, one row (see the m365 block above). The mirror is fetched at its
  // www host on purpose: the bare domain 301s, and paying for a redirect on
  // every cache miss is a needless round trip.
  m365: {
    label: 'Microsoft 365',
    adapter: 'm365',
    urls: [
      'https://status.cloud.microsoft/api/posts/m365Consumer',
      'https://www.aguidetocloud.com/data/service-health/latest.json',
    ],
  },
  gworkspace: { label: 'Google Workspace', adapter: 'google', url: 'https://www.google.com/appsstatus/dashboard/incidents.json' },
  webex: { label: 'Webex', adapter: 'webex', url: 'https://service-status.webex.com/customer/dashServices/891?commercial=true' },
  aws: { label: 'AWS', adapter: 'aws', url: 'https://status.aws.amazon.com/data.json' },
  claude: { label: 'Claude', adapter: 'statuspage', url: 'https://status.claude.com/api/v2/summary.json' },
  // incident.io statuspage-compat feed: same shape, but no `incidents` key —
  // the adapter's ?? [] fallback covers it (state still tracks the indicator).
  openai: { label: 'OpenAI', adapter: 'statuspage', url: 'https://status.openai.com/api/v2/summary.json' },
};

// Full browser UA: CloudFront (AWS's status CDN) rejects thin/bot agents
// from datacenter egress — same lesson as the Yahoo markets fetch.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// A failed fetch gets two quick retries before the row reports unknown: these
// endpoints alternate 200/error on back-to-back requests often enough that one
// bad roll would otherwise paint "Status unavailable" for a whole cache TTL.
// Retries run on a shorter timeout so a genuinely dead feed can't hold the
// digest hostage for 30s, with a beat between attempts — an instant retry
// against a rate-limiting or mid-failover upstream just draws the same error
// three times (the lesson f1.js serialization learned).
//
// Parsing happens INSIDE the loop, which is the point: Microsoft's hosts answer
// 200 with an HTML error/consent page more often than they answer with a bad
// status code, and a parse that lived after the loop turned that into an
// unretried 'unknown'. A body that isn't the JSON we asked for is a failed
// attempt like any other, so it retries.
const RETRY_PAUSE_MS = 250;

async function fetchJson(url, { binary = false } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(attempt ? 5000 : 10000),
        headers: { 'User-Agent': UA },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Only HTML is rejected up front, not "anything that isn't application/
      // json": AWS serves its JSON as charset=utf-16 and a stricter gate would
      // break feeds that are merely sloppy about the header. A wrong body still
      // fails at the parse below.
      const ctype = res.headers.get('content-type') ?? '';
      if (/text\/html/i.test(ctype)) throw new Error(`HTML body (content-type ${ctype})`);
      // AWS is UTF-16-with-BOM (see decodeBomJson); everything else is plain JSON.
      return binary ? decodeBomJson(await res.arrayBuffer()) : await res.json();
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
    }
  }
  throw lastErr;
}

async function fetchOne(id) {
  const svc = SERVICES[id];
  if (svc.adapter === 'm365') {
    // Both halves in parallel, each with its own retries; either may come back
    // null without blanking the row (mapM365 composes whatever answered).
    const [consumer, mirror] = await Promise.all(
      svc.urls.map((u) => fetchJson(u).catch((e) => {
        console.warn(`[svcstatus] m365 source failed (${u}): ${String(e?.message ?? e)}`);
        return null;
      })),
    );
    return { id, label: svc.label, ...mapM365(consumer, mirror, Date.now()) };
  }
  const json = await fetchJson(svc.url, { binary: svc.adapter === 'aws' });
  return { id, label: svc.label, ...MAPPERS[svc.adapter](json, Date.now()) };
}

export async function fetchServiceStatuses(ids) {
  const settled = await Promise.allSettled(ids.map((id) => fetchOne(id)));
  const services = settled.map((s, i) => (s.status === 'fulfilled' ? s.value
    : { id: ids[i], label: SERVICES[ids[i]].label, state: 'unknown', note: 'Status unavailable', incidents: [] }))
    // An unknown row ALWAYS says why. The card prints .svc__note in amber under
    // an unknown state, so a mapper that returned a blank note (an unrecognized
    // schema used to) drew an empty amber line and told the reader nothing.
    .map((s) => (s.state === 'unknown' && !s.note ? { ...s, note: 'Status unavailable' } : s));
  if (services.every((s) => s.state === 'unknown')) throw new Error('all services unavailable');
  // One dead upstream makes the digest PARTIAL. Without this flag the whole
  // digest cached at the route's full TTL and overwrote the 24h backup with a
  // copy carrying an unknown row, so a single flaky provider erased the very
  // history the mend below borrows from (same failure the F1 card hit).
  const partial = services.some((s) => s.state === 'unknown');
  return { updatedAt: Math.floor(Date.now() / 1000), stale: false, services, ...(partial && { partial: true }) };
}

// How old a backup row may be and still stand in for an unknown one. NOT the
// backup's own 24h lifetime: this file's rule is that a status board never
// fakes green, and a day-old "operational" is fiction — the outage it would
// paper over could have started 23 hours ago. An hour is the window where "what
// it said last time we could reach it" is still a fair answer for a reader.
export const MEND_MAX_AGE_S = 3600;

// Fill a partial digest's unknown rows from the 24h backup, per service id. A
// whole card of grey because one provider bounced is a worse lie than a row
// that is one poll behind. Keeps partial: true (short cache, never overwrites
// the backup it borrowed from) and adds mended: true for diagnosability.
export function mendServiceStatuses(fresh, stale) {
  const age = Math.floor(Date.now() / 1000) - Number(stale?.updatedAt);
  if (!Number.isFinite(age) || age > MEND_MAX_AGE_S) return fresh;
  const backup = new Map((stale?.services ?? []).map((s) => [s.id, s]));
  const services = (fresh?.services ?? []).map((s) => {
    if (s.state !== 'unknown') return s;
    const b = backup.get(s.id);
    return b && b.state !== 'unknown' ? { ...b } : s;
  });
  return { ...fresh, services, mended: true };
}
