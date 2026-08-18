/**
 * @vitest-environment happy-dom
 *
 * Settings → What's new: the board's own copy of the /info changelog.
 *
 * Two things here need a note. First, the pane is built with innerHTML (the
 * settings surface's idiom) where /info builds the same data with textContent,
 * so the escaping test is what earns this module its keep. Second, happy-dom
 * has no layout engine and reports 0 for both scrollHeight and clientHeight, so
 * fitChangelog is a no-op against a real element here — the fold arithmetic is
 * therefore driven through a pane whose two heights are DEFINED, which tests
 * the loop itself rather than the browser's box model. The real geometry is
 * verified in a browser through site/_settings-audit.html?whatsnew=1.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  changelogHtml, fitChangelog, wireChangelog, loadChangelog, paneHtml, emptyHtml,
  railFootHtml, MIN_OPEN_GROUPS, CHANGELOG_URL, EMPTY_COPY,
} from '../site/js/settings/whatsnew.js';

const shipped = JSON.parse(await readFile(resolve(process.cwd(), 'site/data/changelog.json'), 'utf8'));

const group = (date, n = 1) => ({
  date,
  items: Array.from({ length: n }, (_, i) => ({ lead: `Lead ${i}`, text: `Text ${i} for ${date}.` })),
});
const many = (n) => Array.from({ length: n }, (_, i) => group(`Day ${i}`));

// A pane whose overflow is a pure function of how many groups are still in the
// flow: `budget` groups fit, everything past that overflows. That is exactly
// the signal a real layout gives fitChangelog, minus the browser.
function fakePane(html, budget) {
  const pane = document.createElement('div');
  pane.innerHTML = html;
  const openGroups = () => pane.querySelectorAll('.log > .log__group').length;
  Object.defineProperty(pane, 'clientHeight', { get: () => 100 });
  Object.defineProperty(pane, 'scrollHeight', { get: () => (openGroups() <= budget ? 100 : 101) });
  return pane;
}

describe('changelogHtml', () => {
  it('renders every usable group, newest first, with the disclosure and an empty drawer', () => {
    const html = changelogHtml([group('July 29', 2), group('July 28'), group('July 27')]);
    expect([...html.matchAll(/class="log__group"/g)]).toHaveLength(3);
    expect(html.indexOf('July 29')).toBeLessThan(html.indexOf('July 28'));
    expect(html.indexOf('July 28')).toBeLessThan(html.indexOf('July 27'));
    expect(html).toContain('data-log-more');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('id="log-earlier"');
    // The drawer ships EMPTY: every group starts open and fitChangelog demotes.
    expect(html).toMatch(/<div class="log__more" id="log-earlier" hidden><\/div>/);
  });

  it('skips a group with no date, no items array, or no item carrying text', () => {
    const html = changelogHtml([
      { items: [{ text: 'no date' }] },
      { date: 'July 1' },
      { date: 'July 2', items: [{ lead: 'Lead only' }] },
      group('July 3'),
    ]);
    expect([...html.matchAll(/class="log__group"/g)]).toHaveLength(1);
    expect(html).toContain('July 3');
    expect(html).not.toContain('July 1');
    expect(html).not.toContain('July 2'); // an empty hairline is worse than nothing
  });

  it('omits the disclosure entirely when there is only one group', () => {
    const html = changelogHtml([group('July 29', 4)]);
    expect(html).toContain('log__group');
    expect(html).not.toContain('data-log-more');
  });

  it('escapes lead, text and date — the pane is innerHTML, unlike /info', () => {
    // Parsed, not string-matched: what matters is that no ELEMENT comes out of
    // the data, and that the reader still sees the characters that were in it.
    const host = document.createElement('div');
    host.innerHTML = changelogHtml([{
      date: '<img src=x onerror=alert(1)>',
      items: [{ lead: '"><script>bad()</script>', text: 'a & b <b>c</b>' }],
    }, group('July 1')]);
    expect(host.querySelectorAll('img, script, b:not(.log__lead)')).toHaveLength(0);
    expect(host.querySelector('.log__date').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(host.querySelector('.log__lead').textContent).toBe('"><script>bad()</script>');
    expect(host.querySelector('.log__item').textContent).toContain('a & b <b>c</b>');
  });

  it('returns nothing usable for an empty, null or junk list', () => {
    expect(changelogHtml([])).toBe('');
    expect(changelogHtml(null)).toBe('');
    expect(changelogHtml(undefined)).toBe('');
    expect(changelogHtml([null, {}, 7])).toBe('');
  });
});

describe('fitChangelog folds a growing history into what the pane can seat', () => {
  it('demotes trailing groups until it fits, keeping the newest open', () => {
    const pane = fakePane(changelogHtml(many(12)), 3);
    expect(fitChangelog(pane)).toBe(9);
    expect(pane.querySelectorAll('.log > .log__group')).toHaveLength(3);
    expect(pane.querySelectorAll('.log__more > .log__group')).toHaveLength(9);
    expect(pane.scrollHeight).toBeLessThanOrEqual(pane.clientHeight); // it really fits now
    // Newest stays open, oldest goes to the back of the drawer: order is kept.
    expect(pane.querySelector('.log > .log__group .log__date').textContent).toBe('Day 0');
    const drawer = [...pane.querySelectorAll('.log__more .log__date')].map((d) => d.textContent);
    expect(drawer).toEqual(['Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7', 'Day 8', 'Day 9', 'Day 10', 'Day 11']);
  });

  it('labels the disclosure with the number it moved', () => {
    const pane = fakePane(changelogHtml(many(12)), 3);
    fitChangelog(pane);
    const toggle = pane.querySelector('[data-log-more]');
    expect(toggle.hidden).toBe(false);
    expect(toggle.querySelector('.log__count').textContent).toBe('· 9 more');
    expect(toggle.querySelector('.log__label').textContent).toBe('Show earlier updates');
  });

  it('floors at one open group even when that one group still overflows', () => {
    const pane = fakePane(changelogHtml(many(12)), 0); // nothing ever fits
    expect(fitChangelog(pane)).toBe(11);
    expect(pane.querySelectorAll('.log > .log__group')).toHaveLength(MIN_OPEN_GROUPS);
    expect(MIN_OPEN_GROUPS).toBe(1);
    // The pane simply scrolls in this case, which is its own normal behaviour.
    expect(pane.scrollHeight).toBeGreaterThan(pane.clientHeight);
  });

  it('hides the control when the whole history fits: no drawer, no disclosure', () => {
    const pane = fakePane(changelogHtml(many(4)), 99);
    expect(fitChangelog(pane)).toBe(0);
    expect(pane.querySelector('[data-log-more]').hidden).toBe(true);
    expect(pane.querySelectorAll('.log__more > .log__group')).toHaveLength(0);
  });

  it('is a safe no-op with no pane, no log, and on the empty state', () => {
    expect(fitChangelog(null)).toBe(0);
    expect(fitChangelog(undefined)).toBe(0);
    expect(fitChangelog(document.createElement('div'))).toBe(0);
    const empty = document.createElement('div');
    empty.innerHTML = emptyHtml();
    expect(fitChangelog(empty)).toBe(0);
    // A single-group history has no toggle to label or hide.
    const one = fakePane(changelogHtml([group('July 29')]), 0);
    expect(fitChangelog(one)).toBe(0);
  });

  it('leaves every group open where there is no layout at all (happy-dom, 0/0)', () => {
    // Not a curiosity: it is what makes the module safe to render headless, and
    // it is why the numbers above are driven through a defined-height pane.
    const pane = document.createElement('div');
    pane.innerHTML = changelogHtml(many(12));
    expect(pane.scrollHeight).toBe(0);
    expect(fitChangelog(pane)).toBe(0);
    expect(pane.querySelectorAll('.log > .log__group')).toHaveLength(12);
  });

  it('folds the shipped changelog rather than a fixture', () => {
    const pane = fakePane(changelogHtml(shipped), 2);
    const demoted = fitChangelog(pane);
    expect(demoted).toBe(shipped.length - 2);
    expect(pane.querySelectorAll('.log > .log__group')).toHaveLength(2);
  });
});

describe('wireChangelog', () => {
  it('toggles the drawer, the label and aria-expanded, both ways', () => {
    const pane = fakePane(changelogHtml(many(12)), 3);
    fitChangelog(pane);
    wireChangelog(pane);
    const toggle = pane.querySelector('[data-log-more]');
    const more = pane.querySelector('#log-earlier');
    expect(more.hidden).toBe(true);
    toggle.click();
    expect(more.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.querySelector('.log__label').textContent).toBe('Hide earlier updates');
    toggle.click();
    expect(more.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.querySelector('.log__label').textContent).toBe('Show earlier updates');
  });

  it('does not throw when there is no toggle (the empty state)', () => {
    const pane = document.createElement('div');
    pane.innerHTML = emptyHtml();
    expect(() => wireChangelog(pane)).not.toThrow();
  });
});

describe('loadChangelog never throws — the board has no console to show it in', () => {
  it('reads the changelog off the board’s own origin, relative', () => {
    expect(CHANGELOG_URL).toBe('data/changelog.json');
    expect(CHANGELOG_URL.startsWith('/')).toBe(false); // beta. and preview deploys too
    expect(CHANGELOG_URL).not.toMatch(/^https?:/); // and never the worker
  });

  it('resolves to null for a rejected fetch, a non-array body and an empty array', async () => {
    await expect(loadChangelog(() => Promise.reject(new Error('offline')))).resolves.toBeNull();
    await expect(loadChangelog(() => Promise.resolve({ nope: true }))).resolves.toBeNull();
    await expect(loadChangelog(() => Promise.resolve('<!doctype html>'))).resolves.toBeNull();
    await expect(loadChangelog(() => Promise.resolve([]))).resolves.toBeNull();
    await expect(loadChangelog(() => Promise.resolve(null))).resolves.toBeNull();
  });

  it('passes the groups straight through when the file is good', async () => {
    const fetchJSON = vi.fn().mockResolvedValue(shipped);
    await expect(loadChangelog(fetchJSON)).resolves.toEqual(shipped);
    expect(fetchJSON).toHaveBeenCalledWith('data/changelog.json');
  });
});

describe('paneHtml', () => {
  it('carries the title, hint, back control and colophon', () => {
    const html = paneHtml(shipped, { build: 'fa395c8b41d2' });
    expect(html).toContain('What’s new');
    expect(html).toContain('data-wn-back');
    expect(html).toContain('aria-label="Back to settings"');
    expect(html).toContain('nothing to install');
    expect(html).toContain('version fa395c8b41d2');
    expect(html).toContain('quadrille.io');
  });

  it('shows one quiet line, still under its own heading, when the notes are missing', () => {
    for (const groups of [null, undefined]) {
      const html = paneHtml(groups);
      expect(html).toContain('log__empty');
      expect(html).toContain('quadrille.io');
      expect(html).toContain('What’s new'); // the pane never renders bare
      expect(html).not.toContain('data-log-more');
    }
    expect(EMPTY_COPY).toContain('quadrille.io');
  });

  it('drops the version clause rather than printing an empty one', () => {
    // Scoped to the colophon: the notes themselves may well say "version".
    const foot = /<p class="log__foot">(.*?)<\/p>/.exec(paneHtml(shipped))[1];
    expect(foot).toBe('unsleep · full guide at quadrille.io');
    expect(foot).not.toMatch(/·\s*·/);
  });

  it('escapes the build id', () => {
    expect(paneHtml(shipped, { build: '<img onerror=x>' })).not.toContain('<img onerror');
  });
});

describe('the rail-footer entry point', () => {
  it('is a control that names itself', () => {
    const html = railFootHtml();
    expect(html).toContain('data-whatsnew');
    expect(html).toContain('What’s new');
    expect(html).toContain('type="button"');
  });

  it('carries no build id — the label and the caret, and nothing else', () => {
    // A version number is something you go looking for once; the rail was
    // showing it to everyone who walked past. The control's whole caption is
    // now the two words, with the caret drawn by .settings__wnline::after.
    const line = /<span class="settings__wnline">(.*?)<\/span>/s.exec(railFootHtml())[1];
    expect(line).toBe('What’s new');
    const html = railFootHtml();
    expect(html).not.toContain('settings__ver');
    expect(html).not.toMatch(/[0-9a-f]{7}/); // no build id, short or full
    // It also takes no version to render: nothing here depends on the poll.
    expect(railFootHtml.length).toBe(0);
  });

  it('leaves the pane’s colophon as the one place a board states its version', () => {
    // The load-bearing half of the removal. If this ever fails, the July 29
    // changelog line "The board also shows which version it is running" has
    // stopped being true and has to go with it.
    expect(paneHtml(shipped, { build: 'fa395c8b41d2' })).toContain('version fa395c8b41d2');
    expect(railFootHtml()).not.toContain('fa395c8b41d2');
  });

  it('keeps the wordmark decorative inside the control, not a second label', () => {
    // The lockup is the button's face; it is hidden from the accessibility tree
    // so the accessible name is the caption alone, not "un/sleep What's new".
    // The wordmark is set in text rather than drawn as an image, which is why
    // hiding it takes aria-hidden instead of an empty alt.
    const html = railFootHtml();
    expect(html).toMatch(/<span class="settings__lockup umark" aria-hidden="true">/);
    expect(html).not.toContain('<img');
    const host = document.createElement('div');
    host.innerHTML = html;
    const lockup = host.querySelector('.settings__lockup');
    expect(lockup.getAttribute('aria-hidden')).toBe('true');
    // Three plain spans and nothing else: the whole mark is real text, so the
    // DOM reads the name exactly once with no hidden or duplicated glyphs.
    // Class names are shared with info.css, so a rename here is a rename there.
    expect(lockup.querySelector('.umark__un').textContent).toBe('un');
    expect(lockup.querySelector('.umark__sl').textContent).toBe('/');
    expect(lockup.querySelector('.umark__sleep').textContent).toBe('sleep');
    expect(lockup.textContent).toBe('un/sleep');
    expect(lockup.querySelector('[hidden]')).toBeNull();
  });
});
