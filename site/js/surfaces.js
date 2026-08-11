// The register of what is FULL SCREEN. A surface is anything that takes over
// the glass (CONTEXT.md): the expand view, the text viewer, the art viewer,
// ambient, the screensaver preview, iptv full screen, the display test. Each
// one signs this register in its own module, and the guards ask here instead
// of holding a list of their own.
//
// It replaces a three-id allow-list that lived in util.js and was true the day
// it was written. Four surfaces arrived after it and none of them joined; the
// most consequential, iptv full screen, sits at z-index 47, ABOVE every overlay
// the list knew about, so the one question the guards ask ("is anything full
// screen right now?") was answered "no" while live TV covered the board. A list
// nobody is obliged to join goes stale in silence. A register a surface signs
// on its way in cannot.
//
// Signing happens at module load, which is honest here rather than fragile:
// every surface's element is either created by the module that registers it
// (the three overlays, the preview, the display test) or is inert until that
// module wakes it (#ambient ships hidden in index.html, .iptv--full is a class
// the widget adds). A module that was never loaded therefore has no surface on
// screen to miss.
//
// This file imports nothing on purpose. Every surface can depend on it, which
// is only safe while it depends on none of them.

// Two ways a surface is up, and between them they cover all seven.
//
// The three shared overlays are built once, kept in the DOM for the life of the
// page and toggled with `hidden`, so being on the page proves nothing. So does
// #ambient, which index.html ships hidden.
export const whileShown = (el) => !el.hidden;
// Everything else is built when it is wanted and thrown away when it is not
// (the preview, the display test), or is a class the surface wears and takes
// off (.iptv--full, whose element is a card's own video wrapper and stays put).
// For those, matching the selector at all IS being up.
const whileMatched = () => true;

// name -> { selector, up }. A Map, so the register is enumerable: a test can
// read the whole inventory back out and pin it, which is most of the point of
// having one place to read it from.
const surfaces = new Map();

// A surface signs the register. `up` decides whether an element that MATCHES
// the selector is currently taking the screen; the default is that matching is
// enough. Signing twice under one name is a rewrite, not a duplicate, so a
// module pulled in by two test files is harmless.
export function registerSurface(name, selector, up = whileMatched) {
  surfaces.set(name, { selector, up });
}

// The whole inventory, for the test that pins it. Sorted by name, so the order
// is the register's own and not the import graph's.
export function registeredSurfaces() {
  return [...surfaces.entries()]
    .map(([name, { selector }]) => ({ name, selector }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Is anything full screen right now?
//
// The invariant is the one it has always served, from back when it was three
// ids in util.js: a tap that CLOSES a surface must never open another. What
// changed is that it can now see all seven, so the tap that dismisses live TV
// no longer falls through onto whatever card was underneath it.
export function isOverlayOpen(doc = document) {
  for (const { selector, up } of surfaces.values()) {
    for (const el of doc.querySelectorAll(selector)) if (up(el)) return true;
  }
  return false;
}
