// Word of the day from the bundled curated list — zero API dependency, and
// the same deterministic day index as the quote widget (shared dailyPick).

import { escapeHtml, dailyPick } from '../util.js';
import { cardSize, sizeTier } from '../capacity.js';
import { t } from '../i18n.js';

export const meta = { id: 'wotd', title: 'Word of the Day', refreshMs: 24 * 60 * 60 * 1000 };

const LANG_WORD_FILE = { de: 'data/words.de.json' };

export function render(el, vm, _cfg) {
  const [w, h] = cardSize(el, [3, 3]);
  // Shallow cards have no vertical room; 2-wide portrait cards wrap the
  // definition so deep the example's tail clips. Both drop the example.
  const showExample = sizeTier(h) !== 's' && w > 2 && vm.ex;
  const metaLine = vm.pr
    ? `${escapeHtml(vm.pr)} · <i>${escapeHtml(vm.pos)}</i>`
    : `<i>${escapeHtml(vm.pos)}</i>`;
  el.innerHTML = `
    <div class=”wotd”>
      <div class=”wotd__label”>${escapeHtml(t('wotd.title'))}</div>
      <div class=”wotd__word”>${escapeHtml(vm.w)}</div>
      <div class=”wotd__meta”>${metaLine}</div>
      <div class=”wotd__def”>${escapeHtml(vm.def)}</div>
      ${showExample ? `<div class=”wotd__ex”>”${escapeHtml(vm.ex)}”</div>` : ''}
    </div>`;
  // A single long word has no break opportunity and would clip at the card
  // edge (font metrics vary per device — the board has none of our named
  // fonts). Scale the word down to fit, floored at the 20px legibility
  // minimum; guarded so layout-less test environments skip it.
  const wordEl = el.querySelector('.wotd__word');
  if (wordEl && wordEl.clientWidth > 0 && wordEl.scrollWidth > wordEl.clientWidth) {
    const base = parseFloat(getComputedStyle(wordEl).fontSize);
    wordEl.style.fontSize = `${Math.max(20, Math.floor((base * wordEl.clientWidth) / wordEl.scrollWidth))}px`;
  }
}

export async function fetchData(cfg, net) {
  const file = LANG_WORD_FILE[cfg?.lang] ?? 'data/words.json';
  const words = await net.fetchJSON(file);
  return dailyPick(words, new Date());
}
