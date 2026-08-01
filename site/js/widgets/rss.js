// Generic RSS reader widget. User supplies up to 5 feed URLs; all are fetched
// via the Worker proxy (/rss?url=…) so arbitrary origins bypass CORS.
// Rendering is shared with the news widget via renderHeadlines / parseRss.

import { renderHeadlines, parseRss, mergeNews } from './newscore.js';
import { WORKER_URL } from '../env.js';
import { t } from '../i18n.js';

export const meta = { id: 'rss', title: 'RSS Feeds', refreshMs: 15 * 60 * 1000 };

export function render(el, vm, _cfg) {
  renderHeadlines(el, vm, { widgetId: 'rss', emptyHint: t('rss.empty') });
}

export async function fetchData(cfg, net) {
  const feeds = cfg.rss?.feeds ?? [];
  if (!feeds.length) return { items: [] };

  const settled = await Promise.allSettled(
    feeds.map(async ({ url, label }) => {
      const xml = await net.fetchText(`${WORKER_URL}/rss?url=${encodeURIComponent(url)}`);
      return parseRss(xml, label || new URL(url).hostname);
    }),
  );

  const all = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') all.push(...(r.value ?? []));
  }
  if (!all.length && settled.every((r) => r.status === 'rejected')) {
    throw new Error('rss: all feeds failed');
  }
  return { items: mergeNews(all, 40) };
}
