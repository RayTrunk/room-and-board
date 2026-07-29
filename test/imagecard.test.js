/**
 * @vitest-environment happy-dom
 */
// The in-card image surface: every rotating image card (art, photos,
// landscapes, APOD) goes through renderImageCard, which must never put an
// undecoded bitmap on the glass and must not rebuild the <img> for a photo that
// has not changed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderImageCard, loadImage, CARD_FADE_MS } from '../site/js/imageshow.js';
import * as art from '../site/js/widgets/art.js';
import * as landscapes from '../site/js/widgets/landscapes.js';
import * as apod from '../site/js/widgets/apod.js';

const CFG = { name: 'Sean' };
const host = () => document.createElement('div');
const frameOf = (el) => el.querySelector('.artwork__frame');
const imgs = (el) => [...el.querySelectorAll('.artwork__img')];
const shown = (el) => imgs(el).map((i) => i.getAttribute('src'));

// Every decode() is captured instead of resolving, so a test decides exactly
// when a bitmap becomes ready — that is the ordering the whole fix rests on.
let pending = [];

beforeEach(() => {
  pending = [];
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(function decode() {
    return new Promise((resolve, reject) => { pending.push({ img: this, resolve, reject }); });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// Settle every outstanding decode, then let the .then() chains run.
async function settle(how = 'resolve') {
  const batch = pending;
  pending = [];
  for (const d of batch) d[how](how === 'reject' ? new Error('decode failed') : undefined);
  await Promise.resolve();
  await Promise.resolve();
}

// The engine's "the fade finished" signal (jsdom-style environments never run
// real transitions, so the test plays the browser's part).
const endTransition = (el) => el.dispatchEvent(new Event('transitionend'));

const paint = (el, src, extra = {}) => renderImageCard(el, { src, alt: '', ...extra });

describe('renderImageCard: first paint', () => {
  it('puts the <img> in the DOM straight away but keeps it invisible until the bitmap decodes', async () => {
    const el = host();
    paint(el, 'https://x.test/a.jpg');
    const img = el.querySelector('.artwork__img');
    // Synchronous markup: anything reading the card right after render still
    // finds the image and its src.
    expect(img.getAttribute('src')).toBe('https://x.test/a.jpg');
    expect(img.classList.contains('is-entering')).toBe(true); // opacity 0 in CSS
    await settle();
    expect(img.classList.contains('is-entering')).toBe(false); // fades up, no band-by-band draw
  });

  it('builds the scaffold once and never nests frames', () => {
    const el = host();
    paint(el, 'https://x.test/a.jpg');
    paint(el, 'https://x.test/a.jpg');
    expect(el.querySelectorAll('.artwork').length).toBe(1);
    expect(el.querySelectorAll('.artwork__frame').length).toBe(1);
  });

  it('renders no <img> at all for an empty src (a broken box is worse than nothing)', () => {
    const el = host();
    paint(el, '');
    expect(imgs(el)).toHaveLength(0);
    expect(frameOf(el)).not.toBeNull();
  });
});

describe('renderImageCard: decode before swap', () => {
  it('leaves the old photo up until the new one has decoded, then stacks and dissolves', async () => {
    const el = host();
    paint(el, 'https://x.test/a.jpg');
    await settle();

    paint(el, 'https://x.test/b.jpg');
    // Nothing has touched the DOM yet: the card still shows only photo A.
    expect(shown(el)).toEqual(['https://x.test/a.jpg']);

    await settle();
    // Both layers, new one on top (later in DOM order), entering from opacity 0.
    expect(shown(el)).toEqual(['https://x.test/a.jpg', 'https://x.test/b.jpg']);
    expect(imgs(el)[1].classList.contains('is-entering')).toBe(false); // released to fade in
  });

  it('swaps in the very element that was decoded, so the bitmap is not fetched twice', async () => {
    const el = host();
    paint(el, 'https://x.test/a.jpg');
    await settle();
    paint(el, 'https://x.test/b.jpg');
    const decoded = pending.at(-1).img;
    await settle();
    expect(imgs(el)[1]).toBe(decoded);
  });

  it('still swaps when decode rejects (a broken photo shows its alt, it does not freeze the card)', async () => {
    const el = host();
    paint(el, 'https://x.test/a.jpg');
    await settle();
    paint(el, 'https://x.test/b.jpg');
    await settle('reject');
    expect(shown(el)).toContain('https://x.test/b.jpg');
    endTransition(imgs(el).at(-1));
    expect(shown(el)).toEqual(['https://x.test/b.jpg']);
  });

  it('reveals the first photo even when its decode rejects, so the card is never left blank', async () => {
    const el = host();
    paint(el, 'https://x.test/bad.jpg');
    await settle('reject');
    expect(el.querySelector('.artwork__img').classList.contains('is-entering')).toBe(false);
  });

  it('drops a superseded load: the last requested photo wins', async () => {
    const el = host();
    paint(el, 'https://x.test/a.jpg');
    await settle();
    paint(el, 'https://x.test/b.jpg');
    const stale = pending.at(-1);
    paint(el, 'https://x.test/c.jpg');
    const fresh = pending.at(-1);
    fresh.resolve();
    stale.resolve(); // arrives late, must be ignored
    await Promise.resolve();
    await Promise.resolve();
    expect(shown(el)).toEqual(['https://x.test/a.jpg', 'https://x.test/c.jpg']);
  });
});

describe('renderImageCard: unchanged src is left alone', () => {
  it('keeps the same <img> element across refreshes and starts no new load', async () => {
    const el = host();
    paint(el, 'https://x.test/a.jpg');
    await settle();
    const first = el.querySelector('.artwork__img');
    pending = [];
    paint(el, 'https://x.test/a.jpg');
    paint(el, 'https://x.test/a.jpg');
    expect(pending).toHaveLength(0); // nothing re-decoded
    expect(el.querySelector('.artwork__img')).toBe(first); // same node, no re-paint
    expect(imgs(el)).toHaveLength(1);
  });

  it('still refreshes the tap target on an unchanged photo (the album list is re-fetched under it)', async () => {
    const el = host();
    let opened = '';
    renderImageCard(el, { src: 'https://x.test/a.jpg', onOpen: () => { opened = 'first list'; } });
    await settle();
    renderImageCard(el, { src: 'https://x.test/a.jpg', onOpen: () => { opened = 'refreshed list'; } });
    el.querySelector('.artwork').click();
    expect(opened).toBe('refreshed list');
  });

  it('updates a changed caption without touching the image', async () => {
    const el = host();
    renderImageCard(el, { src: 'https://x.test/a.jpg', caption: '<span>Old</span>' });
    await settle();
    const img = el.querySelector('.artwork__img');
    renderImageCard(el, { src: 'https://x.test/a.jpg', caption: '<span>New</span>' });
    expect(el.querySelector('.artwork__caption').textContent).toBe('New');
    expect(el.querySelector('.artwork__img')).toBe(img);
  });

  it('drops the caption box entirely when there is no caption', async () => {
    const el = host();
    renderImageCard(el, { src: 'https://x.test/a.jpg', caption: '<span>Titled</span>' });
    await settle();
    renderImageCard(el, { src: 'https://x.test/a.jpg', caption: '' });
    expect(el.querySelector('.artwork__caption')).toBeNull();
  });

  it('rebuilds after the card showed something else (an empty/setup state)', async () => {
    const el = host();
    paint(el, 'https://x.test/a.jpg');
    await settle();
    el.innerHTML = '<div class="empty">Landscapes unavailable right now.</div>';
    paint(el, 'https://x.test/a.jpg'); // same src, but the scaffold is gone
    expect(el.querySelector('.artwork__img').getAttribute('src')).toBe('https://x.test/a.jpg');
  });
});

describe('renderImageCard: the DOM does not grow', () => {
  it('keeps exactly one layer after each dissolve, over many rotations', async () => {
    const el = host();
    paint(el, 'https://x.test/0.jpg');
    await settle();
    for (let i = 1; i <= 12; i++) {
      paint(el, `https://x.test/${i}.jpg`);
      await settle();
      expect(imgs(el)).toHaveLength(2); // mid-dissolve: old under, new over
      endTransition(imgs(el).at(-1));
      expect(shown(el)).toEqual([`https://x.test/${i}.jpg`]);
    }
    expect(el.querySelectorAll('.artwork, .artwork__frame')).toHaveLength(2); // one of each
  });

  it('sweeps the old layer on a timer when no transition ever fires, and leaves nothing running', async () => {
    vi.useFakeTimers();
    const el = host();
    paint(el, 'https://x.test/a.jpg');
    await settle();
    paint(el, 'https://x.test/b.jpg');
    await settle();
    expect(imgs(el)).toHaveLength(2);
    vi.advanceTimersByTime(CARD_FADE_MS + 200);
    expect(shown(el)).toEqual(['https://x.test/b.jpg']);
    expect(vi.getTimerCount()).toBe(0); // no cost at all between rotations
  });

  it('clears the sweep timer when the transition ends first', async () => {
    vi.useFakeTimers();
    const el = host();
    paint(el, 'https://x.test/a.jpg');
    await settle();
    paint(el, 'https://x.test/b.jpg');
    await settle();
    expect(vi.getTimerCount()).toBe(1); // the net, armed for one fade
    endTransition(imgs(el).at(-1));
    expect(vi.getTimerCount()).toBe(0);
    expect(imgs(el)).toHaveLength(1);
  });
});

describe('renderImageCard: prefers-reduced-motion', () => {
  it('cuts straight to the new photo with no fade and no leftover layer', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true });
    vi.useFakeTimers();
    const el = host();
    paint(el, 'https://x.test/a.jpg');
    await settle();
    paint(el, 'https://x.test/b.jpg');
    await settle();
    // Instant: one layer, already visible, no transition to wait on.
    expect(shown(el)).toEqual(['https://x.test/b.jpg']);
    expect(el.querySelector('.artwork__img').classList.contains('is-entering')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('loadImage', () => {
  it('falls back to the load event on an engine without decode()', async () => {
    HTMLImageElement.prototype.decode.mockRestore();
    const img = document.createElement('img');
    delete img.decode;
    Object.defineProperty(img, 'decode', { value: undefined, configurable: true });
    Object.defineProperty(img, 'complete', { value: false, configurable: true });
    let done = false;
    loadImage(img, 'https://x.test/a.jpg').then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    img.onload();
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it('resolves once, even if both decode and the load event report in', async () => {
    const img = document.createElement('img');
    let count = 0;
    loadImage(img, 'https://x.test/a.jpg').then(() => { count++; });
    pending.at(-1).resolve();
    img.onload();
    img.onerror();
    await Promise.resolve();
    await Promise.resolve();
    expect(count).toBe(1);
  });
});

describe('every rotating image card shares the surface', () => {
  const vmA = { img: 'https://x.test/art-a.jpg', title: 'Wheat Fields', artist: 'Ruisdael', year: '1670' };
  const vmB = { img: 'https://x.test/art-b.jpg', title: 'Sea View', artist: 'Vroom', year: '1620' };

  it('art dissolves between works and keeps its caption', async () => {
    const el = host();
    art.render(el, vmA, CFG);
    await settle();
    expect(el.querySelector('.artwork__title').textContent).toBe('Wheat Fields');
    art.render(el, vmB, CFG);
    expect(shown(el)).toEqual(['https://x.test/art-a.jpg']); // nothing before decode
    await settle();
    expect(shown(el)).toEqual(['https://x.test/art-a.jpg', 'https://x.test/art-b.jpg']);
    endTransition(imgs(el).at(-1));
    expect(el.querySelector('.artwork__artist').textContent).toBe('Vroom (1620)');
  });

  it('landscapes/photos dissolve, and a tap opens the photo that is actually showing', async () => {
    document.querySelector('#art-viewer')?.remove();
    const el = host();
    landscapes.render(el, { photos: [{ img: 'https://x.test/l1.jpg', title: '' }] }, CFG);
    await settle();
    expect(el.querySelector('.artwork__caption')).toBeNull(); // untitled photo, no box
    landscapes.render(el, { photos: [{ img: 'https://x.test/l2.jpg', title: 'Fjord' }] }, CFG);
    await settle();
    endTransition(imgs(el).at(-1));
    expect(shown(el)).toEqual(['https://x.test/l2.jpg']);
    el.querySelector('.artwork').click();
    expect(document.querySelector('#art-viewer .art-viewer__img').getAttribute('src')).toBe('https://x.test/l2.jpg');
    document.querySelector('#art-viewer')?.remove();
  });

  it('apod holds its one photo across the 30 minute refresh instead of re-decoding it', async () => {
    const el = host();
    const vm = { photo: { url: 'https://x.test/apod.jpg', title: 'Messier 24', credit: 'Chuck Ayoub', explanation: 'A star cloud.' } };
    apod.render(el, vm, CFG);
    await settle();
    const img = el.querySelector('.artwork__img');
    pending = [];
    apod.render(el, vm, CFG);
    apod.render(el, { photo: { ...vm.photo } }, CFG);
    expect(pending).toHaveLength(0);
    expect(el.querySelector('.artwork__img')).toBe(img);
    expect(el.querySelector('.artwork__title').textContent).toBe('Messier 24');
  });
});
