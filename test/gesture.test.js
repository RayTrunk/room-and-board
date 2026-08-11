/**
 * @vitest-environment happy-dom
 *
 * The board's one gesture record. These are the guards a wall panel needs: a
 * palm or a second finger landing mid-gesture must not move where the finger
 * went down, a record orphaned by a pointerup that never arrived must age out
 * rather than wedge the surface, and a swipe must never be read as the tap that
 * closes the view.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { swipeAction, attachGesture, pressRecord, PRESS_MS } from '../site/js/gesture.js';

// PointerEvent is not universally constructible under happy-dom; fall back to a
// MouseEvent carrying a pointerId, which is all the guards read.
function pointer(el, type, x = 0, y = 0, pointerId = 1) {
  const Ctor = globalThis.PointerEvent ?? globalThis.MouseEvent;
  const ev = new Ctor(type, { bubbles: true, clientX: x, clientY: y, pointerId });
  if (ev.pointerId === undefined) Object.defineProperty(ev, 'pointerId', { value: pointerId });
  el.dispatchEvent(ev);
  return ev;
}

// A bare event-shaped object, for driving the record with no DOM at all.
const at = (x, y, id = 1) => ({ clientX: x, clientY: y, pointerId: id });

describe('swipeAction', () => {
  it('classifies swipes, taps and ambiguous drags', () => {
    expect(swipeAction(-80, 10)).toBe('next');
    expect(swipeAction(120, -20)).toBe('prev');
    expect(swipeAction(-59, 0)).toBe(null);   // under distance threshold
    expect(swipeAction(-80, 50)).toBe(null);  // too diagonal (|dx| < 2|dy|)
    expect(swipeAction(4, -6)).toBe('tap');
    expect(swipeAction(30, 4)).toBe(null);    // drag, neither tap nor swipe
  });
});

describe('pressRecord', () => {
  it('remembers where the first pointer went down, and what the caller asked it to', () => {
    const press = pressRecord();
    press.down(at(300, 200), { card: 'the-card', overlay: false });
    const rec = press.fresh();
    expect(rec.x).toBe(300);
    expect(rec.y).toBe(200);
    expect(rec.card).toBe('the-card');
    expect(rec.overlay).toBe(false);
  });

  it('refuses to let a second finger move the origin mid-gesture', () => {
    const press = pressRecord();
    press.down(at(300, 200, 1));
    press.down(at(900, 700, 2)); // a palm lands while the first finger is still down
    expect(press.fresh().x).toBe(300);
    expect(press.fresh().id).toBe(1);
  });

  it('only the owning pointer ends the gesture, and then the next one gets its own origin', () => {
    const press = pressRecord();
    press.down(at(300, 200, 1));
    expect(press.up(at(310, 205, 2))).toBe(null); // the palm lifting answers for nothing
    expect(press.fresh().done).toBe(false);
    expect(press.up(at(310, 205, 1))).not.toBe(null);
    expect(press.fresh().done).toBe(true);
    press.down(at(900, 700, 2)); // the gesture is over, so this one owns the record
    expect(press.fresh().x).toBe(900);
  });

  it('ages an orphaned record out rather than wedging the surface for good', () => {
    vi.useFakeTimers();
    const press = pressRecord();
    press.down(at(300, 200, 1)); // the finger leaves the panel edge: no pointerup ever comes
    vi.advanceTimersByTime(PRESS_MS - 1);
    expect(press.fresh()).not.toBe(null);
    press.down(at(900, 700, 2));
    expect(press.fresh().x).toBe(300); // still inside the window: the guard holds
    vi.advanceTimersByTime(2);
    expect(press.fresh()).toBe(null); // expired
    press.down(at(900, 700, 2));
    expect(press.fresh().x).toBe(900); // and the surface answers again
    vi.useRealTimers();
  });

  it('take() reads once: one press answers for exactly one click', () => {
    const press = pressRecord();
    press.down(at(300, 200));
    expect(press.take().x).toBe(300);
    expect(press.take()).toBe(null);
  });

  it('clear() drops the record outright', () => {
    const press = pressRecord();
    press.down(at(300, 200));
    press.clear();
    expect(press.fresh()).toBe(null);
  });
});

describe('attachGesture', () => {
  let el;
  let calls;

  beforeEach(() => {
    document.body.innerHTML = '<div id="surface"></div>';
    el = document.querySelector('#surface');
    calls = { tap: 0, next: 0, prev: 0, press: 0 };
    attachGesture(el, {
      onTap: () => calls.tap++,
      onNext: () => calls.next++,
      onPrev: () => calls.prev++,
      onPress: () => calls.press++,
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('steps forward and back on a horizontal swipe, at pointerup', () => {
    pointer(el, 'pointerdown', 600, 100);
    pointer(el, 'pointerup', 400, 104);
    expect(calls).toMatchObject({ next: 1, prev: 0, tap: 0 });

    pointer(el, 'pointerdown', 400, 100);
    pointer(el, 'pointerup', 600, 104);
    expect(calls).toMatchObject({ next: 1, prev: 1, tap: 0 });
  });

  it('taps on the click, judged against the origin', () => {
    pointer(el, 'pointerdown', 500, 300);
    pointer(el, 'pointerup', 502, 301);
    pointer(el, 'click', 502, 301);
    expect(calls).toMatchObject({ tap: 1, next: 0, prev: 0 });
  });

  it('never reads a swipe as the tap that closes the view', () => {
    pointer(el, 'pointerdown', 600, 100);
    pointer(el, 'pointerup', 400, 104);
    pointer(el, 'click', 400, 104); // the trailing click a touch swipe may still fire
    expect(calls).toMatchObject({ next: 1, tap: 0 });
  });

  it('lets a palm rest on the glass without stealing the swipe that is under way', () => {
    // The regression this module exists for: the full-screen photo viewer kept
    // a bare pair of coordinates, so the palm's pointerdown became the origin
    // and the real swipe measured 0px.
    pointer(el, 'pointerdown', 600, 100, 1);
    pointer(el, 'pointerdown', 405, 700, 2); // palm, near where the finger will lift
    pointer(el, 'pointerup', 400, 104, 1);
    expect(calls).toMatchObject({ next: 1, prev: 0 });
  });

  it('ignores the palm lifting on its own', () => {
    pointer(el, 'pointerdown', 600, 100, 1);
    pointer(el, 'pointerdown', 900, 700, 2);
    pointer(el, 'pointerup', 300, 700, 2); // 600px of palm travel, not a swipe
    expect(calls).toMatchObject({ next: 0, prev: 0, press: 2 }); // both pointerdowns only
  });

  it('resets on pointercancel, so the scroll that ate the gesture leaves nothing behind', () => {
    pointer(el, 'pointerdown', 600, 100);
    pointer(el, 'pointercancel', 600, 100);
    pointer(el, 'pointerup', 400, 104);
    expect(calls).toMatchObject({ next: 0, tap: 0 });
    pointer(el, 'pointerdown', 500, 300);
    pointer(el, 'click', 502, 301);
    expect(calls.tap).toBe(1); // and the next gesture is clean
  });

  it('treats a click with no gesture behind it as a tap', () => {
    // RoomOS injects taps and tests drive surfaces programmatically; an
    // unattributable click keeps its pre-existing behaviour rather than
    // leaving a surface that will not answer.
    el.click();
    expect(calls.tap).toBe(1);
  });

  it('tells the surface it was touched, but never for a stray finger', () => {
    pointer(el, 'pointerdown', 500, 300, 1);
    expect(calls.press).toBe(1);
    pointer(el, 'pointerup', 502, 301, 1);
    expect(calls.press).toBe(2);
    pointer(el, 'pointerdown', 900, 900, 2);
    expect(calls.press).toBe(3); // the previous gesture ended, so this one is real
    pointer(el, 'pointerup', 100, 100, 9); // a pointer this surface never saw go down
    expect(calls.press).toBe(3);
  });
});
