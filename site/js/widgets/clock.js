// Clock, date and greeting for the top bar. Renders locally, no network.

import { t, currentLang } from '../i18n.js';

export const meta = { id: 'clock', title: 'Clock', refreshMs: 30 * 1000 };

export function greetingFor(name, date) {
  const h = date.getHours();
  const base = h < 12 ? t('ui.good_morning') : h < 18 ? t('ui.good_afternoon') : t('ui.good_evening');
  return name ? `${base}, ${name}` : base;
}

export function render(el, _vm, cfg) {
  const now = new Date();
  const locale = currentLang() === 'en' ? 'en-US' : currentLang();
  const time = now.toLocaleTimeString(locale, cfg?.clock24
    ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    : { hour: 'numeric', minute: '2-digit' });
  const date = now.toLocaleDateString(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const mode = cfg?.greetingMode ?? 'auto';
  let greetingHtml;
  if (mode === 'off') {
    greetingHtml = '<div class="topbar__greeting topbar__greeting--off"></div>';
  } else if (mode === 'logo' && cfg?.logo) {
    greetingHtml = `<div class="topbar__greeting"><img class="topbar__logo" src="${escapeHtml(cfg.logo)}" alt="Logo"></div>`;
  } else if (mode === 'name') {
    greetingHtml = `<div class="topbar__greeting">${escapeHtml(cfg?.name ?? '')}</div>`;
  } else {
    greetingHtml = `<div class="topbar__greeting">${escapeHtml(greetingFor(cfg?.name ?? '', now))}</div>`;
  }
  el.innerHTML = `
    ${greetingHtml}
    <div class="topbar__clock">
      <span class="topbar__time">${time}</span>
      <span class="topbar__date">${date}</span>
    </div>`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
