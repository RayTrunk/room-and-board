// RSS proxy for outlets without CORS headers. Whitelisted feeds only; the
// body is returned as text and parsed on the page.

const FEEDS = {
  gothamist: 'https://gothamist.com/feed',
  npr: 'https://feeds.npr.org/1001/rss.xml',
  bbc: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  cnbc: 'https://www.cnbc.com/id/20910258/device/rss/rss.html',
  // International
  guardian: 'https://www.theguardian.com/international/rss',
  euronews: 'https://www.euronews.com/rss?format=mrss&level=theme&name=news',
  // Germany
  spiegel: 'https://www.spiegel.de/schlagzeilen/index.rss',
  zeit: 'https://newsfeed.zeit.de/all',
  tagesschau: 'https://www.tagesschau.de/xml/rss2',
  heise: 'https://www.heise.de/rss/heise-top-atom.xml',
  golem: 'https://rss.golem.de/rss.php?feed=RSS2.0',
  // Austria
  orf: 'https://rss.orf.at/news.xml',
  derstandard: 'https://www.derstandard.at/rss',
  // Switzerland
  nzz: 'https://www.nzz.ch/recent.rss',
  srfnews: 'https://www.srf.ch/news/bnf/rss/1646',
  // France
  lemonde: 'https://www.lemonde.fr/rss/une.xml',
  franceinfo: 'https://www.francetvinfo.fr/titres.rss',
  // Tech
  arstechnica: 'https://feeds.arstechnica.com/arstechnica/index',
  theverge: 'https://www.theverge.com/rss/index.xml',
  // Google News top stories per language (language-aware, curated by Google)
  'gnews-de': 'https://news.google.com/rss?hl=de&gl=DE&ceid=DE:de',
  'gnews-en': 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en',
  'gnews-fr': 'https://news.google.com/rss?hl=fr&gl=FR&ceid=FR:fr',
  'gnews-it': 'https://news.google.com/rss?hl=it&gl=IT&ceid=IT:it',
  'gnews-nl': 'https://news.google.com/rss?hl=nl&gl=NL&ceid=NL:nl',
  marketwatch: 'https://feeds.content.dowjones.io/public/rss/mw_topstories',
  'wsj-markets': 'https://feeds.content.dowjones.io/public/rss/RSSMarketsMain',
  'ft-markets': 'https://www.ft.com/markets?format=rss',
  'yahoo-finance': 'https://finance.yahoo.com/news/rssindex',
  seekingalpha: 'https://seekingalpha.com/feed.xml',
  espn: 'https://www.espn.com/espn/rss/news',
  'cbs-sports': 'https://www.cbssports.com/rss/headlines/',
  'yahoo-sports': 'https://sports.yahoo.com/rss/',
  'bbc-sport': 'https://feeds.bbci.co.uk/sport/rss.xml',
  'guardian-sport': 'https://www.theguardian.com/sport/rss',
  // The Athletic serves its feed from nytimes.com; theathletic.com redirects
  // there and answers inconsistently when fetched directly (probed 2026-07-31).
  'the-athletic': 'https://www.nytimes.com/athletic/rss/news/',
  // Per-sport feeds for the Sports News chips and the my-teams takeover.
  // Every entry live-verified 2026-07-31 (status, item count, final host).
  // ESPN is deliberately absent: its per-sport feeds answer HTTP 202 with
  // empty bodies from datacenter egress. BBC names sports, not leagues.
  'cbs-sports-mlb': 'https://www.cbssports.com/rss/headlines/mlb/',
  'cbs-sports-nfl': 'https://www.cbssports.com/rss/headlines/nfl/',
  'cbs-sports-nba': 'https://www.cbssports.com/rss/headlines/nba/',
  'cbs-sports-nhl': 'https://www.cbssports.com/rss/headlines/nhl/',
  'cbs-sports-golf': 'https://www.cbssports.com/rss/headlines/golf/',
  'cbs-sports-tennis': 'https://www.cbssports.com/rss/headlines/tennis/',
  'yahoo-sports-mlb': 'https://sports.yahoo.com/mlb/rss/',
  'yahoo-sports-nfl': 'https://sports.yahoo.com/nfl/rss/',
  'yahoo-sports-nba': 'https://sports.yahoo.com/nba/rss/',
  'yahoo-sports-nhl': 'https://sports.yahoo.com/nhl/rss/',
  'yahoo-sports-golf': 'https://sports.yahoo.com/golf/rss/',
  'yahoo-sports-tennis': 'https://sports.yahoo.com/tennis/rss/',
  'the-athletic-mlb': 'https://www.nytimes.com/athletic/rss/mlb/',
  'the-athletic-nfl': 'https://www.nytimes.com/athletic/rss/nfl/',
  'the-athletic-nba': 'https://www.nytimes.com/athletic/rss/nba/',
  'the-athletic-nhl': 'https://www.nytimes.com/athletic/rss/nhl/',
  'the-athletic-mls': 'https://www.nytimes.com/athletic/rss/mls/',
  'the-athletic-f1': 'https://www.nytimes.com/athletic/rss/formula-1/',
  'the-athletic-golf': 'https://www.nytimes.com/athletic/rss/golf/',
  'the-athletic-tennis': 'https://www.nytimes.com/athletic/rss/tennis/',
  'the-athletic-epl': 'https://www.nytimes.com/athletic/rss/premier-league/',
  'bbc-sport-mlb': 'https://feeds.bbci.co.uk/sport/baseball/rss.xml',
  'bbc-sport-nfl': 'https://feeds.bbci.co.uk/sport/american-football/rss.xml',
  'bbc-sport-nba': 'https://feeds.bbci.co.uk/sport/basketball/rss.xml',
  'bbc-sport-nhl': 'https://feeds.bbci.co.uk/sport/ice-hockey/rss.xml',
  'bbc-sport-f1': 'https://feeds.bbci.co.uk/sport/formula1/rss.xml',
  'bbc-sport-golf': 'https://feeds.bbci.co.uk/sport/golf/rss.xml',
  'bbc-sport-tennis': 'https://feeds.bbci.co.uk/sport/tennis/rss.xml',
  'guardian-sport-mlb': 'https://www.theguardian.com/sport/mlb/rss',
  'guardian-sport-nfl': 'https://www.theguardian.com/sport/nfl/rss',
  'guardian-sport-nba': 'https://www.theguardian.com/sport/nba/rss',
  'guardian-sport-nhl': 'https://www.theguardian.com/sport/nhl/rss',
  'guardian-sport-mls': 'https://www.theguardian.com/football/mls/rss',
  'guardian-sport-f1': 'https://www.theguardian.com/sport/formulaone/rss',
  'guardian-sport-golf': 'https://www.theguardian.com/sport/golf/rss',
  'guardian-sport-tennis': 'https://www.theguardian.com/sport/tennis/rss',
  'guardian-sport-epl': 'https://www.theguardian.com/football/premierleague/rss',
};

export function newsFeedUrl(id) {
  // Object.hasOwn so inherited keys ('constructor' matches the route regex)
  // don't resolve to a prototype member instead of null.
  return Object.hasOwn(FEEDS, id) ? FEEDS[id] : null;
}

export async function fetchNewsFeed(id) {
  const url = newsFeedUrl(id);
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 board-pro-signage' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`feed ${res.status}`);
  return { updatedAt: Math.floor(Date.now() / 1000), stale: false, xml: await res.text() };
}
