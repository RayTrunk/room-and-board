// WORST-CASE demo view-models for the overflow audit (site/_audit.html?full=1).
//
// The shipped DEMO_VMS are sized for the DEFAULT config: 3 tickers, 5 subway
// lines, 5 cities, 4 headlines, 2 posts, 3 TfL lines. That makes them useless
// for auditing a TALL card, because the card runs out of data long before it
// runs out of room — a 3x8 Markets card with three tickers cannot overflow no
// matter how wrong the capacity table is. Every list here is topped up to the
// maximum the pickers allow, with the LONGEST realistic row content (wrapped
// alert text, two-line headlines, incident notes), so `overflowY > 0` in the
// audit means capacity.js genuinely over-promises at that size.
//
// Deterministic: no Date, no random, values derived from the index. Used by the
// audit harness and by test/layout-optimize.test.js's calibration list; never
// loaded by the board itself.
import { DEMO_VMS, DEMO_NOW_MS } from './fixtures.js';
import { SUBWAY_LINES } from '../js/widgets/subway.js';
import { TFL_LINES } from '../js/tfl-lines.js';
import { SERVICE_CHOICES } from '../js/widgets/services.js';

const rep = (arr, n) => Array.from({ length: n }, (_, i) => arr[i % arr.length]);

// Long enough to wrap on a 3-wide row, which is the case that costs a row.
const LONG_ALERT = 'Downtown trains are rerouted via the express track after 34 St-Penn Station while we address a signal problem; expect delays of up to 20 minutes in both directions.';

const HEADLINES = [
  ['Council reaches a deal on the city budget hours ahead of the midnight deadline', 'NYT New York'],
  ['Federal Reserve signals patience on rate cuts as inflation cools unevenly', 'NYT Business'],
  ['Subway platform door pilot expands to five more stations this autumn', 'Gothamist'],
  ['Harbor tunnel repairs will close two lanes overnight through September', 'NYT New York'],
  ['Chip maker lifts full-year guidance on data-centre demand', 'NYT Business'],
  ['City hits a record for weekday ferry ridership for the third month running', 'Gothamist'],
  ['Heat advisory extended through the weekend across the five boroughs', 'NYT New York'],
  ['Port Authority approves the terminal redesign after a decade of hearings', 'NYT Top Stories'],
  ['Grocery prices ease for a third straight month, easing household budgets', 'NYT Business'],
  ['Museum mile street festival returns in September with expanded hours', 'Gothamist'],
];
const feed = (n, offsetMs = 0) => ({
  nowMs: DEMO_NOW_MS,
  items: HEADLINES.slice(0, n).map(([title, source], i) => ({
    title, source, t: DEMO_NOW_MS - offsetMs - i * 1_800_000,
  })),
});

const POSTS = [
  ['The AI superforecasters are here, and they are already beating the panel', 'What happens when the models start winning the tournaments the humans built for themselves'],
  ['The hidden cost of every recurring meeting on your calendar', 'A field guide to reclaiming a working week one standing invite at a time'],
  ['Why the interest rate on deposits never moves as fast as the headline', 'Net interest margin, explained with one bank and a very long spreadsheet'],
  ['Shipping is a skill, and it is not the same skill as building', 'Notes from a decade of launches that went out on a Friday afternoon'],
  ['The quiet return of the long-form technical essay', 'Attention is not as scarce as the dashboards told everyone it was'],
  ['What a year of writing every single morning actually changed', 'A count of the words, the drafts abandoned, and the two that mattered'],
];
const posts = (n) => ({
  nowMs: DEMO_NOW_MS,
  items: POSTS.slice(0, n).map(([title, desc], i) => ({
    title, desc, source: `Publication ${i + 1}`, t: DEMO_NOW_MS - i * 3_600_000,
    link: `https://example.com/p/${i}`,
  })),
});

// Lists at the maximum the /setup pickers allow. The audit's cfg needs these as
// well as the view-models: TfL, Citi Bike and Markets read the CHOSEN list out
// of cfg and only take the live values from the vm.
export const FULL_CFG = {
  subway: { lines: [...SUBWAY_LINES] },
  markets: { symbols: ['^DJI', '^IXIC', '^GSPC', '^FTSE', '^GDAXI', '^STOXX50E', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'BRK-B', 'JPM', 'HSBA.L', 'V', 'JNJ', 'WMT', 'XOM'] },
  worldclock: { cities: [
    ['San Francisco', 'America/Los_Angeles'], ['Denver', 'America/Denver'], ['Chicago', 'America/Chicago'],
    ['New York', 'America/New_York'], ['Sao Paulo', 'America/Sao_Paulo'], ['London', 'Europe/London'],
    ['Berlin', 'Europe/Berlin'], ['Tel Aviv', 'Asia/Jerusalem'], ['Bengaluru', 'Asia/Kolkata'],
    ['Singapore', 'Asia/Singapore'],
  ].map(([label, zone]) => ({ label, zone })) },
  services: { list: SERVICE_CHOICES.map(([id]) => id) },
  tfl: { lines: TFL_LINES.map((l) => l.id) },
  citibike: { stations: [
    'W 29 St & 9 Ave', '10 Ave & W 28 St', '9 Ave & W 33 St',
    'Broadway & W 41 St', 'E 33 St & 1 Ave', 'W 21 St & 6 Ave',
  ].map((name, i) => ({ id: `st${i}`, name })) },
  sports: { teams: [['mlb', 'nym'], ['nba', 'nyk'], ['nfl', 'nyj'], ['nhl', 'nyr'], ['mlb', 'nyy'], ['nba', 'bkn']]
    .map(([lg, id]) => ({ lg, id })) },
  news: { sources: ['nyt-home', 'nyt-nyregion', 'nyt-business', 'npr', 'bbc', 'gothamist'] },
  bus: { legs: [
    { route: 'QM24', lineRef: 'MTA NYCT_QM24', dir: 0, stopId: '550789', stopName: 'Madison Av / E 34 St' },
    { route: 'X27', lineRef: 'MTA NYCT_X27', dir: 1, stopId: '551234', stopName: '5 Av / W 42 St' },
  ] },
};

// `cfg` shapes the lists to one board's actual configuration: a persona with 12
// tickers and 6 subway lines gets exactly those, so a screenshot of a generated
// board shows what that board would really show. Omit it for the worst case
// (every list at its picker maximum), which is what the size sweep wants.
export function fullVMs(cfg = null) {
  const vms = { ...DEMO_VMS };
  const want = cfg ? { ...FULL_CFG, ...cfg } : FULL_CFG;
  const lines = cfg?.subway?.lines?.length ? cfg.subway.lines : SUBWAY_LINES;
  const symbols = want.markets?.symbols?.length ? want.markets.symbols : FULL_CFG.markets.symbols;
  const cities = want.worldclock?.cities?.length ? want.worldclock.cities : FULL_CFG.worldclock.cities;
  const svcs = want.services?.list?.length ? want.services.list : FULL_CFG.services.list;
  const tflIds = want.tfl?.lines?.length ? want.tfl.lines : FULL_CFG.tfl.lines;
  const stations = want.citibike?.stations?.length ? want.citibike.stations : FULL_CFG.citibike.stations;
  const legs = want.bus?.legs?.length ? want.bus.legs : FULL_CFG.bus.legs;

  // Every third line carries a wrapped alert: the row height that costs a row.
  vms.subway = {
    updatedAt: 0,
    lines: lines.map((line, i) => ({
      line, ok: i % 3 !== 0, headers: i % 3 === 0 ? [LONG_ALERT] : [],
    })),
  };

  const base = DEMO_VMS.markets.indices;
  const NAMES = {
    '^DJI': 'Dow Jones', '^IXIC': 'Nasdaq Composite', '^GSPC': 'S&P 500', '^FTSE': 'FTSE 100',
    '^GDAXI': 'DAX', '^STOXX50E': 'Euro Stoxx 50', AAPL: 'Apple', MSFT: 'Microsoft', NVDA: 'Nvidia',
    AMZN: 'Amazon', GOOGL: 'Alphabet', META: 'Meta Platforms', TSLA: 'Tesla',
    'BRK-B': 'Berkshire Hathaway B', JPM: 'JPMorgan Chase', 'HSBA.L': 'HSBC Holdings',
    V: 'Visa', JNJ: 'Johnson & Johnson', WMT: 'Walmart', XOM: 'Exxon Mobil',
  };
  vms.markets = {
    ...DEMO_VMS.markets,
    indices: symbols.map((symbol, i) => ({
      ...base[i % base.length], symbol, name: NAMES[symbol] ?? String(symbol).replace(/^\^/, ''),
    })),
  };

  vms.news = feed(10);
  vms.marketsnews = feed(10, 600_000);
  vms.substack = posts(6);
  vms.bsky = posts(6);

  vms.history = { events: rep(DEMO_VMS.history.events, 8).map((e, i) => ({ ...e, year: e.year + i })) };

  vms.worldclock = cities.map((c, i) => ({
    city: c.label, time: `${1 + (i % 12)}:${String(10 + i).padStart(2, '0')} ${i % 2 ? 'AM' : 'PM'}`,
    dayDiff: i > 7 ? 1 : 0,
  }));

  const labelOf = Object.fromEntries(SERVICE_CHOICES);
  vms.services = {
    updatedAt: 1783000000,
    services: svcs.map((id, i) => ({
      id, label: labelOf[id] ?? id,
      state: i % 4 === 0 ? 'minor' : 'ok',
      note: i % 4 === 0 ? 'Minor Service Outage' : 'All systems operational',
      incidents: i % 4 === 0 ? [{
        title: 'Dashboard and API service issues', since: '2026-07-11T14:12:00.000Z',
        update: 'Investigating elevated error rates on the Dashboard and API. Cached content and traffic proxying are unaffected.',
      }] : [],
    })),
  };

  const tflMeta = Object.fromEntries(TFL_LINES.map((l) => [l.id, l]));
  vms.tfl = {
    updatedAt: 1783000000,
    lines: tflIds.map((id, i) => ({
      id, name: tflMeta[id]?.name ?? id, mode: tflMeta[id]?.mode ?? 'Tube',
      ok: i % 4 !== 0, status: i % 4 === 0 ? 'Severe Delays' : 'Good Service',
      reason: i % 4 === 0 ? 'Severe delays between Turnham Green and Richmond after an earlier signal failure; replacement buses are running.' : '',
    })),
  };

  vms.citibike = {
    updatedAt: 1783000000,
    stations: stations.map((s, i) => ({
      id: s.id, bikes: (i * 3) % 14, ebikes: i % 4, docks: (i * 5) % 27, ok: i % 5 !== 4,
    })),
  };

  const teams = want.sports?.teams?.length ? want.sports.teams : FULL_CFG.sports.teams;
  vms.sports = {
    rows: teams.map((t, i) => ({
      ...DEMO_VMS.sports.rows[i % DEMO_VMS.sports.rows.length],
      lg: t.lg, abbr: String(t.id).toUpperCase(),
    })),
  };

  // The leaderboards ship 9 and 6 rows; their feeds carry 15 and 10.
  vms.golf = {
    ...DEMO_VMS.golf,
    players: rep(DEMO_VMS.golf.players, 15).map((p, i) => ({ ...p, pos: i + 1, name: `Player ${i + 1}` })),
  };
  vms.tennis = { ...DEMO_VMS.tennis, rows: rep(DEMO_VMS.tennis.rows, 10) };

  // PATH: the shipped fixture carries 3 rows, too few for a tall card.
  vms.path = {
    station: '33S',
    sections: [{
      dir: 'ToNJ', label: 'To New Jersey',
      rows: rep([['Journal Square', 'FF9900'], ['Hoboken', '4D92FB'], ['Newark', 'D93A30']], 12)
        .map(([dest, color], i) => ({ min: 3 + i * 6, t: DEMO_NOW_MS / 1000 + (3 + i * 6) * 60, dest, colors: [color] })),
    }],
  };

  // Express bus: every configured leg, three arrivals each (the renderer's max).
  vms.bus = {
    configured: true,
    stops: legs.map((l, i) => ({
      id: l.stopId, route: l.route, name: l.stopName,
      arrivals: [8, 21, 34].map((min) => ({ dest: i ? 'Midtown' : 'Wall St', min: min + i * 3, distance: '' })),
    })),
  };

  return vms;
}
