/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { closeExpand, isExpandOpen, initExpand, setExpandSource, openExpand } from '../site/js/expand.js';
import { render as renderLirr } from '../site/js/widgets/lirr.js';
import { render as renderMnr } from '../site/js/widgets/mnr.js';
import { render as renderNjt } from '../site/js/widgets/njt.js';
import { render as renderFerry } from '../site/js/widgets/ferry.js';

const overlay = () => document.querySelector('#expand-view');

// A one-card board with the delegated expand listener wired, as main.js does.
// Rail capacity at 3x2 is two rows (RAIL_ROWS), so five departures hide three.
function railBoard(widget, renderFn, vm, cfg = {}, [w, h] = [3, 2]) {
  document.body.innerHTML = `
    <div id="grid">
      <article class="card card--${widget}" data-widget="${widget}" data-w="${w}" data-h="${h}">
        <h2 class="card__title">x</h2>
        <span class="card__note"></span>
        <div class="card__body"></div>
        <div class="card__stamp" hidden></div>
      </article>
    </div>
    <div id="settings-root"></div>
    <div id="edit-root"></div>`;
  const grid = document.querySelector('#grid');
  initExpand(grid);
  const card = grid.querySelector('.card');
  renderFn(card.querySelector('.card__body'), vm, cfg);
  return { grid, card };
}

const lirrDep = (i) => ({
  t: 1000 + i * 600, min: 10 + i * 10, dest: `Stop ${i}`, destId: String(i),
  branch: 'Babylon', routeId: '1', trainNum: String(100 + i),
  track: i === 0 ? '18' : null, origin: 'penn',
});
const lirrVm = (n) => ({ departures: Array.from({ length: n }, (_, i) => lirrDep(i)), destName: 'Rockville Centre' });

beforeEach(() => {
  closeExpand();
  document.body.innerHTML = '';
});

describe('rail +N pill', () => {
  it('shows a tappable "+N more" pill when departures overflow the card', () => {
    const { card } = railBoard('lirr', renderLirr, lirrVm(5));
    const pill = card.querySelector('.card__more');
    expect(pill).not.toBeNull();
    expect(pill.classList.contains('card__more--pill')).toBe(true);
    expect(pill.textContent).toBe('+3 more');
    expect(card.classList.contains('is-expandable')).toBe(true);
    expect(card.classList.contains('is-expandable-pill')).toBe(true);
  });

  it('opens only from the pill: a tap elsewhere on the card stays inert', () => {
    const { card } = railBoard('lirr', renderLirr, lirrVm(5));
    card.querySelector('.card__body').click();
    expect(isExpandOpen()).toBe(false);
    card.querySelector('.card__more').click();
    expect(isExpandOpen()).toBe(true);
  });

  it('expands to every departure the card knows, in the standard rows', () => {
    const { card } = railBoard('lirr', renderLirr, lirrVm(5));
    expect(card.querySelectorAll('.train').length).toBe(2); // capped card
    card.querySelector('.card__more').click();
    expect(overlay().querySelectorAll('.train').length).toBe(5);
    expect(overlay().querySelector('.expand__title').textContent).toBe('LIRR');
    expect(overlay().querySelector('.expand__note').textContent).toBe('stops at Rockville Centre');
    expect(overlay().textContent).toContain('Track 18'); // tracks carried through
    expect(overlay().querySelector('.trains--board')).not.toBeNull(); // two-column grid
  });

  it('is inert when everything fits: no pill, no expansion', () => {
    const { card } = railBoard('lirr', renderLirr, lirrVm(2));
    expect(card.querySelector('.card__more')).toBeNull();
    expect(card.classList.contains('is-expandable')).toBe(false);
    expect(card.classList.contains('is-expandable-pill')).toBe(false);
    card.click();
    expect(isExpandOpen()).toBe(false);
  });

  it('alert banners no longer pre-charge a train row (the fit and the pill absorb them)', () => {
    // A 3x2 card promises 2 rows. The old pre-deduction charged each banner a
    // row BEFORE measuring (a 72px banner charged as a 61px row under-filled
    // the card); now the full promise renders and fitTrainRows sheds what
    // genuinely does not fit into the pill count.
    const vm = { ...lirrVm(5), alerts: [{ routes: [], stops: [], header: 'Delays.' }] };
    const { card } = railBoard('lirr', renderLirr, vm);
    expect(card.querySelectorAll('.train').length).toBe(2);
    expect(card.querySelector('.card__more').textContent).toBe('+3 more');
  });

  it('drops the pill and the expansion when a refresh leaves nothing hidden', () => {
    const { card } = railBoard('lirr', renderLirr, lirrVm(5));
    expect(card.classList.contains('is-expandable')).toBe(true);
    renderLirr(card.querySelector('.card__body'), lirrVm(2), {});
    expect(card.querySelector('.card__more')).toBeNull();
    expect(card.classList.contains('is-expandable')).toBe(false);
    expect(card.classList.contains('is-expandable-pill')).toBe(false);
  });

  it('keeps the snapshot when the source card re-renders underneath it', () => {
    const { card } = railBoard('lirr', renderLirr, lirrVm(5));
    card.querySelector('.card__more').click();
    const before = overlay().innerHTML;
    expect(overlay().textContent).toContain('Stop 4');
    renderLirr(card.querySelector('.card__body'), lirrVm(3), {});
    expect(overlay().innerHTML).toBe(before);
  });
});

describe('rail +N on the other boards', () => {
  const njtVm = (n) => ({
    trains: Array.from({ length: n }, (_, i) => ({
      time: 1000 + i * 600, min: 10 + i * 10, dest: `Dest ${i}`, line: 'NEC',
      track: null, status: '',
    })),
    alerts: [{ header: 'Track work this weekend.' }],
  });

  it('NJT: alert banners stay on the card, never in the overlay', () => {
    // Banners are not pre-charged a row (the measured fit sheds instead), so
    // the 3x2 promise of 2 rows holds and three of five trains hide.
    const { card } = railBoard('njt', renderNjt, njtVm(5));
    expect(card.querySelector('.card__more').textContent).toBe('+3 more');
    card.querySelector('.card__more').click();
    expect(overlay().querySelectorAll('.train').length).toBe(5);
    expect(overlay().querySelector('.talert')).toBeNull();
  });

  it('Metro-North: pill and full board', () => {
    const vm = { departures: Array.from({ length: 5 }, (_, i) => ({
      t: 1000 + i * 600, min: 10 + i * 10, dest: `Stop ${i}`, destId: String(i),
      branch: 'Harlem', routeId: '2', track: null,
    })), destName: 'Southeast' };
    const { card } = railBoard('mnr', renderMnr, vm);
    expect(card.querySelector('.card__more').textContent).toBe('+3 more');
    card.querySelector('.card__more').click();
    expect(overlay().querySelectorAll('.train').length).toBe(5);
    expect(overlay().querySelector('.expand__title').textContent).toBe('Metro-North');
  });

  it('Ferry: pill and full board', () => {
    const vm = { landingName: 'Wall St/Pier 11', departures: Array.from({ length: 5 }, (_, i) => ({
      t: 1000 + i * 600, min: 10 + i * 10, dest: `Landing ${i}`, route: null,
    })) };
    const { card } = railBoard('ferry', renderFerry, vm);
    expect(card.querySelector('.card__more').textContent).toBe('+3 more');
    card.querySelector('.card__more').click();
    expect(overlay().querySelectorAll('.train').length).toBe(5);
  });
});

describe('expand engine trigger option', () => {
  it('narrows the tap target to the selector when one is registered', () => {
    document.body.innerHTML = `
      <div id="grid"><article class="card"><div class="card__body"><i class="go"></i></div></article></div>
      <div id="settings-root"></div><div id="edit-root"></div>`;
    const grid = document.querySelector('#grid');
    initExpand(grid);
    const card = grid.querySelector('.card');
    setExpandSource(card.querySelector('.card__body'), () => ({ title: 'T', bodyHtml: '<p>x</p>' }), { trigger: '.go' });
    card.querySelector('.card__body').click();
    expect(isExpandOpen()).toBe(false);
    card.querySelector('.go').click();
    expect(isExpandOpen()).toBe(true);
  });

  it('keeps whole-card taps for sources registered without one (markets contract)', () => {
    document.body.innerHTML = `
      <div id="grid"><article class="card"><div class="card__body"></div></article></div>
      <div id="settings-root"></div><div id="edit-root"></div>`;
    const grid = document.querySelector('#grid');
    initExpand(grid);
    const card = grid.querySelector('.card');
    setExpandSource(card.querySelector('.card__body'), () => ({ title: 'T', bodyHtml: '<p>x</p>' }));
    card.querySelector('.card__body').click();
    expect(isExpandOpen()).toBe(true);
  });
});
