// roomboard.app/info — the public widget guide. Two behaviors: a scroll-spy
// that highlights the current section in the sticky nav, and a click-to-zoom
// lightbox for the board screenshots. Lives in its own file because the page's
// CSP is script-src 'self' (no inline handlers).

const NAV_OFFSET = 140; // a section counts as "current" once its top passes this

// ---------- scroll-spy ----------
const sections = [...document.querySelectorAll('[data-nav-section]')];
const links = new Map(
  [...document.querySelectorAll('.nav__link')].map((a) => [a.getAttribute('href')?.slice(1), a]),
);

const nav = document.querySelector('.nav');
const navInner = document.querySelector('.nav__inner');

// The pill row scrolls horizontally on narrow screens, where a hard edge just
// looks like the nav ends. Fade whichever side still has nav behind it.
function syncFade() {
  if (!nav || !navInner) return;
  const max = navInner.scrollWidth - navInner.clientWidth;
  const x = navInner.scrollLeft;
  nav.classList.toggle('nav--fade-left', max > 1 && x > 1);
  nav.classList.toggle('nav--fade-right', max > 1 && x < max - 1);
}

let raf = 0;
let current = '';
let wasTop = null;
function syncNav() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    syncFade();
    let active = '';
    for (const s of sections) {
      if (s.getBoundingClientRect().top <= NAV_OFFSET) active = s.dataset.navSection;
    }
    // Above the first section (i.e. in the hero) nothing has crossed the offset
    // yet. Leaving `active` empty used to light nothing AND skip the
    // scrollIntoView below, so a reader who scrolled down and came back found a
    // dark rail still parked wherever they left it. Treat the top as the first
    // destination instead, and send the rail home so the brand is back too.
    const atTop = !active;
    if (atTop) active = sections[0]?.dataset.navSection ?? '';
    if (atTop !== wasTop) {
      wasTop = atTop;
      if (atTop && navInner) { navInner.scrollLeft = 0; syncFade(); }
    }
    if (active === current) return;
    links.get(current)?.classList.remove('is-active');
    links.get(active)?.classList.add('is-active');
    current = active;
    // Keep the current section's pill in view, going up as well as down: on a
    // phone the active pill is usually one the reader has already scrolled past
    // horizontally, in whichever direction they were travelling.
    if (!atTop) links.get(active)?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  });
}
if (sections.length) {
  window.addEventListener('scroll', syncNav, { passive: true });
  window.addEventListener('resize', syncNav, { passive: true });
  syncNav();
}
navInner?.addEventListener('scroll', syncFade, { passive: true });
window.addEventListener('resize', syncFade, { passive: true });
syncFade();

// ---------- lightbox ----------
// Built on demand so the page ships no empty <img> and nothing renders until a
// screenshot is actually opened.
let box = null;
let lastFocus = null;

function closeBox() {
  if (!box) return;
  box.remove();
  box = null;
  document.body.style.removeProperty('overflow');
  lastFocus?.focus?.();
  lastFocus = null;
}

function openBox(src, caption, alt) {
  closeBox();
  lastFocus = document.activeElement;
  box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', caption || 'Screenshot');
  box.tabIndex = -1;

  const img = document.createElement('img');
  img.className = 'lightbox__img';
  img.src = src;
  img.alt = alt || '';
  box.appendChild(img);

  if (caption) {
    const cap = document.createElement('span');
    cap.className = 'lightbox__cap';
    cap.textContent = caption;
    box.appendChild(cap);
  }
  const hint = document.createElement('span');
  hint.className = 'lightbox__hint';
  hint.textContent = 'Tap anywhere to close'; // the product's own idiom: the board is a touch panel
  box.appendChild(hint);

  box.addEventListener('click', closeBox);
  // Minimal trap: the overlay owns nothing focusable, so Tab would otherwise
  // walk the page behind it. Hold focus here until Escape or a tap closes it.
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    box.focus();
  });
  document.body.appendChild(box);
  document.body.style.overflow = 'hidden'; // don't scroll the page behind the overlay
  box.focus();
}

document.addEventListener('click', (e) => {
  // The opener is a real <button>, so Enter and Space arrive here as clicks
  // too; e.target is then the button rather than the image inside it.
  const btn = e.target.closest?.('.shot__btn');
  const img = btn ? btn.querySelector('img[data-zoom]') : e.target.closest?.('img[data-zoom]');
  if (!img) return;
  // .src is the one full-board asset at every width; the overlay just gives it
  // the whole screen instead of a column beside the copy.
  openBox(img.src, img.dataset.caption ?? '', img.alt);
});

// A screenshot that fails to load hides its whole figure rather than shipping a
// broken-image box — the copy stands on its own without the picture.
for (const img of document.querySelectorAll('img[data-zoom]')) {
  img.addEventListener('error', () => { img.closest('figure')?.setAttribute('hidden', ''); }, { once: true });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeBox();
});

// ---------- what's new ----------
// The changelog lives in data/changelog.json so adding a release note is a data
// edit, not markup surgery. Rendered rather than shipped as HTML for the same
// reason. Every value goes in through textContent: the copy is trusted, but a
// public page should never grow an innerHTML path.

// How many dated groups stand open. Three covers roughly the last week, which
// is what "what's new" actually means to a reader; the rest is history and
// waits behind one quiet control rather than adding ~1,000px to the end of the
// page. Nothing is dropped: the older groups are built and sit in the DOM,
// hidden, so revealing them is instant and never re-fetches.
const OPEN_GROUPS = 3;

function renderLog(root, groups) {
  const built = [];
  for (const g of groups) {
    if (!g || !g.date || !Array.isArray(g.items)) continue;
    const items = document.createElement('div');
    items.className = 'log__items';
    for (const item of g.items) {
      if (!item || !item.text) continue;
      const p = document.createElement('p');
      p.className = 'log__item';
      if (item.lead) {
        const lead = document.createElement('strong');
        lead.className = 'log__lead';
        lead.textContent = item.lead;
        p.appendChild(lead);
      }
      p.appendChild(document.createTextNode(item.text));
      items.appendChild(p);
    }
    if (!items.children.length) continue; // a group with no usable items is skipped
    const date = document.createElement('h3');
    date.className = 'log__date';
    date.textContent = g.date;
    const group = document.createElement('div');
    group.className = 'log__group';
    group.appendChild(date);
    group.appendChild(items);
    built.push(group);
  }
  if (!built.length) return;

  const frag = document.createDocumentFragment();
  for (const group of built.slice(0, OPEN_GROUPS)) frag.appendChild(group);

  if (built.length > OPEN_GROUPS) {
    const more = document.createElement('div');
    more.className = 'log__more';
    more.id = 'log-earlier';
    more.hidden = true;
    for (const group of built.slice(OPEN_GROUPS)) more.appendChild(group);

    // A disclosure, not a link: it stays put and stays reversible, so focus is
    // never dropped on the floor and a reader who opened history can close it.
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'log__toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', more.id);
    toggle.textContent = 'Show earlier updates';
    toggle.addEventListener('click', () => {
      const opening = more.hidden;
      more.hidden = !opening;
      toggle.setAttribute('aria-expanded', String(opening));
      toggle.textContent = opening ? 'Hide earlier updates' : 'Show earlier updates';
      syncNav(); // the page just changed height under the spy
    });

    frag.appendChild(toggle);
    frag.appendChild(more);
  }

  root.appendChild(frag);
  syncNav(); // the page just got taller: re-evaluate which section is current
}

// When the notes cannot be fetched (or come back unusable) the section used to
// stand there empty under its own heading, which reads as a broken page. Say so
// once, quietly, in the page's own words: the copy comes from data-fallback so
// it lives in the HTML with the rest of the copy.
function showLogFallback(root) {
  if (root.children.length) return;
  const p = document.createElement('p');
  p.className = 'log__empty';
  p.textContent = root.dataset.fallback || '';
  if (p.textContent) root.appendChild(p);
}

const logRoot = document.getElementById('log');
if (logRoot) {
  fetch('data/changelog.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((groups) => {
      if (Array.isArray(groups) && groups.length) renderLog(logRoot, groups);
      showLogFallback(logRoot); // no-op once a single group rendered
    })
    .catch(() => showLogFallback(logRoot));
}
