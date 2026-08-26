---
title: Local development
description: Running the dashboard and the Worker locally, the demo mode, and the three audit harnesses.
---

```bash
npm install
npm test                # site suite (happy-dom), then worker suite (workerd)
npx http-server site -c-1 -p 8087
npx wrangler dev --config worker/wrangler.toml   # worker on :8787
```

:::caution[`-c-1` matters]
Without it, Chrome heuristic-caches ES modules and you will spend an afternoon
debugging a file you already fixed.
:::

Then:

```bash
open 'http://localhost:8087/?demo=1'
open 'http://localhost:8087/?demo=1&mode=ambient'
```

`?demo=1` renders every widget from fixtures with **zero network**.

## Tests

`npm run test:site` and `npm run test:worker` run the halves on their own. Both
are offline unit and integration suites, so a green `npm test` is the gate for
every change.

## The audit harnesses

Three pages under `site/` render real components at real board geometry, so
overflow can be **measured** instead of eyeballed.

| Harness | Renders |
| --- | --- |
| `site/_audit.html` | Dashboard cards on the grid |
| `site/_settings-audit.html` | One Settings section at a time |
| `site/_overlay-audit.html` | The full-screen expand and reader overlays |

Useful parameters on `_audit.html`: `ids` (comma-separated widget ids), `mode`
(`min` or `rep`), `w` and `h` size overrides, `sizes` (an explicit `id:w:h`
list, repeats allowed, paged across as many 12×8 grids as it takes), `full=1`
(top every list to the pickers' maximum, so an over-promising capacity entry
cannot hide behind thin data), `board=<encoded cfg>` (render one real board's
layout at its own coordinates), plus `page`, `freeze`, `vh` and `meta=0`.

Each harness publishes its measurements as JSON on `window.__audit`, so a
headless run can assert on them.

### The `vh` parameter

`vh` draws the device's real bottom edge across the page and measures every card
against it.

| Value | Device |
| --- | --- |
| `1040` (default) | Board Pro or Desk Pro |
| `1200` | Room Navigator |
| `1080` | Desktop preview |

:::note[Why the harnesses are tracked in git]
They used to be local-only, and they hard-coded the board's screen as
1920×1080, which is where this repo's long-held belief in a 1080px-tall board
came from. An untracked harness is one that arrives back wrong on the next
clone.
:::

## The fixed canvas

`site/css/main.css` pins `html, body` to exactly **1920×1080 CSS px** on every
device. That is deliberate: the grid, the editor and the settings overlay then
have identical geometry everywhere.

The real screens differ from it, and this is the part that is easy to get wrong:

| Device | Viewport handed to the page | Bottom bar |
| --- | --- | --- |
| Board Pro / Desk Pro | **1920×1040** | RoomOS draws its bar in the 40 physical px **below** the viewport |
| Room Navigator (PWA) | **1920×1200** | none |
| Desktop preview | whatever the window is | none |

The bar does **not** overlay page content. What happens instead is that the last
40px of the fixed 1080px page fall off the bottom of a board's glass, which
crops anything parked there exactly as an overlay would have. That is why the
overlay theory survived as long as it did.

The `--safe-bottom: 84px` reserve keeps the page's own content clear of that
edge. Do not spend it without re-measuring on a device.
