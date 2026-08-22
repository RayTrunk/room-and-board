// roomboard.app/info — the public widget guide. Three behaviors: a scroll-spy
// that highlights the current section in the sticky nav, a click-to-zoom
// lightbox for the board screenshots, and the changelog rendered from JSON.
// Lives in its own file because the page's CSP is script-src 'self' (no inline
// handlers). The catalogue's disclosures are native <details> and need no
// script at all; the only thing here is deep-link courtesy.

const NAV_OFFSET = 140; // a section counts as "current" once its top passes this
const BOTTOM_SLACK = 4; // fractional-pixel zooms never land exactly on the end

// True once there is no page left to scroll. On a tall viewport the last
// section is shorter than the screen, so its top never reaches NAV_OFFSET and
// the offset math alone would keep the SECOND-to-last pill lit while the reader
// is looking at the end of the page (2560x1440 and 4K both do it, as does any
// viewport once a short last section — a changelog that failed to load, say —
// is all that remains).
const atBottom = () =>
  window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - BOTTOM_SLACK;

// ---------- scroll-spy ----------
const sections = [...document.querySelectorAll('[data-nav-section]')];
const links = new Map(
  [...document.querySelectorAll('.nav__link')].map((a) => [a.getAttribute('href')?.slice(1), a]),
);

const nav = document.querySelector('.nav');
const navInner = document.querySelector('.nav__inner');

// ---------- the glide pill ----------
// The active highlight is ONE element that travels between labels, not four
// backgrounds trading places: the slide says "the same selection moved", and
// its direction mirrors the reader's scroll (Sean's pick 2026-08-13, mockup A
// of three). Created here rather than in the HTML so a page without script
// keeps today's per-link fallback; the nav--glide class is what retires the
// static background, so the pill and the class must arrive together.
const pill = (() => {
  if (!navInner || !sections.length) return null;
  const el = document.createElement('div');
  el.className = 'nav__pill';
  el.setAttribute('aria-hidden', 'true');
  navInner.prepend(el);
  nav.classList.add('nav--glide');
  return el;
})();

// animate=false is for placements that are not a section change (first paint,
// resize, the web font arriving): the pill must LAND there, not travel there.
// The transition lives in the stylesheet; suppressing it needs the reflow
// flush, or the browser coalesces the none and the restore into one style.
function placePill(link, animate) {
  if (!pill) return;
  if (!link) return;
  if (!animate) pill.style.transition = 'none';
  pill.style.top = `${link.offsetTop}px`;
  pill.style.height = `${link.offsetHeight}px`;
  pill.style.left = `${link.offsetLeft}px`;
  pill.style.width = `${link.offsetWidth}px`;
  if (!animate) {
    void pill.offsetWidth;
    pill.style.transition = '';
  }
}
// Label widths shift when CiscoSans lands over the fallback face; re-measure
// then, and on every resize (which can also reflow the row's wrapping).
document.fonts?.ready?.then?.(() => placePill(links.get(current), false));
window.addEventListener('resize', () => placePill(links.get(current), false), { passive: true });

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
    // The mirror of that clause at the other end: bottomed out, the last
    // section is where the reader is, whatever its top says. (A page short
    // enough to be at the top AND the bottom at once keeps the top's answer —
    // nothing has been scrolled past.)
    else if (atBottom()) active = sections[sections.length - 1]?.dataset.navSection ?? active;
    if (atTop !== wasTop) {
      wasTop = atTop;
      if (atTop && navInner) { navInner.scrollLeft = 0; syncFade(); }
    }
    if (active === current) return;
    links.get(current)?.classList.remove('is-active');
    links.get(active)?.classList.add('is-active');
    // First placement (current still '') lands without motion; every change
    // after that glides.
    placePill(links.get(active), Boolean(current));
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

// ---------- the folded index ----------
// Every group's <details> keeps the id its old standalone section had, so
// /info#commute and the rest still land. Landing on a CLOSED fold would show a
// reader the one summary line instead of the guide they linked to, so a hash
// that names a fold opens it. Opening only adds height below the anchor, so
// the browser's own scroll stays correct either way.
const folds = [...document.querySelectorAll('.fold')];
function openHashFold() {
  const id = location.hash.slice(1);
  if (!id) return;
  let el = null;
  try { el = document.getElementById(decodeURIComponent(id)); } catch { el = document.getElementById(id); }
  if (el?.tagName === 'DETAILS') el.open = true;
}
if (folds.length) {
  openHashFold();
  window.addEventListener('hashchange', () => { openHashFold(); syncNav(); });
  // A fold that opens or closes changes the page height under the spy, the
  // same way the changelog's "show earlier" does. (`toggle` does not bubble,
  // hence one listener per fold.)
  for (const fold of folds) fold.addEventListener('toggle', syncNav);

  // ---------- the unfold ----------
  // A tapped group used to appear fully formed between two frames. Now the
  // list sweeps open while the rows arrive on a short cascade (the spine grows
  // alongside, from the stylesheet); close is the reverse, faster and plain.
  // Only real taps animate: hash deep-links and the print hooks above set
  // .open directly, because a reader following a link wants the guide, not a
  // performance. Native <details> semantics survive throughout, since all this
  // handler does differently is choose WHEN .open flips.
  const FOLD_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const noMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  for (const fold of folds) {
    const sum = fold.querySelector('.fold__sum');
    const list = fold.querySelector('.list');
    if (!sum || !list || !list.animate) continue;
    let busy = false;
    sum.addEventListener('click', (e) => {
      e.preventDefault();
      if (busy) return;
      if (noMotion) { fold.open = !fold.open; return; }
      busy = true;
      // Confined for the sweep only: a permanent overflow:hidden would clip
      // focus rings at the list edge.
      list.style.overflow = 'hidden';
      const settle = () => { busy = false; list.style.overflow = ''; };
      // The list's padding-bottom rides the keyframes too; with border-box
      // sizing a bare height:0 would bottom out at the padding and leave a
      // sliver standing.
      const pb = getComputedStyle(list).paddingBottom;
      if (!fold.open) {
        fold.open = true;
        const grow = list.animate(
          [{ height: '0px', paddingBottom: '0px' }, { height: `${list.scrollHeight}px`, paddingBottom: pb }],
          { duration: 300, easing: FOLD_EASE },
        );
        list.querySelectorAll('.row').forEach((row, i) => {
          row.animate(
            [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
            { duration: 260, delay: 60 + Math.min(i, 6) * 28, easing: FOLD_EASE, fill: 'backwards' },
          );
        });
        grow.onfinish = grow.oncancel = settle;
      } else {
        const rows = [...list.querySelectorAll('.row')];
        rows.forEach((row) => row.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' }));
        const shrink = list.animate(
          [{ height: `${list.scrollHeight}px`, paddingBottom: pb }, { height: '0px', paddingBottom: '0px' }],
          { duration: 200, easing: 'ease-in' },
        );
        shrink.onfinish = () => {
          fold.open = false;
          settle();
          rows.forEach((row) => row.getAnimations().forEach((a) => a.cancel()));
        };
        shrink.oncancel = settle;
      }
    });
  }

  // Paper has no disclosure. info.css opens ::details-content under @media
  // print, which is what print PREVIEW and print-to-PDF see; this is the other
  // half, for browsers that do not support that pseudo yet. Open every fold
  // before the sheet is composed and put the reader's own folds back after, so
  // printing never silently rearranges the page they were reading.
  let restore = null;
  const printOpen = () => {
    restore = folds.map((f) => f.open);
    for (const f of folds) f.open = true;
  };
  const printRestore = () => {
    if (!restore) return;
    folds.forEach((f, i) => { f.open = restore[i]; });
    restore = null;
  };
  window.addEventListener('beforeprint', printOpen);
  window.addEventListener('afterprint', printRestore);
  // Safari fires neither reliably; it flips this media query instead.
  window.matchMedia?.('print')?.addEventListener?.('change', (e) => (e.matches ? printOpen() : printRestore()));
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

// ---------- hero grid snap ----------
// The masthead's ruling came back 2026-08-18 (Sean's call), and with it the
// snap: the panel's rendered box rounds to whole cells so the right and
// bottom keylines land on rules, exactly like the retired field. Width floors
// (never wider than the column), height ceils (never tighter than the word's
// band needs), and the +2 on each is the two 1px keylines. Without JS nothing
// breaks: the keyline still closes the edge cells, the grid is just not
// whole-cell.
const heroScreen = document.querySelector('.hero__screen');
function snapHeroScreen() {
  heroScreen.style.width = '';
  heroScreen.style.height = '';
  const cell = parseFloat(getComputedStyle(heroScreen).getPropertyValue('--cell'));
  const w = heroScreen.getBoundingClientRect().width;
  if (!cell || !w) return; // test DOMs have no layout; leave the panel fluid
  heroScreen.style.width = `${Math.floor((w - 2) / cell) * cell + 2}px`;
  const h = heroScreen.getBoundingClientRect().height;
  heroScreen.style.height = `${Math.ceil((h - 2) / cell) * cell + 2}px`;
}
if (heroScreen) {
  snapHeroScreen();
  window.addEventListener('resize', snapHeroScreen, { passive: true });
  document.fonts?.ready?.then(snapHeroScreen).catch(() => {});
}

// ---------- the masthead's power tittle ----------
// The masthead h1 wears .imark--led, whose tittle is the IEC power symbol drawn
// over a cover disc (info.css carries the full construction and the reasoning).
// Placing it needs numbers that belong to the RENDERED FACE rather than to the
// design: where the baseline sits inside the inline box, where the letter's own
// tittle sits above that baseline, and where the stem's top and centre are (the
// ring hangs midway down the gap between tittle and stem, so both ends of that
// gap are measurements, not constants).
// One stack apart (Helvetica Neue, which is what Chrome resolves here, against
// the generic sans one entry further down) the baseline alone moves 0.045em,
// which is 2.9px of misplaced mark at the masthead's 64px, so no single static
// offset serves them. The stylesheet ships the Helvetica Neue numbers as var()
// fallbacks and this probe replaces them with the truth for the face that
// actually loaded; info.css tabulates all of them.
// It is a progressive enhancement and must stay one. A DOM with no layout
// (happy-dom) and a browser with no canvas both leave the fallbacks standing,
// which is a correct masthead, only not a per-face one: everything below
// feature-detects, sanity-checks its own answer, and publishes nothing at all
// rather than publish a number it does not believe.
const SCAN_PX = 200; // ink-scan at 200px, so one scanned pixel is 1/200 em
const SCAN_H = SCAN_PX * 2;
const SCAN_PEN = SCAN_PX * 0.25; // the pen sits in from the edge: no side bearing can clip
const SCAN_BASE = SCAN_PX * 1.5; // ...and the whole ascender fits above the baseline
const INK = 32; // alpha over this is ink; under it is the antialiased skirt

// The rendered face's own "i", scanned: the tittle's box and the stem's centre,
// in em off the pen origin and the baseline. null whenever the environment
// cannot answer, or answers with something that is not a dotted i.
function scanTittle(cs) {
  try {
    const cv = document.createElement('canvas');
    cv.width = SCAN_PX;
    cv.height = SCAN_H;
    const ctx = cv.getContext?.('2d');
    if (!ctx || typeof ctx.fillText !== 'function') return null;
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${SCAN_PX}px ${cs.fontFamily}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff';
    ctx.fillText('i', SCAN_PEN, SCAN_BASE);
    const px = ctx.getImageData(0, 0, SCAN_PX, SCAN_H)?.data;
    if (!px) return null;

    // One pass down the bitmap, keeping each inked row's left and right extreme.
    const rows = [];
    for (let y = 0; y < SCAN_H; y++) {
      let lo = -1;
      let hi = -1;
      for (let x = 0; x < SCAN_PX; x++) {
        if (px[(y * SCAN_PX + x) * 4 + 3] > INK) {
          if (lo < 0) lo = x;
          hi = x;
        }
      }
      rows.push(lo < 0 ? null : [lo, hi]);
    }
    // A dotted "i" is two pieces with clear air between them. A face that draws
    // them joined, or draws nothing, is not one this construction can place, so
    // say so instead of guessing at a tittle that is not there.
    const top = rows.findIndex(Boolean);
    if (top < 0) return null;
    let gap = top;
    while (gap < SCAN_H && rows[gap]) gap++;
    let stem = gap;
    while (stem < SCAN_H && !rows[stem]) stem++;
    if (gap >= SCAN_H || stem >= SCAN_H) return null;

    // Pixel EDGES, not indices: a row spanning columns 3..7 covers x 3 to 8.
    const box = (from, to) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let y = from; y < to; y++) {
        if (!rows[y]) continue;
        lo = Math.min(lo, rows[y][0]);
        hi = Math.max(hi, rows[y][1] + 1);
      }
      return [lo, hi];
    };
    const [tl, tr] = box(top, gap);
    const [sl, sr] = box(stem, SCAN_H);
    const em = (v) => v / SCAN_PX;
    return {
      tx: em((tl + tr) / 2 - SCAN_PEN),
      ty: em(SCAN_BASE - (top + gap) / 2),
      tb: em(SCAN_BASE - gap),
      // The stem's top, which is the other end of the gap the ring is hung in.
      st: em(SCAN_BASE - stem),
      // 1.3x the tittle's larger dimension: a disc that only just spans the ink
      // leaves its antialiased skirt showing round the cover's own edge.
      td: 1.3 * Math.max(em(tr - tl), em(gap - top)),
      sx: em((sl + sr) / 2 - SCAN_PEN),
    };
  } catch {
    return null; // no canvas, or a tainted/blocked one: the fallbacks stand
  }
}

// An empty inline-block's bottom margin edge IS its baseline, so a zero-size one
// dropped into the word reports where the line's baseline actually landed. It
// carries no text, so textContent stays exactly "idlescreen" while it is in
// there, and the finally is what guarantees it leaves again: this construction
// exists to keep the DOM holding the plain word, and a probe stranded inside
// the mark by a throw would be a worse bug than a misplaced dot.
function probeBaseline(el, size) {
  const probe = document.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'display:inline-block;width:0;height:0';
  el.appendChild(probe);
  try {
    return (probe.getBoundingClientRect().bottom - el.getBoundingClientRect().top) / size;
  } finally {
    probe.remove();
  }
}

function placeTittle() {
  const host = document.querySelector('.hero__title');
  const idle = host?.querySelector('.imark--led .imark__idle');
  if (!idle) return;
  const cs = window.getComputedStyle?.(idle);
  const size = parseFloat(cs?.fontSize);
  if (!size) return;
  let base = 0;
  try {
    base = probeBaseline(idle, size);
  } catch {
    return;
  }
  const m = scanTittle(cs);
  if (!m) return;
  // Sanity, not superstition. Every value here is a fraction of an em with a
  // known neighbourhood across every face a browser can hand us; one outside it
  // means the measurement measured something else (no layout, a fallback face
  // that never loaded, a canvas that returned an empty bitmap), and a mark
  // placed off a wrong number is worse than one placed off the sheet's default.
  const ok =
    base > 0.6 && base < 1.4 &&
    m.ty > 0.4 && m.ty < 0.95 &&
    m.tb > 0.35 && m.tb < m.ty &&
    m.st > 0.25 && m.st < m.tb &&
    m.td > 0.02 && m.td < 0.4 &&
    m.tx > -0.1 && m.tx < 0.5 &&
    m.sx > -0.1 && m.sx < 0.5;
  if (!ok) return;
  host.style.setProperty('--im-base', base.toFixed(4));
  host.style.setProperty('--im-tx', m.tx.toFixed(4));
  host.style.setProperty('--im-ty', m.ty.toFixed(4));
  host.style.setProperty('--im-tb', m.tb.toFixed(4));
  host.style.setProperty('--im-st', m.st.toFixed(4));
  host.style.setProperty('--im-td', m.td.toFixed(4));
  host.style.setProperty('--im-sx', m.sx.toFixed(4));
}
// Once now, for the face the first paint uses, and again when the web font
// lands and every one of these numbers changes under it. Nothing is bound to
// resize, because every answer is em-relative and survives the clamp. The one
// exception is harmless and worth naming: --im-base is read off an inline box
// the browser has rounded to whole pixels, so it comes back 0.9688 at 64px and
// 0.9737 at 38px. Carrying one across a resize costs about a fifth of a pixel.
placeTittle();
document.fonts?.ready?.then?.(placeTittle)?.catch?.(() => {});
