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

// The guide is the one page a stranger reads first, so the brand it prints is
// worth a guard. Source text, not a DOM: the point is what ships on disk.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const html = await readFile(resolve(process.cwd(), 'site/info.html'), 'utf8');
const css = await readFile(resolve(process.cwd(), 'site/css/info.css'), 'utf8');

describe('/info wears the brand', () => {
  it('is titled for the product, and never title-cases it', () => {
    expect(html).toContain('<title>unsleep · Widget Guide</title>');
    // Lowercase, always. The one place a capital U could sneak back in is a
    // sentence start, so the rule is checked against the whole file.
    expect(html).not.toMatch(/Unsleep/);
    expect(css).not.toMatch(/Unsleep/);
  });

  it('carries no display mention of the retired name (URLs are a separate phase)', () => {
    const prose = html.replace(/https?:\/\/[^\s"'<>]+|>[^<]*quadrille\.io[^<]*</gi, '');
    expect(prose).not.toMatch(/quadrill/i);
    expect(css).not.toMatch(/quadrill/i);
  });

  it('sets the wordmark as three plain spans, not the old glyph-cover trick', () => {
    // Live, selectable text: no aria-hidden twin, no clip, nothing drawn twice.
    // The whole word has to come out of textContent in order.
    const mark = /<span class="umark"><span class="umark__un">un<\/span><span class="umark__sl">\/<\/span><span class="umark__sleep">sleep<\/span><\/span>/g;
    expect(html.match(mark)).toHaveLength(2); // the nav brand and the masthead
    expect(html).not.toMatch(/qmark/);
    expect(css).not.toMatch(/qmark/);
  });

  it('lights exactly one card on the masthead panel, and nothing sits behind the word', () => {
    // "The accent marks what is awake" is the system rule the hero draws, so
    // one solid accent card and three at descending light.
    expect((html.match(/class="hero__card /g) || []).length).toBe(4);
    expect((html.match(/hero__card--lit/g) || []).length).toBe(1);
    // The old field's class names stay dead; the RULING itself came back at
    // Sean's call (2026-08-18): the faint grid may run under the word, the
    // way the first masthead drew it, but it must stay a drawn ruling, never
    // imagery. So the panel's background-image is allowed to be exactly
    // linear-gradients, and a url() behind the letters is still a failure.
    expect(css).not.toMatch(/hero__field|hero__mod/);
    const screen = /\.hero__screen\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(screen).toContain('linear-gradient');
    expect(screen).not.toContain('url(');
  });

  it('points the head icons at the new masters', () => {
    expect(html).toContain('href="assets/unsleep-quad.svg"');
    // PNGs, not SVGs, for the raster slots: iOS ignores an SVG
    // apple-touch-icon and would fall back to a page screenshot.
    expect(html).toContain('href="assets/unsleep-favicon-32.png"');
    expect(html).toContain('href="assets/unsleep-icon-180.png"');
  });
});
