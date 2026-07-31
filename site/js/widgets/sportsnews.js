// Sports headlines from selectable outlets, with an optional filter down to the
// teams the board already follows in My Teams. Reuses the shared news engine
// (newscore.js); none of these outlets send CORS headers, so all of them go
// through the Worker's whitelist proxy.
import { renderHeadlines, fetchHeadlines } from './newscore.js';
import { viaSettings } from '../util.js';

export const meta = { id: 'sportsnews', title: 'Sports News', refreshMs: 10 * 60 * 1000 };

// [id, label, kind, url-or-proxy-id, scope]
//
// NYT Sports is deliberately absent: rss.nytimes.com/…/Sports.xml still builds
// every hour but has carried ZERO items since April 2025 (verified 2026-07-31),
// so it would be a source that silently contributes nothing. AP, Fox, Sports
// Illustrated and Bleacher Report were checked the same way and all four now
// serve HTML or an empty document at their old feed URLs.
export const SPORTS_SOURCES = [
  ['espn', 'ESPN', 'proxy', 'espn', 'US'],
  ['cbs-sports', 'CBS Sports', 'proxy', 'cbs-sports', 'US'],
  ['yahoo-sports', 'Yahoo Sports', 'proxy', 'yahoo-sports', 'US'],
  // NYT folded its sports desk into The Athletic (which is why the NYT Sports
  // feed is absent: it has been an empty shell since April 2025). The
  // Athletic's feed is served from nytimes.com; theathletic.com redirects
  // there and answers inconsistently when hit directly, so the worker
  // whitelist pins the nytimes.com URL.
  ['the-athletic', 'The Athletic', 'proxy', 'the-athletic', 'US'],
  ['bbc-sport', 'BBC Sport', 'proxy', 'bbc-sport', 'World'],
  ['guardian-sport', 'Guardian Sport', 'proxy', 'guardian-sport', 'World'],
];
// The two international feeds start off: both are mostly football and cricket,
// and a board following US leagues would spend most of its rows on neither.
export const DEFAULT_SPORTS_SOURCES = ['espn', 'cbs-sports', 'yahoo-sports', 'the-athletic'];
const SOURCE_BY_ID = Object.fromEntries(SPORTS_SOURCES.map((s) => [s[0], s]));

// The phrases one teams.json entry may be named by in a headline.
//
// `nick` is ESPN's shortDisplayName, which is what a headline usually prints
// ('Red Sox', 'Spurs', 'Man United'); the full display name almost never
// appears. EXCEPT in MLS, where the short name is the bare city ('Seattle' for
// Seattle Sounders FC): following the Sounders would then claim every Seahawks
// and Mariners story on the board. Every one of those bare-city nicks is a
// PREFIX of the full name and no real nickname is, so dropping the prefix case
// separates them without a hand-kept exception list.
export function teamPhrases(team) {
  const name = team?.name;
  if (!name) return [];
  const nick = team.nick;
  if (!nick || name.toLowerCase().startsWith(nick.toLowerCase())) return [name];
  return [name, nick];
}

// Whole-word, case-insensitive containment over the headline and its summary.
// Lookarounds rather than \b so club names ending in punctuation ('D.C.
// United') still anchor correctly. Compiled once per phrase: this runs over
// every item of every feed, not just the ones that reach the card.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RE_CACHE = new Map();
const phraseRe = (p) => {
  let re = RE_CACHE.get(p);
  if (!re) RE_CACHE.set(p, (re = new RegExp(`(?<![a-z0-9])${escapeRe(p)}(?![a-z0-9])`, 'i')));
  return re;
};
export function matchesTeams(item, phrases) {
  if (!phrases?.length) return true;
  const hay = `${item.title ?? ''} ${item.desc ?? ''}`;
  return phrases.some((p) => phraseRe(p).test(hay));
}

export function render(el, vm, _cfg) {
  // Two different empties, and they want different fixes: a card the filter
  // emptied points at the filter, not at the source picker.
  const emptyHint = vm?.filtered
    ? `Nothing about your teams right now. Tap here to turn off Only my teams, or ${viaSettings('Sports News')}`
    : `No sports news yet. Tap here to pick sources or ${viaSettings('Sports News')}`;
  renderHeadlines(el, vm, { widgetId: 'sportsnews', emptyHint });
}

// data/teams.json is a static ~19KB roster and the only place a followed
// {lg, id} pair becomes a NAME. Memoized: one read per boot, not one per
// refresh cycle.
let roster = null;

async function followedPhrases(cfg, net) {
  const picked = cfg?.sports?.teams ?? [];
  if (!picked.length) return [];
  try {
    roster ??= await net.fetchJSON('data/teams.json');
  } catch {
    return []; // no roster, no filter: an unfiltered card beats an empty one
  }
  const byKey = new Map();
  for (const l of roster?.leagues ?? []) for (const t of l.teams ?? []) byKey.set(`${l.lg}:${t.id}`, t);
  return picked.flatMap((sel) => teamPhrases(byKey.get(`${sel.lg}:${sel.id}`)));
}

export async function fetchData(cfg, net) {
  const ids = cfg?.sportsnews?.sources?.length ? cfg.sportsnews.sources : DEFAULT_SPORTS_SOURCES;
  // The roster read only happens for a board that both follows teams AND has
  // the switch on, so an unfiltered card costs exactly what Markets News costs.
  const teams = cfg?.sportsnews?.onlyMyTeams ? await followedPhrases(cfg, net) : [];
  const vm = await fetchHeadlines(ids, SOURCE_BY_ID, net,
    teams.length ? { filter: (i) => matchesTeams(i, teams) } : {});
  // `filtered` is what the card renders its empty state from: the switch alone
  // is not enough, since with no teams picked it has nothing to filter by.
  return { ...vm, teams, filtered: teams.length > 0 };
}
