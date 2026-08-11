// One record of where the finger went down, and one rule for what it meant.
//
// A board is a wall panel. People lean on it, rest a palm beside the picture
// they are reading, put a second finger down while the first is still moving.
// Telling a tap from a swipe therefore needs more than the last pointerdown: it
// needs the FIRST pointer of a gesture, held until the click that gesture
// produces has been judged against it.
//
// That record was written five times across three modules and the copies
// drifted apart. The full-screen photo viewer, the one surface a passer-by
// actually touches, was the copy with no owning-pointer guard at all: a palm
// landing anywhere on the glass moved the origin out from under the gesture
// already in flight, and the tap you meant became a swipe or nothing.
//
// Two shapes are exported. attachGesture wires a surface that owns its own
// element (the photo viewer, the ambient stage, the expand overlay).
// pressRecord is the bare record, for the document-wide listener in expand.js
// that has to judge a click landing on a node the gesture never touched.

// Pointer-gesture classifier: a horizontal drag navigates, a movement small
// enough to be a press is a tap, and anything in between is ambiguous and gets
// ignored rather than guessed at.
//
// It was written in imageshow.js and every other surface imported it from
// there, which put the board's gesture rule inside the image surface and made
// expand.js reach through the pictures to ask what a tap was. It lives here
// now, and imageshow.js is a plain importer like everyone else.
export function swipeAction(dx, dy) {
  if (Math.abs(dx) >= 60 && Math.abs(dx) >= 2 * Math.abs(dy)) return dx < 0 ? 'next' : 'prev';
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return 'tap';
  return null;
}

// A press only owns the clicks of its own gesture. Real hardware fires
// pointerdown, pointerup and click inside a few hundred ms; past this window we
// assume the record was orphaned (a pointerup lost to an element pulled out
// from under the finger, a gesture that produced no click at all) and let the
// next pointerdown take over. Deliberately generous but tight: expiring means
// the guards below are skipped, which is the pre-existing behaviour for
// synthesised clicks, never a surface that stops answering.
export const PRESS_MS = 1200;

// The record: where a gesture started, whose pointer owns it, and whether that
// pointer has lifted yet. Nothing here touches the DOM, so a caller can wire it
// to an element, to the document, or to nothing at all in a test.
//
// `extra` on down() is whatever the caller needs remembered ABOUT the moment
// the finger landed rather than about the finger itself: expand.js records the
// card under it and whether a full-screen view was up, because those are the
// facts a retargeted click gets wrong.
export function pressRecord({ freshMs = PRESS_MS } = {}) {
  let rec = null;
  const live = () => Boolean(rec) && Date.now() - rec.t < freshMs;
  return {
    // Only the FIRST pointer of a gesture sets the origin: a second finger, or
    // a palm on a wall panel, must not move it under a click already on its
    // way. A gesture whose pointer has already lifted is over, so the next tap
    // always gets its own origin even if it lands inside the window, and a
    // record orphaned mid-gesture ages out instead of wedging the surface.
    down(e, extra = null) {
      if (live() && !rec.done) return null;
      rec = { ...extra, id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now(), done: false };
      return rec;
    },
    // The gesture is over at pointerup, but the record outlives it: the click
    // that matters is dispatched afterwards and still needs the origin on hand.
    // Answers only for the pointer that owns the record, so a stray finger
    // lifting classifies nothing.
    up(e) {
      if (!rec || e.pointerId !== rec.id) return null;
      rec.done = true;
      return rec;
    },
    // The live record, or null once it has aged out. Reading never consumes.
    fresh() {
      return live() ? rec : null;
    },
    // Reads and consumes: one press answers for exactly one click, so a later
    // synthesised click cannot reuse it.
    take() {
      const taken = live() ? rec : null;
      rec = null;
      return taken;
    },
    clear() {
      rec = null;
    },
  };
}

// Wires a surface that owns an element: the record, the owning-pointer guard,
// and the classification, in the one place they belong together.
//
// The split between pointerup and click is not an accident of history. A swipe
// answers at pointerup, because on a touch panel that is the last event a drag
// reliably produces. A tap answers at click, because the click is what the rest
// of the board reacts to and it has to be judged by its own coordinates against
// the origin: a swipe that dragged a long list can then never be mistaken for
// the tap that closes the view.
//
// `onPress` is the "somebody is touching this" hook (the expand overlay resets
// its idle timer on it). It fires for the gesture's own pointer, and for a
// pointerup with no record behind it at all, but never for a stray second
// finger, which owns nothing here.
export function attachGesture(el, { onTap = null, onNext = null, onPrev = null, onPress = null } = {}) {
  const press = pressRecord();
  el.addEventListener('pointerdown', (e) => {
    press.down(e);
    onPress?.(e);
  });
  el.addEventListener('pointerup', (e) => {
    const rec = press.up(e);
    if (!rec && press.fresh()) return; // another finger lifting: not this gesture
    onPress?.(e);
    if (!rec) return; // nothing to classify against
    const action = swipeAction(e.clientX - rec.x, e.clientY - rec.y);
    if (action === 'next') onNext?.(e);
    else if (action === 'prev') onPrev?.(e);
  });
  el.addEventListener('pointercancel', () => press.clear());
  el.addEventListener('click', (e) => {
    const rec = press.take();
    // A click with no gesture behind it keeps its pre-existing behaviour and
    // counts as a tap: RoomOS injects taps, and tests and the settings pane
    // drive surfaces programmatically. Refusing those would leave a board that
    // will not answer at all, which is the worse failure by far.
    if (rec && swipeAction(e.clientX - rec.x, e.clientY - rec.y) !== 'tap') return;
    onTap?.(e);
  });
  return press;
}
