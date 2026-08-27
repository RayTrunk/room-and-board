# Bug: RoomOS signage webview renders at page scale 2 after in-place reload

**Status:** shipped to `dev` and verified on both devices over CDP, 2026-08-27.
One open question: the scale-2 state no longer reproduces on demand (see below).
**Fix location:** the served viewport `<meta>` tag, plus two functions in `site/js/util.js`.

---

## Environment

- Cisco Desk Pro G2, RoomOS `ce26.9.0.49` (Webex Beta upgrade channel)
- Chromium `134.0.6998.208` / Qt `6.10.3`, QtWebEngine
- Panel is 3840x2160; compositor runs 1920x1080 logical at fractional scale 2.0
- Signage webview widget: **1920x1040 CSS px** (a 40px `SignageFooter` sits below it)
- App under test: `https://beta.idlescreen.app/`, loaded via `xConfiguration Standby Signage Url`
- `xConfiguration Standby Signage InteractionMode: Interactive`
- `xConfiguration Standby Signage RefreshInterval: 0` (so reloads are page-initiated, not RoomOS-initiated)

## Symptom

Signage starts and renders correctly. After the page reloads in place — e.g. following
activation-code submission — content renders magnified, with only about a quarter of the
content area visible.

Exiting signage (wake the device) and re-entering half-wake renders correctly again.

The distinguishing variable is whether the `QQuickWebEngineView` is **destroyed and recreated**
(exit/re-enter signage) versus **navigated in place** (reload).

## Measurements

Taken over CDP with `WebEngine RemoteDebugging: On` (port 9222), while the page was in the
broken state:

| Property | Value | Assessment |
|---|---|---|
| `devicePixelRatio` | `2` | correct |
| `visualViewport.scale` | `2` | **root symptom** |
| `visualViewport.zoom` | `1` | browser zoom NOT involved |
| `cssLayoutViewport` | `1920x1040` | correct |
| `cssVisualViewport` | `960x520` | quarter of the area |
| `cssContentSize` | `1920x1080` | correct |

Layout is correct and the page does not reflow. This is purely a page scale factor problem —
a post-render transform that scales the compositor surface and clips the visual viewport.

## Ruled out

**Compositor / Qt.** The RoomOS GUI state dump captured *while broken* shows correct widget
geometry throughout: `CompositorScreen` 1920x1080 logical at `effectiveScale: 2`,
`SignageWebView` 1920x1080, `WebViewProper` 1920x1040, `RenderWidgetHostViewQtDelegateItem`
1920x1040. All compositor surfaces are 1:1 (source region == destination region). `weston`
logged no scale or resize event anywhere near the reload — the last
`c4wo_suggest_surface_scale` is a stable 2.0 well beforehand. RoomOS is handing Chromium a
correctly sized, correctly scaled widget.

**Browser zoom / HostZoomMap.** `Page.getLayoutMetrics` reports `zoom: 1` exactly. Chromium
multiplies DPR by zoom factor, so a 2x browser zoom would have surfaced as
`devicePixelRatio: 4`. It didn't.

**Layout viewport.** Correct at 1920x1040 CSS px. Not a `width=device-width` or
deviceScaleFactor problem.

**Leftover pinch / double-tap gesture.** This was the initial hypothesis and it is wrong.
Two reasons: `touch-action` is already `pan-x pan-y` on both `html` and `body`, which blocks
pinch zoom; and a programmatic `Page.reload` issued over CDP with zero touch input reproduced
it exactly — `scale: 2` before, `scale: 2` after. The scale is recomputed deterministically on
every in-place reload, not carried over from a gesture.

## Root cause

The app serves:

```html
<meta name="viewport" content="width=1920">
```

A fixed width with **no `initial-scale`** and **no scale constraints**. That leaves Blink free
to select its own initial page scale. On the in-place reload path it selects exactly 2 —
equal to `devicePixelRatio`. On a freshly created `WebEngineView` it selects 1, which is why
the exit/re-enter cycle looks fine.

**Not proven:** whether the underlying miscalculation is Cisco handing Blink a widget size in
physical pixels instead of DIPs, or a Blink quirk in initial-scale selection. An attempt to
discriminate by mutating the meta to `width=3840` mid-session was inconclusive — mutating the
viewport meta after first layout recomputes min/max constraints but does not re-run
initial-scale selection. The distinction does not affect the fix, which works by removing
Blink's discretion entirely.

## Fix

```html
<meta name="viewport" content="width=1920, initial-scale=1, maximum-scale=1, user-scalable=no">
```

Verified live: applying this to the DOM over CDP immediately snapped `visualViewport.scale` to
`1` and restored `cssVisualViewport` to the full 1920x1040.

`initial-scale=1` is the part that fixes it. `maximum-scale=1, user-scalable=no` is defensive
and appropriate for a kiosk surface running `InteractionMode: Interactive`.

## Task for this session

Find where the viewport meta is emitted — static `index.html`, or the framework's document
head component — and apply the change there.

**The verified fix above was a runtime DOM mutation and does not persist across reload.** It
must be shipped in the served markup.

## Optional hardening

- Replace `location.reload()` in the activation flow with a client-side view swap. This avoids
  the failure mode entirely rather than mitigating it, and removes roughly 1.4s of blank screen
  observed in the device logs between load start and load complete.
- Keep input `font-size` at 16px or above.
- Turn `xConfiguration WebEngine RemoteDebugging` back to `Off` when debugging is finished —
  it is an unauthenticated CDP endpoint exposed on the LAN.

## Reference: reproducing the measurement

With `WebEngine RemoteDebugging: On`, list targets at `http://<device-ip>:9222/json/list`, then
open a WebSocket to the returned `webSocketDebuggerUrl` and issue `Page.getLayoutMetrics`.
Note that a browser page opened from the same origin (`http://<device-ip>:9222`) can hold that
WebSocket without tripping Chromium's DevTools origin check.

The three-value discriminator, evaluated in the page:

```js
[devicePixelRatio, visualViewport.scale, document.documentElement.clientWidth]
```

- `[2, ~2-4, 1920]` — page scale zoom (this bug)
- `[8, 1, 480]` — browser zoom factor
- `[2, 1, 480]` — layout viewport genuinely shrank

---

## Resolution (2026-08-26, on `dev`)

The fix above is right about the cause and could not be applied as written. Two
things it did not have in view:

### 1. `initial-scale=1` was removed on purpose, and removing it is what caused this

Commit `c638a42` (2026-07-25) dropped `initial-scale=1` from that exact meta tag
to fix a P1: a Room Navigator, whose glass is 1280 wide, rendered only the
top-left ~1280px of the 1920 page and needed a pinch to read. Dropping the pin
let the engine shrink-to-fit the page, which was a no-op on a Board Pro.

So this bug was introduced by that fix, and `test/viewport.test.js` carried a
regression test that failed the moment `initial-scale` went back in. Putting the
pin back therefore has to come with a replacement for the fit it removes.

### 2. `position: fixed` sizes to the LAYOUT viewport, so the pin alone breaks every full-bleed overlay on a Navigator

The ambient screensaver, the image and story viewers, the settings overlay and
an expanded card are all sized by being `position: fixed`, and a fixed element
sizes to the layout viewport. Measured in Chrome 2026-08-26: under a `zoom` of
0.891 on `<html>`, `position:fixed; inset:0` still renders at the full
1710x866 layout viewport. A CSS zoom that fits the dashboard does not shrink the
overlays with it.

With `width=1920, initial-scale=1` a Navigator gets a 1920 layout viewport behind
1280 of glass, so the dashboard would look perfectly fitted while every overlay
hung 640px off the right-hand side. **The invariant is that the layout viewport
must equal the glass**, and today's broken board violates it too: layout 1920 at
scale 2 is 960 of visible glass, which is the other half of why the reloaded
board looks like it does.

### What shipped

`site/index.html`

```html
<meta name="viewport" content="width=1920, initial-scale=1, maximum-scale=1">
```

`width=1920` stays a constant on purpose: `device-width` would hand the engine
back the very quantity it is suspected of computing in physical pixels on the
reload path, which would put the board in a corner of a 3840 layout viewport
instead. `maximum-scale=1` is a second lock, since the initial scale is clamped
to it. `user-scalable=no` was left out as redundant: the pinch is already refused
in `main.css` (`touch-action: pan-x pan-y`) and `js/zoomguard.js`.

`site/js/util.js`, both called at boot and on both resize events from `main.js`:

- **`narrowViewportToGlass()`** (new). If the visual viewport is narrower than
  the layout viewport, rewrite the meta's `width` to the measured glass, once.
  Restores the layout-viewport == glass invariant, which is what keeps the
  overlays correct. No-op on a Board Pro by construction (1920 == 1920).
- **`fitViewport()`** (existing, now measures `min(layout, visual)`). It used to
  read the layout viewport only, which reads 1920 on any engine that honors the
  tag, so it no-opped on exactly the device it exists for. It now does the fit
  the engine used to do for free. Its floor moved from 0.25 to 0.15 so a phone
  opening the board URL still fits.
- **The page centring**, which had never once fired on the device it was written
  for. `body { top: max(0px, calc((100dvh - 1080px) / 2)) }` compared two rulers:
  `100dvh` is raw viewport px, while the 1080px it is measured against is page
  px, and `zoom` is exactly what makes those disagree. On a Navigator that read
  800 against 1080 and clamped to 0. `fitViewport()` now publishes `--fit-zoom`
  and the sum divides by it. The old note claiming a Navigator viewport of 1200
  was reading `screen.height`; 1200 is right, but as PAGE px (1200 x 0.667 = the
  800 of glass).

Together these hold `layout viewport == glass == fitted page` on a Board Pro, a
Room Navigator, a desktop preview, and a phone, with no engine discretion left in
the loop. As a side effect the pair is self-correcting: if a page scale ever
appears anyway, the glass reading follows it and the page is compensated rather
than quartered.

Tests: `test/viewport.test.js` (the meta contract, now pinned from both
directions with both regressions written out) and `test/misc-widgets.test.js`
(11 cases across the two functions). 1605 site + 308 worker green.

### On-device verification (2026-08-27, beta at `2c64a62a456c`)

Measured over CDP after an in-place reload on each device. Every number is where
the design says it should be.

**Desk Pro G2** (glass 1920x1040, DPR 2)

| | value |
|---|---|
| meta as served | `width=1920, initial-scale=1, maximum-scale=1` (never rewritten: glass == layout) |
| `[dpr, scale, clientWidth]` | `[2, 1, 1920]`, the doc's own "correct" signature |
| layout / glass | 1920x1040 / 1920x1040 |
| CSS zoom, `--fit-zoom` | none, unset |
| `body { top }` | `0px` |
| fixed overlay | 1920x1040, exactly the glass |

Untouched to the pixel, and stable across four consecutive programmatic reloads.

**Room Navigator** (glass 1280x800, DPR 1.5)

| | value |
|---|---|
| meta after boot | `width=1280, …` — `narrowViewportToGlass()` fired, as designed |
| layout / glass | 1280x800 / 1280x800, in agreement |
| CSS zoom, `--fit-zoom` | 0.667 / 0.667 |
| `body { top }` | `59.7px` of page px = 40px on the glass |
| fixed overlay | 1281x801, exactly the glass |
| black above / below the grid | 118 / 96 px (was 78 / 136) |

The 80px of letterbox now splits 40/40 instead of pooling at the bottom. The
remaining asymmetry is `--safe-bottom`, which is a Board Pro clearance the
Navigator does not need; Sean's call, deliberately left alone.

### The repro is gone, and the original evidence does not support "the reload causes it"

Four consecutive programmatic reloads on the Desk Pro, on the OLD build,
measured `scale: 1` every time. The device had been through a full sleep in
between, which recreates the WebEngineView.

Re-reading the evidence above: the CDP reload test recorded `scale: 2` **before**
and after. That shows the scale is STICKY across an in-place reload, not that a
reload creates it. What puts the view into scale 2 in the first place is still
unknown, and nothing here has reproduced it since.

This does not change the fix, and if anything sharpens what each part is doing:
`initial-scale=1` should stop the state being entered, and `maximum-scale=1`
clamps the initial scale if something tries. But it does mean the fix has not
been proven against a live failure, only against the geometry it produces.

### Not done

The optional hardening (replacing `location.reload()` in the activation flow with
a client-side view swap) was left alone. It is a real improvement, worth doing on
its own terms for the ~1.4s of blank screen, but it would only cover one of the
reload paths. The others (the hourly version poll after a deploy, the 4 AM
refresh, the 15-minute watchdog, the boot-crash retry, every settings save) all
reload in place too and are all fixed by the above.
