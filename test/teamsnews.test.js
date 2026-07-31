/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import {
  meta,
  SPORTS_SOURCES,
  DEFAULT_SPORTS_SOURCES,
  teamPhrases,
  matchesTeams,
  render,
  fetchData,
} from '../site/js/widgets/teamsnews.js';
import { newsFeedUrl } from '../worker/src/news.js';
import { DEMO_VMS } from '../site/demo/fixtures.js';

const el = () => document.createElement('div');
const story = (title, desc = '') => ({ title, desc, source: 'ESPN', t: 1783000000000 });

describe('teamsnews meta + sources', () => {
  it('is the Teams News card', () => {
    expect(meta.id).toBe('teamsnews');
    expect(meta.title).toBe('Teams News');
    expect(meta.refreshMs).toBe(10 * 60 * 1000);
  });

  it('offers between three and five sources, each id used once', () => {
    expect(SPORTS_SOURCES.length).toBeGreaterThanOrEqual(3);
    expect(SPORTS_SOURCES.length).toBeLessThanOrEqual(5);
    const ids = SPORTS_SOURCES.map((s) => s[0]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The half of the source table the page cannot check for itself: a proxy row
  // names a feed id the Worker has to know, and a typo there is a source that
  // silently 404s forever.
  it('every proxy source resolves in the Worker whitelist, every direct one is https', () => {
    for (const [id, label, kind, ref] of SPORTS_SOURCES) {
      expect(typeof label, id).toBe('string');
      if (kind === 'proxy') expect(newsFeedUrl(ref), id).toMatch(/^https:\/\//);
      else expect(ref, id).toMatch(/^https:\/\//);
    }
  });

  it('defaults to a subset of the offered sources', () => {
    const ids = new Set(SPORTS_SOURCES.map((s) => s[0]));
    expect(DEFAULT_SPORTS_SOURCES.length).toBeGreaterThan(0);
    for (const id of DEFAULT_SPORTS_SOURCES) expect(ids, id).toContain(id);
  });
});

describe('teamPhrases', () => {
  it('keeps a real nickname alongside the full name', () => {
    expect(teamPhrases({ name: 'New York Mets', nick: 'Mets' })).toEqual(['New York Mets', 'Mets']);
    expect(teamPhrases({ name: 'Boston Red Sox', nick: 'Red Sox' })).toEqual(['Boston Red Sox', 'Red Sox']);
    expect(teamPhrases({ name: 'Tottenham Hotspur', nick: 'Spurs' })).toEqual(['Tottenham Hotspur', 'Spurs']);
  });

  // The MLS problem: ESPN's short name there is the bare CITY, so following the
  // Sounders would drag in every Seahawks and Mariners story on the board.
  it('drops a short name that only prefixes the full one (the bare-city case)', () => {
    expect(teamPhrases({ name: 'Seattle Sounders FC', nick: 'Seattle' })).toEqual(['Seattle Sounders FC']);
    expect(teamPhrases({ name: 'Newcastle United', nick: 'Newcastle' })).toEqual(['Newcastle United']);
    expect(teamPhrases({ name: 'LAFC', nick: 'LAFC' })).toEqual(['LAFC']);
  });

  it('survives a team with no short name at all', () => {
    expect(teamPhrases({ name: 'Athletics' })).toEqual(['Athletics']);
    expect(teamPhrases({})).toEqual([]);
  });
});

describe('matchesTeams', () => {
  const mets = ['New York Mets', 'Mets'];

  it('matches the headline or the summary, either case', () => {
    expect(matchesTeams(story('Mets rally past Braves'), mets)).toBe(true);
    expect(matchesTeams(story('Late rally in Queens', 'The mets scored four'), mets)).toBe(true);
    expect(matchesTeams(story('Yankees win again'), mets)).toBe(false);
  });

  it('matches whole words only, so a longer word never counts', () => {
    expect(matchesTeams(story('Metsupply opens a store'), mets)).toBe(false);
    expect(matchesTeams(story('The Sox bullpen'), ['Boston Red Sox', 'Red Sox'])).toBe(false);
  });

  it('treats punctuation in a club name literally', () => {
    expect(matchesTeams(story('D.C. United sign a keeper'), ['D.C. United'])).toBe(true);
    expect(matchesTeams(story('DXCX United sign a keeper'), ['D.C. United'])).toBe(false);
  });

  it('keeps everything when there is nothing to match against', () => {
    expect(matchesTeams(story('Anything at all'), [])).toBe(true);
  });
});

describe('teamsnews render', () => {
  const vm = {
    items: [story('Mets rally past Braves'), story('Chiefs sign a tackle')],
    nowMs: 1783000100000,
  };

  it('draws the headlines it is handed', () => {
    const host = el();
    render(host, vm, {});
    expect(host.textContent).toContain('Mets rally');
    expect(host.textContent).toContain('Chiefs sign');
  });

  // An empty card has to point at the thing worth changing, and with the filter
  // on that is the filter, not the source picker.
  it('says which of the two empty states it is in', () => {
    const filtered = el();
    render(filtered, { items: [], nowMs: 0, filtered: true }, {});
    expect(filtered.textContent).toContain('your teams');
    expect(filtered.textContent).not.toContain('pick sources');

    const dry = el();
    render(dry, { items: [], nowMs: 0, filtered: false }, {});
    expect(dry.textContent).toContain('pick sources');
  });

  it('renders its demo fixture', () => {
    const host = el();
    render(host, DEMO_VMS.teamsnews, {});
    expect(host.textContent.length).toBeGreaterThan(0);
    expect(host.querySelector('.headline')).toBeTruthy();
  });
});

describe('teamsnews fetchData', () => {
  const item = (t) => `<item><title>${t}</title></item>`;
  const RSS = `<rss><channel>${item('Mets rally past Braves')}</channel></rss>`;
  const ROSTER = { leagues: [{ lg: 'mlb', label: 'MLB', teams: [
    { id: '21', abbr: 'NYM', name: 'New York Mets', nick: 'Mets' },
    { id: '10', abbr: 'NYY', name: 'New York Yankees', nick: 'Yankees' },
  ] }] };
  const FOLLOWING_METS = { sports: { teams: [{ lg: 'mlb', id: '21' }] } };
  const netFor = (roster = ROSTER, rss = RSS) => {
    const urls = [];
    return {
      urls,
      net: {
        fetchText: async (u) => { urls.push(u); return rss; },
        fetchJSON: async (u) => {
          urls.push(u);
          if (u.endsWith('teams.json')) {
            if (roster instanceof Error) throw roster;
            return roster;
          }
          return { xml: rss };
        },
      },
    };
  };

  // The roster read is memoized for the life of the page, so each case needs a
  // module of its own or the first success answers for all of them.
  const freshFetchData = async () => {
    vi.resetModules();
    return (await import('../site/js/widgets/teamsnews.js')).fetchData;
  };

  it('merges the picked sources and resolves the followed teams to match phrases', async () => {
    const { net } = netFor();
    const vm = await (await freshFetchData())(
      { teamsnews: { sources: ['espn'], onlyMyTeams: true }, ...FOLLOWING_METS },
      net,
    );
    expect(vm.items[0].title).toBe('Mets rally past Braves');
    expect(vm.teams).toContain('Mets');
    expect(vm.teams).not.toContain('Yankees');
    expect(vm.filtered).toBe(true);
  });

  it('leaves every story in place while the filter is off', async () => {
    const rss = `<rss><channel>${item('Mets rally past Braves')}${item('Chiefs sign a tackle')}</channel></rss>`;
    const { net } = netFor(ROSTER, rss);
    const vm = await (await freshFetchData())({ teamsnews: { sources: ['espn'] }, ...FOLLOWING_METS }, net);
    expect(vm.items.map((i) => i.title)).toContain('Chiefs sign a tackle');
    expect(vm.filtered).toBe(false);
  });

  it('keeps only the followed teams while the filter is on', async () => {
    const rss = `<rss><channel>${item('Mets rally past Braves')}${item('Chiefs sign a tackle')}</channel></rss>`;
    const { net } = netFor(ROSTER, rss);
    const vm = await (await freshFetchData())(
      { teamsnews: { sources: ['espn'], onlyMyTeams: true }, ...FOLLOWING_METS },
      net,
    );
    expect(vm.items.map((i) => i.title)).toEqual(['Mets rally past Braves']);
  });

  // THE RECALL RULE: the filter runs over the whole fetched feed, BEFORE the
  // merge trims to the newest 30. Filtering the trimmed list instead would mean
  // a team story only ever showed while it was among the freshest stories in
  // all of sport, which on a busy day is a card that is empty most of the time.
  it('filters the full feed, not just the stories that survived the merge trim', async () => {
    const noise = Array.from({ length: 40 }, (_, i) => item(`Unrelated story ${i}`)).join('');
    const rss = `<rss><channel>${noise}${item('Mets rally past Braves')}</channel></rss>`;
    const { net } = netFor(ROSTER, rss);
    const vm = await (await freshFetchData())(
      { teamsnews: { sources: ['espn'], onlyMyTeams: true }, ...FOLLOWING_METS },
      net,
    );
    expect(vm.items.map((i) => i.title)).toEqual(['Mets rally past Braves']);
  });

  // The toggle is reachable on a board with no teams picked; there it must stay
  // inert rather than empty the card.
  it('is inert when the board follows no teams', async () => {
    const { net, urls } = netFor();
    const vm = await (await freshFetchData())(
      { teamsnews: { sources: ['espn'], onlyMyTeams: true }, sports: { teams: [] } },
      net,
    );
    expect(vm.items).toHaveLength(1);
    expect(vm.filtered).toBe(false);
    expect(vm.teams).toEqual([]);
    expect(urls.some((u) => u.includes('teams.json'))).toBe(false);
  });

  it('still serves headlines when the roster lookup fails', async () => {
    const { net } = netFor(new Error('offline'));
    const vm = await (await freshFetchData())(
      { teamsnews: { sources: ['espn'], onlyMyTeams: true }, ...FOLLOWING_METS },
      net,
    );
    expect(vm.items).toHaveLength(1);
    expect(vm.teams).toEqual([]);
    expect(vm.filtered).toBe(false);
  });

  it('reads the roster once across refreshes, not once per cycle', async () => {
    const { net, urls } = netFor();
    const fetchDataFresh = await freshFetchData();
    const cfg = { teamsnews: { sources: ['espn'], onlyMyTeams: true }, ...FOLLOWING_METS };
    await fetchDataFresh(cfg, net);
    await fetchDataFresh(cfg, net);
    expect(urls.filter((u) => u.includes('teams.json'))).toHaveLength(1);
  });

  it('falls back to the default sources when the config names none', async () => {
    const { net, urls } = netFor();
    await fetchData({ sports: { teams: [] } }, net);
    expect(urls.length).toBe(DEFAULT_SPORTS_SOURCES.length);
  });
});
