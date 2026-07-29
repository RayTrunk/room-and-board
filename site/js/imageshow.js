// Shared image viewer + ambient slideshow engine, used by both the Art widget
// and the Photos widget.  The viewer takes a pre-built photo list; callers are
// responsible for fetching/building that list before opening.

import { escapeHtml } from './util.js';
import { stripData, stripHtml } from './ambient.js';
import { loadCache } from './store.js';

// Trimmed field read: whitespace-only is the same as absent for caption purposes
// (an iCloud/GDrive "caption" of " " must not conjure a caption box).
const field = (v) => (v == null ? '' : String(v).trim());

// Caption metadata line: artist [· year] for art; empty when absent (e.g. photos).
function captionMeta(item) {
  const artist = field(item.artist);
  if (!artist) return '';
  const year = field(item.year);
  return `${escapeHtml(artist)}${year ? ` · ${escapeHtml(year)}` : ''}`;
}

// Optional third caption line (APOD explanation); clamped in CSS. Empty when absent.
function captionDesc(item) {
  const desc = field(item.desc);
  return desc ? `<span class="slide-caption__desc">${escapeHtml(desc)}</span>` : '';
}

// Caption innards — only the lines that actually carry text. Returns '' when the
// item has no caption content at all, which is the signal callers use to skip the
// box entirely. Emitting empty <span>s instead would defeat the `:empty` CSS
// guard (an element with blank children is not `:empty`) and paint the padded
// background as a stray grey rectangle in the lower left — exactly what an
// untitled Landscapes/GDrive photo used to do.
export function captionHtml(item) {
  const title = field(item.title);
  const meta = captionMeta(item);
  const parts = [];
  if (title) parts.push(`<span class="slide-caption__title">${escapeHtml(title)}</span>`);
  if (meta) parts.push(`<span class="slide-caption__meta">${meta}</span>`);
  parts.push(captionDesc(item));
  return parts.filter(Boolean).join('');
}

// Pointer-gesture classifier for the viewer: horizontal drags navigate,
// small movements are taps (close), anything ambiguous is ignored.
export function swipeAction(dx, dy) {
  if (Math.abs(dx) >= 60 && Math.abs(dx) >= 2 * Math.abs(dy)) return dx < 0 ? 'next' : 'prev';
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return 'tap';
  return null;
}

let stripTimer = null;
let viewerList = null; // photo list for the open viewer session
let viewerCaption = true; // whether this session shows captions at all (chart: false)
let viewerIndex = -1;
let viewerGen = 0; // bumped per open; kept for session identity
let userStepped = false; // guards against clobbering a swipe with deferred state

// Put the caption box where the content says it belongs: create it only when
// there is text to show, remove it the moment there isn't. Presence follows
// content, so swiping from a captioned artwork to an untitled photo can't
// strand an empty box, and swiping back brings the box straight back.
function renderViewerCaption(viewer, item) {
  const html = viewerCaption ? captionHtml(item) : '';
  let cap = viewer.querySelector('.slide-caption');
  if (!html) {
    cap?.remove();
    return;
  }
  if (!cap) {
    cap = document.createElement('div');
    cap.className = 'slide-caption';
    // Ahead of the info strip, which stays last (insertBefore(…, null) appends
    // when there is no strip, e.g. the chart viewer).
    viewer.insertBefore(cap, viewer.querySelector('.strip'));
  }
  cap.innerHTML = html;
}

// Full-screen viewer: tap the dashboard card to open, tap anywhere to close,
// swipe left/right to browse the supplied photo list.  Shows the ambient info
// strip so the clock stays visible.  Stays up indefinitely (mode changes don't
// touch it).  strip:false suppresses the info band — used by the chart viewer,
// where the band would cover chart content and the view is short-lived anyway.
// fit is the widget's own screensaver fit (config.js imageFit): 'contain'
// letterboxes, 'cover' fills the glass and crops.
export function openImageViewer(current, cfg, { list = [], caption = true, strip = true, fit = 'contain' } = {}) {
  // Reset session state synchronously.
  ++viewerGen;
  userStepped = false;
  let viewer = document.querySelector('#art-viewer');
  if (!viewer) {
    viewer = document.createElement('div');
    viewer.id = 'art-viewer';
    viewer.className = 'art-viewer';
    // Close on tap, navigate on swipe.  The trailing click is classified by
    // its own coordinates against the gesture origin — no suppression state,
    // so a swipe that never produces a click can't swallow the next tap.
    let downX = 0;
    let downY = 0;
    viewer.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      downY = e.clientY;
    });
    viewer.addEventListener('pointerup', (e) => {
      const action = swipeAction(e.clientX - downX, e.clientY - downY);
      if (action === 'next' || action === 'prev') step(viewer, action === 'next' ? 1 : -1);
    });
    viewer.addEventListener('click', (e) => {
      if (swipeAction(e.clientX - downX, e.clientY - downY) !== 'tap') return;
      viewer.hidden = true;
      clearInterval(stripTimer);
      viewerList = null; // release the album; reopen passes a fresh list
    });
    document.body.appendChild(viewer);
  }
  // Per-open, not per-element: the shared viewer is reused by every image card.
  viewer.classList.toggle('art-viewer--fill', fit === 'cover');
  viewer.innerHTML = `
    <img class="art-viewer__img" src="${escapeHtml(current.img)}" alt="${escapeHtml(current.title ?? '')}">
    ${strip ? '<div class="strip"></div>' : ''}`;
  viewerCaption = caption;
  renderViewerCaption(viewer, current);
  const stripEl = viewer.querySelector('.strip');
  clearInterval(stripTimer);
  stripTimer = null;
  if (stripEl) {
    const refreshStrip = () => {
      const caches = {};
      for (const id of ['weather', 'lirr', 'mnr', 'njt']) caches[id] = loadCache(id)?.data;
      stripEl.innerHTML = stripHtml(stripData(caches, cfg ?? { widgets: [] }), new Date());
    };
    refreshStrip();
    stripTimer = setInterval(refreshStrip, 30 * 1000);
  }
  // Seed the session list synchronously — no fetch here; callers pass the list.
  viewerList = Array.isArray(list) ? list : [];
  viewerIndex = viewerList.findIndex((a) => a.img === current.img);
  viewer.hidden = false;
}

// Swap in place: preload first (slideshow pattern), then update img + caption.
function step(viewer, dir) {
  if (!viewerList?.length) return;
  userStepped = true;
  viewerIndex = (viewerIndex + dir + viewerList.length) % viewerList.length;
  const item = viewerList[viewerIndex];
  const img = new Image();
  const swap = () => {
    const imgEl = viewer.querySelector('.art-viewer__img');
    imgEl.src = item.img;
    imgEl.alt = item.title ?? '';
    renderViewerCaption(viewer, item);
  };
  img.onload = swap;
  img.onerror = swap; // show anyway; <img> will retry like the slideshow does
  img.src = item.img;
}

// Ambient slideshow engine: two stacked layers, crossfade via [data-active].
// deps.now/random are injectable for tests.
export function createSlideshow(manifest, host, { intervalMs = 75000, random = Math.random, fit = 'contain' } = {}) {
  let order = shuffle([...manifest.keys()], random);
  let pos = 0;
  let timer = null;
  let active = 0;
  let stopped = false;

  host.innerHTML = `
    <div class="slide" data-layer="0"></div>
    <div class="slide" data-layer="1"></div>
    <div class="slide-caption"></div>`;
  const layers = [...host.querySelectorAll('.slide')];
  const caption = host.querySelector('.slide-caption');

  function shuffle(arr, rnd) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function itemAt(p) {
    if (p >= order.length) {
      order = shuffle(order, random);
      pos = 0;
    }
    return manifest[order[pos]];
  }

  function show(item) {
    const next = layers[1 - active];
    next.style.backgroundImage = `url("${item.img}")`;
    // Fit mode. 'contain' letterboxes on black — art and personal photos are
    // never cropped and look the same in ambient as when tapped into (the
    // full-screen viewer is object-fit:contain too). 'cover' fills the viewport
    // and crops, for curated photo sources (e.g. Landscapes) that are meant to
    // fill the screen edge-to-edge.
    next.style.backgroundSize = fit;
    next.setAttribute('data-active', '');
    layers[active].removeAttribute('data-active');
    active = 1 - active;
    // Only the pieces that exist — a titleless photo (common for GDrive folders)
    // leaves this element with no children at all, which `:empty` hides so the
    // padded background box never shows as a stray grey rectangle.
    caption.innerHTML = captionHtml(item);
  }

  function preload(item, done) {
    const img = new Image();
    img.onload = () => done();
    img.onerror = () => done(); // show anyway; background-image will retry
    img.src = item.img;
  }

  function advance() {
    if (stopped) return;
    const item = itemAt(pos);
    pos += 1;
    preload(item, () => {
      // stop() during an in-flight preload must not resurrect the loop: the
      // pending onload/onerror would otherwise schedule an uncancellable chain.
      if (stopped) return;
      show(item);
      timer = setTimeout(advance, intervalMs);
    });
  }

  return {
    start() {
      if (!manifest.length) return;
      stopped = false;
      advance();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
    // Manual navigation (ambient swipe): next reuses the natural advance,
    // prev re-shows the previously shown item within the current order. Both
    // reset the auto-advance cadence so a swipe isn't followed moments later
    // by a scheduled change.
    step(dir) {
      if (stopped || !manifest.length) return;
      clearTimeout(timer);
      if (dir > 0) {
        advance();
        return;
      }
      pos = (pos - 2 + order.length) % order.length;
      const item = manifest[order[pos]];
      pos += 1;
      preload(item, () => {
        if (stopped) return;
        show(item);
        timer = setTimeout(advance, intervalMs);
      });
    },
    current() {
      return manifest[order[Math.max(pos - 1, 0)]] ?? null;
    },
  };
}
