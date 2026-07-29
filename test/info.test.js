/**
 * @vitest-environment happy-dom
 */
// The /info scroll-spy. happy-dom lays nothing out, so the page's geometry is
// scripted: every section keeps a document-space top and the viewport reports
// where it currently is, which is exactly the input syncNav reads.
import { describe, it, expect, vi } from 'vitest';

const SECTIONS = ['yours', 'commute', 'screensavers', 'whatsnew'];
const TOP = { yours: 800, commute: 2000, screensavers: 4200, whatsnew: 5400 };

// A 1440-tall viewport on a 6000-tall page: the real 2560x1440 case, where the
// last section is shorter than the screen.
const view = { scrollY: 0, innerHeight: 1440, scrollHeight: 6000 };

document.body.innerHTML = `
  <nav class="nav"><div class="nav__inner">
    ${SECTIONS.map((id) => `<a class="nav__link" href="#${id}">${id}</a>`).join('')}
  </div></nav>
  ${SECTIONS.map((id) => `<section id="${id}" data-nav-section="${id}"></section>`).join('')}
`;
for (const el of document.querySelectorAll('[data-nav-section]')) {
  el.getBoundingClientRect = () => ({ top: TOP[el.dataset.navSection] - view.scrollY });
}
Object.defineProperty(window, 'scrollY', { configurable: true, get: () => view.scrollY });
Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => view.innerHeight });
Object.defineProperty(document.documentElement, 'scrollHeight', {
  configurable: true,
  get: () => view.scrollHeight,
});
Element.prototype.scrollIntoView ??= () => {};
// Run the spy's frame inline. The handle must be 0: syncNav stores whatever
// this returns as its "a frame is already queued" flag, and a synchronous
// callback clears that flag BEFORE the assignment lands.
vi.stubGlobal('requestAnimationFrame', (cb) => { cb(); return 0; });

await import('../site/js/info.js'); // module-scoped: reads the DOM built above

const navInner = document.querySelector('.nav__inner');
const scrollTo = (y) => {
  view.scrollY = y;
  window.dispatchEvent(new Event('scroll'));
};
const active = () => document.querySelector('.nav__link.is-active')?.getAttribute('href')?.slice(1) ?? '';

describe('/info scroll-spy', () => {
  it('lights the section whose top has passed the nav offset', () => {
    scrollTo(2500);
    expect(active()).toBe('commute');
  });

  it('lights the LAST section once the page bottoms out', () => {
    // The bug: at the very end of a tall viewport the last section's heading is
    // on screen but still 840px down, so the offset math never reaches it and
    // "Screensavers" stayed lit while the reader looked at "What's new".
    scrollTo(view.scrollHeight - view.innerHeight);
    expect(active()).toBe('whatsnew');
  });

  it('holds the last section through the slack at the very end', () => {
    scrollTo(view.scrollHeight - view.innerHeight - 3); // a fractional-pixel zoom
    expect(active()).toBe('whatsnew');
  });

  it('goes back to the first pill at the top, and sends the rail home with it', () => {
    scrollTo(3000);
    navInner.scrollLeft = 120; // the reader dragged the pill row while scrolling
    scrollTo(0);
    expect(active()).toBe('yours');
    expect(navInner.scrollLeft).toBe(0);
  });

  it('keeps the first pill on a page short enough to be top and bottom at once', () => {
    const tall = view.scrollHeight;
    view.scrollHeight = view.innerHeight; // nothing to scroll
    try {
      scrollTo(0);
      expect(active()).toBe('yours');
    } finally {
      view.scrollHeight = tall;
    }
  });
});
