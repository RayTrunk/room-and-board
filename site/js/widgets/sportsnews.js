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

// The sport chips, in Sean's order. Empty selection means all sports: the
// outlet top-news feeds, exactly the card's original behavior.
export const SPORTS = [
  ['mlb', 'MLB'], ['nfl', 'NFL'], ['nba', 'NBA'], ['nhl', 'NHL'],
  ['mls', 'MLS'], ['f1', 'F1'], ['golf', 'Golf'], ['tennis', 'Tennis'],
];

// (sport -> outlet -> worker proxy id), LIVE-VERIFIED cells only (2026-07-31,
// probed through the worker's exact fetch: item counts and final hosts).
// ESPN has no row anywhere: its per-sport feeds answer HTTP 202 with empty
// bodies (a bot queue), twice, so ESPN contributes only to all-sports mode.
// CBS and Yahoo carry no F1 or MLS feeds. BBC names the sports, not the
// leagues (baseball, american-football...), which is why its ids diverge.
// `epl` is not a chip: it exists because My Teams carries EPL clubs and the
// my-teams takeover must be able to source their league.
export const SPORT_FEEDS = {
  mlb: { 'cbs-sports': 'cbs-sports-mlb', 'yahoo-sports': 'yahoo-sports-mlb', 'the-athletic': 'the-athletic-mlb', 'bbc-sport': 'bbc-sport-mlb', 'guardian-sport': 'guardian-sport-mlb' },
  nfl: { 'cbs-sports': 'cbs-sports-nfl', 'yahoo-sports': 'yahoo-sports-nfl', 'the-athletic': 'the-athletic-nfl', 'bbc-sport': 'bbc-sport-nfl', 'guardian-sport': 'guardian-sport-nfl' },
  nba: { 'cbs-sports': 'cbs-sports-nba', 'yahoo-sports': 'yahoo-sports-nba', 'the-athletic': 'the-athletic-nba', 'bbc-sport': 'bbc-sport-nba', 'guardian-sport': 'guardian-sport-nba' },
  nhl: { 'cbs-sports': 'cbs-sports-nhl', 'yahoo-sports': 'yahoo-sports-nhl', 'the-athletic': 'the-athletic-nhl', 'bbc-sport': 'bbc-sport-nhl', 'guardian-sport': 'guardian-sport-nhl' },
  mls: { 'the-athletic': 'the-athletic-mls', 'guardian-sport': 'guardian-sport-mls' },
  f1: { 'the-athletic': 'the-athletic-f1', 'bbc-sport': 'bbc-sport-f1', 'guardian-sport': 'guardian-sport-f1' },
  golf: { 'cbs-sports': 'cbs-sports-golf', 'yahoo-sports': 'yahoo-sports-golf', 'the-athletic': 'the-athletic-golf', 'bbc-sport': 'bbc-sport-golf', 'guardian-sport': 'guardian-sport-golf' },
  tennis: { 'cbs-sports': 'cbs-sports-tennis', 'yahoo-sports': 'yahoo-sports-tennis', 'the-athletic': 'the-athletic-tennis', 'bbc-sport': 'bbc-sport-tennis', 'guardian-sport': 'guardian-sport-tennis' },
  epl: { 'the-athletic': 'the-athletic-epl', 'guardian-sport': 'guardian-sport-epl' },
};

// Sport/league display names for the takeover note in Settings.
const LEAGUE_LABELS = { ...Object.fromEntries(SPORTS), epl: 'Premier League' };
export const takeoverSummary = (leagues) =>
  leagues.map((l) => LEAGUE_LABELS[l] ?? l.toUpperCase()).join(', ');

// The fetch pool: outlet top feeds while no sports are picked, else each
// picked sport's feeds across the enabled outlets. A cell an outlet does not
// publish simply contributes nothing.
export function resolveFeedIds(outlets, sports) {
  const picked = (sports ?? []).filter((s) => s in SPORT_FEEDS);
  if (!picked.length) return [...outlets];
  return picked.flatMap((sp) => outlets.map((o) => SPORT_FEEDS[sp][o]).filter(Boolean));
}

const SOURCE_BY_ID = Object.fromEntries(SPORTS_SOURCES.map((s) => [s[0], s]));
// Per-sport feed ids resolve to their outlet's label, so the card's meta line
// reads the outlet name either way.
const OUTLET_LABEL = Object.fromEntries(SPORTS_SOURCES.map((s) => [s[0], s[1]]));
for (const feeds of Object.values(SPORT_FEEDS)) {
  for (const [outlet, id] of Object.entries(feeds)) {
    SOURCE_BY_ID[id] = [id, OUTLET_LABEL[outlet], 'proxy', id];
  }
}

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

async function followedTeams(cfg, net) {
  const picked = cfg?.sports?.teams ?? [];
  if (!picked.length) return { phrases: [], leagues: [] };
  try {
    roster ??= await net.fetchJSON('data/teams.json');
  } catch {
    return { phrases: [], leagues: [] }; // no roster, no filter: an unfiltered card beats an empty one
  }
  const byKey = new Map();
  for (const l of roster?.leagues ?? []) for (const t of l.teams ?? []) byKey.set(`${l.lg}:${t.id}`, t);
  const leagues = [...new Set(picked.map((sel) => sel.lg))].filter((l) => l in SPORT_FEEDS);
  return { phrases: picked.flatMap((sel) => teamPhrases(byKey.get(`${sel.lg}:${sel.id}`))), leagues };
}

export async function fetchData(cfg, net) {
  const outlets = cfg?.sportsnews?.sources?.length ? cfg.sportsnews.sources : DEFAULT_SPORTS_SOURCES;
  // The roster read only happens for a board that both follows teams AND has
  // the switch on, so an unfiltered card costs exactly what Markets News costs.
  const { phrases, leagues } = cfg?.sportsnews?.onlyMyTeams
    ? await followedTeams(cfg, net)
    : { phrases: [], leagues: [] };
  // THE TAKEOVER (Sean, 2026-07-31): with teams resolved, Only-my-teams owns
  // the sports dimension — the pool becomes the teams' league feeds (denser in
  // team stories than top-news) and the chips are ignored. Per OUTLET, though:
  // an outlet with no feed for any of the leagues (ESPN) keeps its top feed,
  // its exact pre-takeover contribution, so an ESPN-only board never resolves
  // to an empty pool. Otherwise the chips rule, and no chips means the outlet
  // top feeds.
  const ids = phrases.length
    ? outlets.flatMap((o) => {
        const perLeague = leagues.map((l) => SPORT_FEEDS[l]?.[o]).filter(Boolean);
        return perLeague.length ? perLeague : [o];
      })
    : resolveFeedIds(outlets, cfg?.sportsnews?.sports ?? []);
  const vm = await fetchHeadlines(ids, SOURCE_BY_ID, net,
    phrases.length ? { filter: (i) => matchesTeams(i, phrases) } : {});
  // `filtered` is what the card renders its empty state from: the switch alone
  // is not enough, since with no teams picked it has nothing to filter by.
  return { ...vm, teams: phrases, filtered: phrases.length > 0, takeoverLeagues: phrases.length ? leagues : [] };
}
