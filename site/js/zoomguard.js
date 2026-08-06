// The dashboard is not zoomable, and this is the half of that CSS cannot reach.
//
// Someone at a Board Pro pinch-zoomed the dashboard by accident. Browser zoom
// is ENGINE state rather than page state, so it outlived the reload that Save
// does after a layout edit: the board came back still at roughly 200% and
// stayed unusable until a person zoomed it back out by hand. RoomOS has no
// device-side switch for the gesture, and a page cannot reset an already
// applied zoom from script, so the only real fix is to leave no way in.
//
// The touch gesture itself is refused in the stylesheet (`touch-action:
// pan-x pan-y` on the root, see the html/body rule in main.css). The viewport
// meta is deliberately NOT used for any of this; index.html carries the reason
// above its meta tag. What is left are the POINTER paths, which touch-action
// says nothing about, and they are this file's whole job.
//
// Called once at boot from main.js. No teardown: it is page-lifetime setup on
// a board that only ever stops by reloading.
export function blockZoomGestures(target = globalThis) {
  if (typeof target?.addEventListener !== 'function') return;

  // Trackpad pinch and ctrl+wheel. Both reach the page as a `wheel` event with
  // ctrlKey set (a trackpad pinch synthesises the modifier), and this is a live
  // path rather than a theoretical one: a Desk or a Room Navigator can have a
  // mouse or a trackpad paired to it, and a desktop preview always does.
  // `passive: false` is not optional. A wheel listener on window defaults to
  // passive, and a passive listener's preventDefault() is ignored, so without
  // it this whole function would be a no-op that looked like it worked.
  // A wheel WITHOUT ctrlKey is left entirely alone, so ordinary scrolling in
  // the settings rail and the reading views is untouched.
  target.addEventListener('wheel', (e) => {
    if (e.ctrlKey) e.preventDefault();
  }, { passive: false });

  // WebKit's non-standard pinch events, the same gesture arriving under a
  // different name. Chromium never fires these, so on a board this is most
  // likely three listeners that cost nothing and do nothing. It stays because
  // we do not actually know which engine every RoomOS build ships, and three
  // dead listeners are a lot cheaper than another board stuck at 200%.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    target.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }
}
