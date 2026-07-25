// Shared engine for the two followed-account widgets: Substack (long-form
// publications, Worker digest — their API is keyless but CORS-less) and
// Bluesky (short-form, public AppView is CORS-open and keyless). They are
// separate widgets because their cadences differ by an order of magnitude —
// a merged newest-first feed would bury weekly essays under daily posts.
// Rows ARE headlines: the widgets render through newscore's renderHeadlines,
// so capacity fill-to-fit and the tap-to-read story view (summary + QR) work
// exactly as they do on the Headlines and Markets News cards.

import { WORKER_URL } from '../env.js';
import { mergeNews } from './news.js';

export const BSKY_API = 'https://public.api.bsky.app/xrpc';

export function mapPosts(perAccount, nowMs) {
  // Rows already carry `title` (the headline text) + optional link/desc, so they
  // drop straight into mergeNews (newest-first, deduped on normalized title).
  return { nowMs, items: mergeNews(perAccount, nowMs) };
}

export async function fetchBskyRows(acct, net) {
  const feed = await net.fetchJSON(
    `${BSKY_API}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(acct.id)}&limit=12&filter=posts_no_replies`,
  );
  return (feed.feed ?? [])
    .filter((it) => !it.reason) // skip reposts — their words, not others'
    .map((it) => {
      // Web permalink for the tap-to-read QR: bsky.app/profile/<handle>/post/<rkey>.
      // rkey is the last segment of the at:// post URI; handle (falls back to did)
      // is the stable profile the app resolves. Empty link if either is missing.
      const rkey = /\/app\.bsky\.feed\.post\/([^/]+)$/.exec(String(it.post?.uri ?? ''))?.[1] ?? '';
      const who = it.post?.author?.handle || it.post?.author?.did || '';
      return {
        title: String(it.post?.record?.text ?? '').trim(),
        t: Date.parse(it.post?.record?.createdAt ?? '') || 0,
        source: acct.label,
        link: rkey && who ? `https://bsky.app/profile/${who}/post/${rkey}` : '',
      };
    })
    .filter((r) => r.title);
}

export async function fetchSubstackRows(acct, net) {
  const digest = await net.fetchJSON(
    `${WORKER_URL}/posts/substack?pub=${encodeURIComponent(acct.id)}`,
  );
  // Title on the card (like a Headlines row); subtitle becomes the story-view
  // summary above the QR; canonical url is the "read the full story" link.
  return (digest.posts ?? []).map((p) => ({
    title: p.title,
    desc: p.subtitle || '',
    link: p.url || '',
    t: p.t * 1000,
    source: acct.label,
  }));
}

// One dead account never blanks a card. But a TOTAL failure (every account
// rejected) must throw, not resolve empty — otherwise it overwrites the good
// stale cache and shows "add accounts" though accounts are configured.
export async function fetchAll(accounts, fetchRows, net) {
  const settled = await Promise.allSettled(accounts.map((a) => fetchRows(a, net)));
  const ok = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
  if (accounts.length && !ok.length && settled.some((s) => s.status === 'rejected')) {
    throw new Error('posts: all account fetches failed');
  }
  return mapPosts(ok, Date.now());
}
