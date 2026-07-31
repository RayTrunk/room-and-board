// Shared image surface: the in-card image (art, photos, landscapes, APOD), the
// full-screen viewer, and the ambient slideshow engine.  The viewer takes a
// pre-built photo list; callers are responsible for fetching/building that list
// before opening.
//
// One rule runs through all three: an image is never put on the glass until its
// bitmap is decoded.  Assigning a src to a visible <img> lets the engine paint
// the picture band by band as the bytes arrive — the "drawing in from the top"
// that made a rotating card yank the eye across the room.

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

// Ready-to-paint promise for an image.  decode() is the real guarantee (the
// bitmap exists before anything is shown); the load event is the fallback for
// engines without it.  Never rejects: a broken image resolves too, so a dead URL
// degrades to the same broken/alt state it always did instead of freezing the
// card on the previous photo for ever.
export function loadImage(img, src) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve(img);
    };
    // Property handlers rather than addEventListener: this also runs against the
    // bare `Image` stubs the ambient/viewer tests install, which only fire onload.
    img.onload = done;
    img.onerror = done;
    img.src = src;
    // decode() only means anything once src is set, and it rejects for a broken
    // or empty source — treat that as "as ready as it will ever be" so a failed
    // decode can never block the swap.
    if (typeof img.decode === 'function') img.decode().then(done, done);
    else if (img.complete) done();
  });
}

// ---------- in-card image surface (art, photos, landscapes, APOD) ----------

// Cross-fade duration for a card swap.  The ambient screensaver dissolves over
// 2.5 s because it owns the whole 55" glass; a card is one small object on a
// busy board, so it takes the project's UI easing (ease-out
// cubic-bezier(0.22, 1, 0.36, 1)) stretched to 700 ms — long enough to read as a
// dissolve rather than a cut, short enough that it never becomes the thing you
// look at.  Mirrored in main.css; the timer below is only a cleanup net, so a
// few ms of drift between the two is harmless.
export const CARD_FADE_MS = 700;

const cardState = new WeakMap(); // .card__body → { src, caption, gen, open }

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;

// Caption presence follows content, like the viewer's: a titleless photo gets no
// figcaption at all rather than an empty padded box.
function setFigCaption(fig, html) {
  let cap = fig.querySelector('.artwork__caption');
  if (!html) {
    cap?.remove();
    return;
  }
  if (!cap) {
    cap = document.createElement('figcaption');
    cap.className = 'artwork__caption';
    fig.appendChild(cap);
  }
  cap.innerHTML = html;
}

// Reveal a layer that was inserted transparent.  The forced layout read flushes
// opacity:0 as the transition's start value; without it the engine coalesces
// insert+unset into a single style pass and the fade never runs.
function enter(img) {
  void img.offsetWidth;
  img.classList.remove('is-entering');
}

// Dissolve `next` (already decoded, already stacked over `current`) in, then drop
// the outgoing layer so a card rotating 24/7 keeps exactly one <img> instead of
// accumulating one per photo.
function crossfade(current, next) {
  if (reducedMotion()) {
    next.classList.remove('is-entering');
    current.remove();
    return;
  }
  enter(next);
  let timer = 0;
  const done = () => {
    clearTimeout(timer);
    next.removeEventListener('transitionend', done);
    current.remove();
  };
  // transitionend is the accurate signal; the timer is the net for a transition
  // that never runs at all (card hidden, motion disabled in CSS, engine quirk).
  next.addEventListener('transitionend', done, { once: true });
  timer = setTimeout(done, CARD_FADE_MS + 150);
}

function paintImage(frame, src, alt, state) {
  const gen = ++state.gen; // a newer render wins; a stale load drops on arrival
  if (!src) {
    frame.replaceChildren();
    return;
  }
  const next = document.createElement('img');
  next.className = 'artwork__img is-entering';
  next.alt = alt;
  const current = frame.querySelector('.artwork__img');
  if (!current) {
    // First paint: the <img> joins the DOM immediately (callers and tests read
    // the markup synchronously) but stays transparent until its bitmap is ready,
    // so the card fades up from its own surface instead of drawing in bands.
    frame.appendChild(next);
    loadImage(next, src).then(() => {
      if (state.gen === gen) enter(next);
    });
    return;
  }
  // Rotation: decode off-screen first and only then stack the new layer over the
  // old one.  Nothing half-drawn ever reaches the glass.
  loadImage(next, src).then(() => {
    if (state.gen !== gen) return;
    frame.appendChild(next);
    crossfade(current, next);
  });
}

// Paints an image card in place: builds the .artwork scaffold once, then only
// touches what actually changed.  `caption` is trusted HTML (callers escape),
// '' means no caption box; `onOpen` is re-read on every tap, so a refreshed
// photo list or config is always what the full-screen viewer receives.
export function renderImageCard(el, { src, alt = '', caption = '', label = 'View image full screen', contain = false, onOpen } = {}) {
  let state = cardState.get(el);
  let fig = el.querySelector('.artwork');
  if (!fig || !state) {
    // No scaffold yet, or the card was showing something else entirely (an
    // empty/setup state), so any remembered src is void.
    el.innerHTML = '<figure class="artwork" role="button" tabindex="0"><div class="artwork__frame"></div></figure>';
    fig = el.querySelector('.artwork');
    state = { src: '', caption: null, gen: 0, open: null };
    cardState.set(el, state);
    fig.addEventListener('click', () => state.open?.());
  }
  state.open = onOpen;
  fig.setAttribute('aria-label', label);
  fig.classList.toggle('artwork--contain', contain);
  if (state.caption !== caption) {
    setFigCaption(fig, caption);
    state.caption = caption;
  }
  // The card re-renders every 60 s but the photo only changes when its rotation
  // bucket flips.  Re-creating the <img> for an unchanged URL would re-decode
  // and re-paint the same picture dozens of times an hour, on every image card.
  if (state.src === src) return;
  state.src = src;
  paintImage(fig.querySelector('.artwork__frame'), src, alt, state);
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
  warmNeighbors();
}

// Swap in place: preload+decode first (slideshow pattern), then update img +
// caption.  Swapping only a decoded bitmap keeps a swipe from flashing a
// half-drawn photo across the full screen. The swap itself is a directional
// crossfade (Sean's pick, mockup D): the outgoing photo lives on as a
// positioned ghost drifting out while the real element eases in 36px from the
// swipe side — a dissolve, never a blink through black. Reduced motion swaps
// instantly, the pre-existing behavior.
const SWIPE_EASE = 'opacity 320ms cubic-bezier(0.22, 1, 0.36, 1), transform 320ms cubic-bezier(0.22, 1, 0.36, 1)';

// How a swiped transition behaves on this device. Full-size boards get the
// 320ms drift-fade ('drift'). Scaled companion panels (fitViewport zooms
// narrow Navigators, see util.js) get an atomic CUT: their GPU cannot raster
// a fresh full-viewport texture inside a short fade, so the fade began over
// blank pixels and the photo popped in mid-flight — Sean saw it as a flash,
// twice, on-device. A decode-gated single-frame swap creates no new painting
// work at gesture time, so there is nothing left to race; the instant answer
// is what prevents double swipes, and the slow AUTO dissolve stays (2.5s has
// always masked the upload lag). Reduced motion cuts too, as it always did.
const DRIFT_PX = 36;
export function swipeMode() {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return 'cut';
  return document.documentElement.style.zoom ? 'cut' : 'drift';
}

// Swiped swap for a single background-image element (the clock backdrop): the
// outgoing photo lives on as a ghost overlay fading out while `apply` swaps
// the element underneath, which drifts in when the device can afford it. The
// ghost copies its look inline because the element is styled by id.
export function swipeBackdropSwap(el, dir, apply) {
  if (swipeMode() === 'cut') { apply(); return; } // scaled panels: atomic, no ghost to raster
  const cs = getComputedStyle(el);
  const ghost = document.createElement('div');
  ghost.className = 'swipe-ghost';
  ghost.style.backgroundImage = el.style.backgroundImage || cs.backgroundImage;
  ghost.style.backgroundSize = cs.backgroundSize;
  ghost.style.backgroundPosition = cs.backgroundPosition;
  el.after(ghost);
  const drift = DRIFT_PX;
  if (drift) {
    el.style.transition = 'none';
    el.style.transform = `translateX(${dir * drift}px)`;
  }
  apply();
  void ghost.offsetWidth; // flush, so both halves start THIS frame
  ghost.style.opacity = '0';
  if (drift) {
    ghost.style.transform = `translateX(${-dir * drift}px)`;
    el.style.transition = SWIPE_EASE;
    el.style.transform = '';
  }
  setTimeout(() => { ghost.remove(); el.style.transition = ''; }, 400);
}

function step(viewer, dir) {
  if (!viewerList?.length) return;
  userStepped = true;
  viewerIndex = (viewerIndex + dir + viewerList.length) % viewerList.length;
  const item = viewerList[viewerIndex];
  loadImage(new Image(), item.img).then(() => {
    const imgEl = viewer.querySelector('.art-viewer__img:not(.art-viewer__img--ghost)');
    const reduce = swipeMode() === 'cut'; // reduced motion AND scaled panels: swap atomically
    if (!reduce) {
      viewer.querySelector('.art-viewer__img--ghost')?.remove(); // a double swipe retargets: one ghost at a time
      const ghost = imgEl.cloneNode();
      ghost.classList.add('art-viewer__img--ghost');
      // AFTER the live element: the ghost paints on top while it fades (the
      // classic crossfade order), and every plain '.art-viewer__img' query in
      // this file and the tests keeps finding the live element first.
      imgEl.after(ghost);
      void ghost.offsetWidth;
      const drift = DRIFT_PX;
      if (drift) ghost.style.transform = `translateX(${-dir * drift}px)`;
      ghost.style.opacity = '0';
      setTimeout(() => ghost.remove(), 400);
      imgEl.style.transition = 'none';
      if (drift) imgEl.style.transform = `translateX(${dir * drift}px)`;
      imgEl.style.opacity = '0';
    }
    imgEl.src = item.img;
    imgEl.alt = item.title ?? '';
    if (!reduce) {
      void imgEl.offsetWidth;
      imgEl.style.transition = SWIPE_EASE;
      imgEl.style.transform = '';
      imgEl.style.opacity = '';
    }
    renderViewerCaption(viewer, item);
    warmNeighbors();
  });
}

// Decode the swipe targets ahead of the gesture, so the transition starts the
// moment the finger lifts instead of after a network round trip — the gap
// that makes people doubt the swipe registered and swipe again.
function warmNeighbors() {
  if (!viewerList?.length || viewerList.length < 2) return;
  for (const d of [1, -1]) {
    const n = viewerList[(viewerIndex + d + viewerList.length) % viewerList.length];
    if (n) loadImage(new Image(), n.img);
  }
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

  function show(item, swipeDir = 0) {
    const next = layers[1 - active];
    const out = layers[active];
    // A swipe answers the gesture (Sean's pick, mockup D): both halves of the
    // crossfade run at 320ms with a 36px drift in the swipe direction, vs the
    // ambient advance's slow dissolve. The class carries the fast timing; the
    // offsets are one-shot inline transforms, cleared on the next show.
    const mode = swipeDir ? swipeMode() : 'auto';
    next.classList.toggle('slide--swipe', mode === 'drift');
    out.classList.toggle('slide--swipe', mode === 'drift');
    next.classList.toggle('slide--cut', mode === 'cut');
    out.classList.toggle('slide--cut', mode === 'cut');
    const drift = mode === 'drift' ? DRIFT_PX : 0;
    if (drift) {
      next.style.transition = 'none';
      next.style.transform = `translateX(${swipeDir * drift}px)`;
      void next.offsetWidth; // flush, so the drift starts THIS frame
      next.style.transition = '';
      out.style.transform = `translateX(${-swipeDir * drift}px)`;
    } else {
      next.style.transform = '';
      out.style.transform = '';
    }
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

  // Decode before the crossfade starts, so the incoming layer is a finished
  // picture the moment it becomes visible (a broken URL resolves too; the
  // background-image will retry).
  function preload(item, done) {
    loadImage(new Image(), item.img).then(() => done());
  }

  function advance(swipeDir = 0) {
    if (stopped) return;
    const item = itemAt(pos);
    pos += 1;
    preload(item, () => {
      // stop() during an in-flight preload must not resurrect the loop: the
      // pending onload/onerror would otherwise schedule an uncancellable chain.
      if (stopped) return;
      show(item, swipeDir);
      timer = setTimeout(() => advance(), intervalMs);
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
        advance(1);
        return;
      }
      pos = (pos - 2 + order.length) % order.length;
      const item = manifest[order[pos]];
      pos += 1;
      preload(item, () => {
        if (stopped) return;
        show(item, -1);
        timer = setTimeout(() => advance(), intervalMs);
      });
    },
    current() {
      return manifest[order[Math.max(pos - 1, 0)]] ?? null;
    },
  };
}
