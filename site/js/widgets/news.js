// News headlines from user-selected sources. NYT feeds are CORS-open and
// fetched browser-direct; other outlets go through the Worker's whitelist
// proxy. RSS is parsed with a small regex parser (no DOMParser dependency,
// so the logic is unit-testable in Node).

import { renderHeadlines, fetchHeadlines } from './newscore.js';
import { viaSettings } from '../util.js';
export { parseRss, mergeNews, ageLabel } from './newscore.js'; // preserve existing test imports

export const meta = { id: 'news', title: 'Headlines', refreshMs: 10 * 60 * 1000 };

// id -> [label, kind, url-or-proxy-id, scope]
export const NEWS_SOURCES = [
  // ---- US National ----
  ['nyt-home',     'NYT Top Stories', 'direct', 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', 'US'],
  ['nyt-us',       'NYT U.S.',        'direct', 'https://rss.nytimes.com/services/xml/rss/nyt/US.xml',       'US'],
  ['nyt-business', 'NYT Business',    'direct', 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml', 'US'],
  ['npr',          'NPR News',        'proxy',  'npr',        'US'],
  ['nyt-nyregion', 'NYT New York',    'direct', 'https://rss.nytimes.com/services/xml/rss/nyt/NYRegion.xml', 'US Local'],
  ['gothamist',    'Gothamist',       'proxy',  'gothamist',  'US Local'],
  // ---- International ----
  ['bbc',          'BBC World',       'proxy',  'bbc',            'International'],
  ['guardian',     'The Guardian',    'proxy',  'guardian',       'International'],
  ['euronews',     'Euronews',        'proxy',  'euronews',       'International'],
  // ---- Germany ----
  ['spiegel',      'Spiegel Online',  'proxy',  'spiegel',        'Deutschland'],
  ['zeit',         'Zeit Online',     'proxy',  'zeit',           'Deutschland'],
  ['tagesschau',   'Tagesschau',      'proxy',  'tagesschau',     'Deutschland'],
  ['heise',        'Heise Online',    'proxy',  'heise',          'Deutschland'],
  // ---- Austria ----
  ['orf',          'ORF',             'proxy',  'orf',            'Österreich'],
  ['derstandard',  'Der Standard',    'proxy',  'derstandard',    'Österreich'],
  // ---- Switzerland ----
  ['nzz',          'NZZ',             'proxy',  'nzz',            'Schweiz'],
  ['srfnews',      'SRF News',        'proxy',  'srfnews',        'Schweiz'],
  // ---- France ----
  ['lemonde',      'Le Monde',        'proxy',  'lemonde',        'France'],
  ['franceinfo',   'France Info',     'proxy',  'franceinfo',     'France'],
  // ---- Tech ----
  ['arstechnica',  'Ars Technica',    'proxy',  'arstechnica',    'Tech'],
  ['theverge',     'The Verge',       'proxy',  'theverge',       'Tech'],
];

const SOURCE_BY_ID = Object.fromEntries(NEWS_SOURCES.map((s) => [s[0], s]));

export function render(el, vm, _cfg) {
  renderHeadlines(el, vm, { widgetId: 'news', emptyHint: `No headlines yet. Tap here to pick sources or ${viaSettings('Headlines')}` });
}

export async function fetchData(cfg, net) {
  const ids = cfg.news?.sources?.length ? cfg.news.sources : ['nyt-home'];
  return fetchHeadlines(ids, SOURCE_BY_ID, net);
}
