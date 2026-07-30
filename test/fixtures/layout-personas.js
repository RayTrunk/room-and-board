// Ten realistic /setup picks, used by test/layout-optimize.js as the corpus the
// content-aware generator is measured against. Config shapes are the real ones
// (they go through normalizeConfig); counts match how the pickers behave —
// markets caps at 20 tickers, sports at 6 teams, citibike at 6 stations,
// substack/bsky at 6 accounts, worldclock at 10 cities, and TfL defaults to all
// 11 tube lines, which is why London is the worst baseline in the set.
//
// Adding a persona here is how a future regression gets caught: the metrics test
// asserts zero blank cells and zero avoidable broken promises for every row.
const z = (label, zone) => ({ label, zone });
const team = (lg, id) => ({ lg, id });

export const PERSONAS = [
  {
    key: 'commuter',
    label: 'Commuter — subway (6 lines) + 2 rail boards',
    widgets: ['weather', 'subway', 'lirr', 'njt', 'news'],
    cfg: {
      subway: { lines: ['1', '2', '3', 'A', 'C', 'E'] },
      lirr: { dest: 'PWS', origin: 'penn', alerts: true },
      njt: { lines: ['Northeast Corridor Line', 'North Jersey Coast Line'], alerts: true },
      news: { sources: ['nyt-home', 'nyt-nyregion'] },
    },
  },
  {
    key: 'sportsfan',
    label: 'Sports fan — 4 teams',
    widgets: ['weather', 'sports', 'golf', 'news', 'markets'],
    cfg: {
      sports: { teams: [team('mlb', 'nym'), team('nba', 'nyk'), team('nfl', 'nyj'), team('nhl', 'nyr')] },
    },
  },
  {
    key: 'markets12',
    label: 'Markets watcher — 12 tickers',
    widgets: ['markets', 'marketsnews', 'news', 'weather', 'worldclock'],
    cfg: {
      markets: { symbols: ['^DJI', '^IXIC', '^GSPC', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'BRK-B', 'JPM'] },
    },
  },
  {
    key: 'kitchensink',
    label: 'Kitchen sink — 12 widgets',
    widgets: ['weather', 'subway', 'lirr', 'markets', 'sports', 'news', 'worldclock', 'services', 'art', 'history', 'quote', 'aqi'],
    cfg: {
      subway: { lines: ['1', '2', '3', '7'] },
      markets: { symbols: ['^DJI', '^IXIC', '^GSPC', 'AAPL', 'MSFT', 'NVDA'] },
      sports: { teams: [team('mlb', 'nym'), team('nba', 'nyk'), team('nfl', 'nyj')] },
      services: { list: ['webex', 'zoom', 'slack', 'cloudflare', 'm365', 'aws'] },
      lirr: { dest: 'PWS', origin: 'penn', alerts: true },
    },
  },
  { key: 'minimal', label: 'Minimal — 3 widgets', widgets: ['weather', 'news', 'art'], cfg: {} },
  {
    key: 'globalteam',
    label: 'Global team — 10 cities + 8 services',
    widgets: ['worldclock', 'services', 'weather', 'news', 'markets'],
    cfg: {
      worldclock: { cities: [
        z('San Francisco', 'America/Los_Angeles'), z('Denver', 'America/Denver'),
        z('New York', 'America/New_York'), z('Sao Paulo', 'America/Sao_Paulo'),
        z('London', 'Europe/London'), z('Berlin', 'Europe/Berlin'),
        z('Tel Aviv', 'Asia/Jerusalem'), z('Bengaluru', 'Asia/Kolkata'),
        z('Singapore', 'Asia/Singapore'), z('Sydney', 'Australia/Sydney'),
      ] },
      services: { list: ['webex', 'zoom', 'slack', 'cloudflare', 'github', 'm365', 'aws', 'claude'] },
    },
  },
  {
    key: 'london',
    label: 'London — all 11 tube lines',
    widgets: ['tfl', 'weather', 'news', 'markets', 'quote'],
    cfg: {
      loc: { lat: 51.5072, lon: -0.1276, label: 'London', units: 'C' },
      markets: { symbols: ['^FTSE', '^GDAXI', '^STOXX50E', '^DJI', 'HSBA.L'] },
    },
  },
  {
    key: 'defaultplus',
    label: 'The default board, lightly edited',
    widgets: ['weather', 'worldclock', 'subway', 'sports', 'markets', 'art', 'lirr', 'history', 'news'],
    cfg: {
      sports: { teams: [team('mlb', 'nym'), team('nba', 'nyk'), team('nfl', 'nyj')] },
      lirr: { dest: 'PWS', origin: 'penn', alerts: true },
    },
  },
  {
    key: 'photowall',
    label: 'Photo wall — image-heavy',
    widgets: ['art', 'landscapes', 'apod', 'gdrivephotos', 'weather', 'quote'],
    cfg: { gdrivephotos: { album: '1RHow60mcBwzMturimQSbziK3hqCvP2lz', every: 30 } },
  },
  {
    key: 'allcommute',
    label: 'All commute — 8 transit cards',
    widgets: ['weather', 'subway', 'lirr', 'mnr', 'njt', 'path', 'ferry', 'citibike', 'bus'],
    cfg: {
      subway: { lines: ['1', '2', '3', 'A', 'E'] },
      lirr: { dest: 'PWS', origin: 'penn', alerts: true },
      mnr: { dest: 'STM', alerts: true },
      njt: { lines: ['Northeast Corridor Line'], alerts: true },
      bus: { legs: [
        { route: 'QM24', lineRef: 'MTA NYCT_QM24', dir: 0, stopId: '550789', stopName: 'Madison Av / E 34 St' },
        { route: 'X27', lineRef: 'MTA NYCT_X27', dir: 1, stopId: '551234', stopName: '5 Av / W 42 St' },
      ] },
    },
  },
];
