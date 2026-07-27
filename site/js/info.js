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

let raf = 0;
let current = '';
function syncNav() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    let active = '';
    for (const s of sections) {
      if (s.getBoundingClientRect().top <= NAV_OFFSET) active = s.dataset.navSection;
    }
    if (active === current) return;
    links.get(current)?.classList.remove('is-active');
    links.get(active)?.classList.add('is-active');
    current = active;
  });
}
if (sections.length) {
  window.addEventListener('scroll', syncNav, { passive: true });
  window.addEventListener('resize', syncNav, { passive: true });
  syncNav();
}

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
  hint.textContent = 'Click anywhere to close';
  box.appendChild(hint);

  box.addEventListener('click', closeBox);
  document.body.appendChild(box);
  document.body.style.overflow = 'hidden'; // don't scroll the page behind the overlay
  box.focus();
}

document.addEventListener('click', (e) => {
  const img = e.target.closest?.('img[data-zoom]');
  if (!img) return;
  openBox(img.currentSrc || img.src, img.dataset.caption ?? '', img.alt);
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
function renderLog(root, groups) {
  const frag = document.createDocumentFragment();
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
    frag.appendChild(group);
  }
  if (!frag.childNodes.length) return;
  root.appendChild(frag);
  syncNav(); // the page just got taller: re-evaluate which section is current
}

const logRoot = document.getElementById('log');
if (logRoot) {
  // Failure is silent on purpose: a visitor gets the rest of the guide, never a
  // fetch error. The section keeps its heading and reads as simply empty.
  fetch('data/changelog.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((groups) => { if (Array.isArray(groups)) renderLog(logRoot, groups); })
    .catch(() => {});
}
