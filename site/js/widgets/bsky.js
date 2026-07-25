// Followed Bluesky accounts — short-form, high-cadence social stream.

import { renderHeadlines } from './newscore.js';
import { fetchBskyRows, fetchAll } from './posts.js';

export const meta = { id: 'bsky', title: 'Bluesky', refreshMs: 10 * 60 * 1000 };

export function render(el, vm, _cfg) {
  renderHeadlines(el, vm, { widgetId: 'bsky', emptyHint: 'Add accounts in Settings → Bluesky' });
}

export async function fetchData(cfg, net) {
  return fetchAll(cfg.bsky?.handles ?? [], fetchBskyRows, net);
}
