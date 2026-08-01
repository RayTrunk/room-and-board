// Generic RSS proxy: fetches any http(s) URL and returns the raw XML.
// SSRF protection: blocks loopback, link-local, and RFC-1918 ranges.

const BLOCKED_PATTERNS = [
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\./,
  /^https?:\/\/0\./,
  /^https?:\/\/\[::1\]/,
  /^https?:\/\/169\.254\./,       // link-local
  /^https?:\/\/10\./,             // RFC-1918
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/metadata\./i,       // common cloud metadata hostnames
  /^https?:\/\/169\.254\.169\.254/, // AWS metadata IP
];

export function isSafeRssUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const full = url.toString();
  return !BLOCKED_PATTERNS.some((re) => re.test(full));
}

export async function fetchRss(url) {
  if (!isSafeRssUrl(url)) throw new Error('rss: blocked url');
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 board-pro-signage' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`rss: ${res.status}`);
  return res.text();
}
