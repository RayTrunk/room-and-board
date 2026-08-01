// NASA Astronomy Picture of the Day — an image-forward card mirroring Art
// (reuses the .artwork card styles + the shared full-screen viewer). One image
// per day from the worker's /apod digest; tap opens the viewer with the
// title, credit, and explanation.

import { escapeHtml, markExpandable } from '../util.js';
import { WORKER_URL } from '../env.js';
import { openImageViewer, renderImageCard } from '../imageshow.js';

export const meta = { id: 'apod', title: 'NASA Daily Photo', refreshMs: 30 * 60 * 1000 };

export function render(el, vm, cfg) {
  const p = vm.photo;
  if (!p || !p.url) {
    el.innerHTML = '<div class="empty">NASA photo unavailable</div>';
    markExpandable(el, false); // yesterday's mark must not outlive the photo
    return;
  }
  // No date note: APOD's date is the publish date (== today's dashboard clock),
  // not a capture date — so it would just duplicate the header time.
  const credit = p.credit ? `© ${p.credit}` : '';
  // Shared image surface: the picture changes once a day but the card refreshes
  // every 30 minutes, so the early return is what stops it re-decoding the same
  // photo all day; the day's change dissolves in.
  renderImageCard(el, {
    src: p.url,
    alt: p.title,
    label: 'View photo full screen',
    caption: `<span class="artwork__title">${escapeHtml(p.title)}</span>`
      + (credit ? `<span class="artwork__artist">${escapeHtml(credit)}</span>` : ''),
    onOpen: () => openImageViewer({ img: p.url, title: p.title, artist: credit, desc: p.explanation }, cfg, { list: [] }),
  });
}

export async function fetchData(_cfg, net) {
  return net.fetchJSON(`${WORKER_URL}/apod`);
}
