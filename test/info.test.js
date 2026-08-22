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
const shell = await readFile(resolve(process.cwd(), 'site/css/main.css'), 'utf8');
const macro = await readFile(resolve(process.cwd(), 'macro/Dashboard.js'), 'utf8');
const terms = await readFile(resolve(process.cwd(), 'site/terms.html'), 'utf8');
const frontdoor = await readFile(resolve(process.cwd(), 'tools/build-frontdoor.js'), 'utf8');
const settings = await readFile(resolve(process.cwd(), 'site/js/settings/settings.js'), 'utf8');

describe('/info wears the brand', () => {
  it('is titled for the product, and never title-cases it', () => {
    // The tab carries the tagline, not "Widget Guide": the page is the
    // product's front door now, and this string is also what search results
    // and link previews show (Sean's call, 2026-08-18).
    expect(html).toContain('<title>idlescreen · A dashboard for your idle screen</title>');
    // Lowercase, always. The one place a capital I could sneak back in is a
    // sentence start, so the rule is checked against the whole file — and the
    // camel-cased "IdleScreen" is named too, because one word means one word.
    expect(html).not.toMatch(/Idlescreen|IdleScreen/);
    expect(css).not.toMatch(/Idlescreen|IdleScreen/);
    // The retired name kept its own lowercase rule, and this still catches
    // residue: a sentence that was rewritten around "unsleep" and left
    // title-cased is a rename that only half landed.
    expect(html).not.toMatch(/Unsleep/);
    expect(css).not.toMatch(/Unsleep/);
  });

  it('carries no display mention of the retired names (URLs are a separate phase)', () => {
    // Addresses are exempt: quadrille.io and unsleep.app still answer, and the
    // lede says so on purpose. What must not survive is either retired name as
    // the PRODUCT's name in a sentence.
    const prose = html.replace(/https?:\/\/[^\s"'<>]+|>[^<]*(?:quadrille\.io|unsleep\.(?:app|io))[^<]*</gi, '');
    expect(prose).not.toMatch(/quadrill/i);
    expect(css).not.toMatch(/quadrill/i);
    expect(prose).not.toMatch(/unsleep/i);
    expect(css).not.toMatch(/unsleep/i);
  });

  it('sets the wordmark as two plain spans holding the exact word', () => {
    // Live, selectable text: no aria-hidden twin, no clip, nothing drawn twice.
    // The whole word has to come out of textContent in order.
    const mark = /<span class="imark(?: imark--led)?"><span class="imark__idle">idle<\/span><span class="imark__screen">screen<\/span><\/span>/g;
    expect(html.match(mark)).toHaveLength(3); // nav brand, masthead (LED), footer lockup
    expect(html).not.toMatch(/qmark|umark/);
    // Selectors, not the words: info.css still names the retired qmark in
    // prose, because why that construction was abandoned is the reason this
    // one is built the way it is.
    expect(css).not.toMatch(/\.(?:qmark|umark)\b/);
    expect(shell).not.toMatch(/\.(?:qmark|umark)\b/);

    // What the reader COPIES, which is the whole reason the accent is drawn
    // rather than typed. The brand sheet set the LED over a dotless ı (U+0131);
    // that spells "ıdlescreen" into a clipboard, a find bar, and a screen
    // reader, so it is banned on sight in both spellings.
    const host = document.createElement('div');
    host.innerHTML = html.match(mark)[0];
    expect(host.firstElementChild.textContent).toBe('idlescreen');
    // Comments are stripped first: both stylesheets name the glyph in prose,
    // and the comment explaining the ban is not a breach of it.
    expect(html.replace(/<!--[^]*?-->/g, '')).not.toMatch(/&#305;|ı/);
    expect(css.replace(/\/\*[^]*?\*\//g, '')).not.toMatch(/&#305;|ı/);
    expect(shell.replace(/\/\*[^]*?\*\//g, '')).not.toMatch(/&#305;|ı/);
  });

  it('spends the accent once per lockup, and the masthead alone wears the LED', () => {
    // The rule: wherever the mark is present it is the mark's lit card that
    // carries the blue, and the word beside it keeps its plain tittle at
    // every size — so the nav and footer lockups never take the modifier.
    // The masthead DOES (Sean's call at the rename vet, 2026-08-21): the
    // word stands alone at display scale there, the panel's cards being the
    // hero illustration's scenery rather than a lockup mark, and the LED
    // tittle is the wordmark's signature. Exactly one instance, on the h1.
    expect(html.match(/imark--led/g)).toHaveLength(1);
    expect(html).toMatch(/hero__title"><span class="imark imark--led"/);
    expect(html).not.toMatch(/nav__brand[^\n]*imark--led/);
    expect(html).not.toMatch(/footer__brand[^\n]*imark--led/);
    // The modifier exists identically in both sheets.
    expect(css).toMatch(/\.imark--led \.imark__idle::before/);
    expect(shell).toMatch(/\.imark--led \.imark__idle::before/);
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
    expect(html).toContain('href="assets/idlescreen-quad.svg"');
    // PNGs, not SVGs, for the raster slots: iOS ignores an SVG
    // apple-touch-icon and would fall back to a page screenshot.
    expect(html).toContain('href="assets/idlescreen-favicon-32.png"');
    expect(html).toContain('href="assets/idlescreen-icon-180.png"');
  });

  it('keeps the shell\'s copy of the wordmark identical to this one', () => {
    // Two stylesheets, one component: the guide and the app shell both set the
    // mark, and a value that drifts between them ships two brands. Compare the
    // declarations rather than the prose around them.
    const rules = (sheet) => [...sheet.matchAll(/^\.imark[^{]*\{[^}]*\}/gms)]
      .map((m) => m[0].replace(/\/\*.*?\*\//gs, '').replace(/\s+/g, ' ').trim());
    expect(rules(shell)).toEqual(rules(css));
    expect(rules(css).length).toBeGreaterThan(3);
  });
});

describe('/info says how idlescreen gets on a board', () => {
  // The gap this closes: the guide serves from idlescreen.io and the dashboard
  // from idlescreen.app, so before 2026-08-19 a stranger could not work out the
  // address to point a board at from anything on the page.
  it('answers the question before the page assumes the answer', () => {
    const board = html.indexOf('id="board"');
    const yours = html.indexOf('id="yours"');
    expect(board).toBeGreaterThan(-1);
    // Everything under Making it yours assumes a board already showing
    // idlescreen, so the install cannot come after it.
    expect(board).toBeLessThan(yours);
    expect(html).toContain('<a class="nav__link" href="#board">');
  });

  it('agrees with the macro about the address', () => {
    // The README once claimed this default had already moved while the macro
    // still shipped app.quadrille.io — a drift nobody could see from either
    // file alone, and the page teaches whatever the macro does not. Two
    // sources, one assertion, and it has now survived two renames.
    const shipped = /const SIGNAGE_URL = '([^']+)'/.exec(macro)?.[1];
    expect(shipped).toBe('https://idlescreen.app');
    expect(html).toContain('xConfiguration Standby Signage Url: https://idlescreen.app');
  });

  it('spells out the touch setting RoomOS does not turn on for you', () => {
    // InteractionMode defaults to NonInteractive: the board shows the
    // dashboard perfectly and ignores every tap, which reads as a broken
    // dashboard rather than a missing setting (Sean's catch, 2026-08-19).
    expect(html).toContain('xConfiguration Standby Signage InteractionMode: Interactive');
  });

  it('sends the reader somewhere the macro can actually be got', () => {
    // The page names the file; naming it without a source is a dead end.
    expect(html).toContain('https://github.com/scotty83/unsleep/blob/main/macro/Dashboard.js');
  });

  it('gives every quoted line its own block, so a hanging indent can hold', () => {
    // text-indent on the <pre> catches the first line only, which leaves a
    // wrapped xConfiguration reading as two settings on a phone.
    const pre = /<pre class="conf">(.*?)<\/pre>/s.exec(html)?.[1] ?? '';
    expect((pre.match(/<span class="conf__l">/g) || []).length).toBe(4);
    expect(pre).not.toMatch(/\n/);
    expect(css).toMatch(/\.conf__l\s*\{[^}]*text-indent/);
  });
});

describe('/terms', () => {
  it('wears the same name and the same icons as the guide', () => {
    expect(terms).toContain('<title>Terms · idlescreen</title>');
    expect(terms).not.toMatch(/Idlescreen|IdleScreen|Unsleep/);
    expect(terms).not.toMatch(/umark|&#305;|ı/);
    expect(terms).toContain('href="assets/idlescreen-quad.svg"');
    expect(terms).toContain('href="assets/idlescreen-favicon-32.png"');
    expect(terms).toContain('href="assets/idlescreen-icon-180.png"');
  });

  it('the service clause names the current pair and stays quiet about the rest', () => {
    // Sean's call at the rename vet (2026-08-21): the roll-call of every
    // earlier address read as archaeology, and the page serves on all of
    // those domains anyway — whoever reads it from unsleep.app/terms is
    // reading THIS page. The clause names the current pair only.
    const service = /The service<\/h2>\s*<p class="row__desc">([^]*?)<\/p>/.exec(terms)?.[1] ?? '';
    for (const host of ['idlescreen.io', 'idlescreen.app']) expect(service).toContain(host);
    expect(service).not.toContain('quadrille');
    expect(service).not.toContain('roomboard');
  });

  it('is reachable from the guide and reaches back', () => {
    expect(html).toContain('<a class="footer__link" href="terms.html">Terms</a>');
    expect(terms).toContain('href="info.html"');
  });

  it('keeps every internal link relative, because it serves from two origins', () => {
    // The same bytes answer on idlescreen.io (where the guide is the root) and
    // idlescreen.app (where it is /info). A root-absolute link resolves on one
    // and 404s on the other, and nothing in CI would notice.
    const internal = [...terms.matchAll(/href="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((h) => !/^https?:/.test(h) && !h.startsWith('#'));
    expect(internal.length).toBeGreaterThan(0);
    for (const href of internal) expect(href.startsWith('/')).toBe(false);
  });

  it('ships to the front door as well as the app', () => {
    // build-frontdoor.js fails the build when the guide references a file it
    // does not copy, so this is belt to that brace: it catches the case where
    // BOTH the footer link and the copy are dropped together.
    expect(frontdoor).toContain("['terms.html', 'terms.html']");
  });

  it('keeps every superseded icon set shipping beside the current one', () => {
    // The front door caches normally, and Pages propagates PER-ASSET, so HTML
    // cached under an earlier name is still being served after the rename and
    // still asks for the icons that name used. Dropping a set 404s them on a
    // page nobody can force to refresh, so the list only ever grows.
    for (const name of ['idlescreen', 'unsleep']) {
      expect(frontdoor).toContain(`['assets/${name}-quad.svg', 'assets/${name}-quad.svg']`);
      expect(frontdoor).toContain(`['assets/${name}-favicon-32.png', 'assets/${name}-favicon-32.png']`);
      expect(frontdoor).toContain(`['assets/${name}-icon-180.png', 'assets/${name}-icon-180.png']`);
    }
    expect(frontdoor).toContain("['assets/quadrille-favicon-32.png', 'assets/quadrille-favicon-32.png']");
    expect(frontdoor).toContain("['assets/quadrille-icon-180.png', 'assets/quadrille-icon-180.png']");
  });

  it('carries the clauses a reviewer looks for, not just the honest ones', () => {
    expect(terms).toMatch(/as is and as available/i);
    expect(terms).toMatch(/warranties are disclaimed/i);
    expect(terms).toMatch(/Cloudflare/);
    // The security posture is a strength and the page used to omit it, which
    // left a reviewer's most-asked question answered by silence.
    expect(terms).toMatch(/Content-Security-Policy/);
    // The examples of "it got something wrong" have to be things idlescreen
    // actually shows. It has no calendar and never has (Sean's catch,
    // 2026-08-19), so a late meeting was promising a feature. The macro
    // clause's `wake-at-meeting-start` is a RoomOS config name and stays.
    expect(terms).not.toMatch(/a meeting joined late/);
    // Sean's call, 2026-08-19: the page names no individual. The liability
    // exclusion runs to "the maintainer", and LICENSE stays the one place
    // the copyright holder is named (MIT requires that notice be kept).
    expect(terms).not.toMatch(/Sean Scott/);
  });

  it('names the beacon opt-out exactly as the board spells it', () => {
    // Terms that point at a setting by the wrong name are worse than terms
    // that omit it: the reader hunts, fails, and concludes there is no
    // opt-out. Two files, one assertion, same guard as the macro URL.
    expect(settings).toContain('Anonymous usage ping');
    expect(terms).toContain('Anonymous usage ping');
  });

  it('borrows the guide\'s stylesheet instead of growing its own', () => {
    expect(terms).toContain('href="css/info.css"');
    expect(terms).not.toMatch(/<script/);
  });
});
