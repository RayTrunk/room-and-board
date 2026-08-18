# Domain glossary

The ubiquitous language of unsleep. Use these words in code, comments, tests,
and commit messages; if a concept needs a different word, add it here first.
PRODUCT.md holds the product framing, DESIGN.md the visual system. This file
holds the nouns.

## The board

- **Board**: the 1920x1080 dashboard page a Cisco Board Pro idles on. One user,
  one room, no accounts.
- **Card**: the framed surface a widget renders into: title, body, freshness
  stamp, corner count, note line. A card's size signals are its data-w/data-h
  attributes plus the tier classes (t-s/t-m/t-l by height, t-narrow at four
  columns or fewer); CSS branches on the tiers, JS reads the attributes.
  Owned by site/js/card.js.
- **Widget**: a module with meta {id, title, refreshMs}, a render(el, vm, cfg)
  entry, and a view model fetched from the worker. Widgets live in
  site/js/widgets/.
- **Catalogue**: the roster of widgets, in site/js/catalog.js: one entry per id
  carrying its label and its picker group, and nothing else. Pure data, so both
  settings surfaces can read it without importing widget code. Identity and
  display only; the geometry and capacity tables stay with the modules that
  measured them, bound back to the catalogue by test/catalog.test.js.
- **Label / title**: three registers, deliberately distinct. The catalogue's
  `label` is the settings-facing name ("This Day in History"); a widget's
  `meta.title` is what the card wears on the wall; edit.js TITLES is the short
  form that fits a grid tile ("History").
- **Grid**: the 12x8 layout the cards sit on. A rect is {x, y, w, h} in grid
  cells.
- **Capacity**: the estimated number of list rows a card can show at a given
  size (the pixel-calibrated table in capacity.js).
- **Fit**: the measured correction to capacity: render, measure, shed or grow
  until the content actually fits the card. The shed count feeds the corner
  count.
- **Trim**: the rows a widget habitually sheds below its capacity estimate
  (tall content, notes, banners). Stated per widget, read by layout and the
  optimizer; the estimate deliberately over-promises and trim corrects it.
- **Corner count**: the "+N" text badge in a card's corner: pure information,
  never a glyph, never per-card chrome (decision 2026-08-02, final).

## Tap views

- **Expand view / tap view**: the full-screen reading of a card, opened by a
  tap anywhere on the card (the one-tap rule: one card, one tap, one
  destination). Views are read from about a foot away.
- **One-tap rule**: a tap on a card opens exactly one destination; live rows a
  card excepts from that rule are declared, not improvised.
- **Surface**: anything that takes over the screen: expand view, text viewer,
  art viewer, ambient, slideshow preview, iptv full screen, display test. Each
  signs the register in site/js/surfaces.js from its own module, and that
  register is what the tap guards read.
- **Gesture**: one press record per surface: where the finger went down, which
  pointer owns the gesture, and whether the record is still fresh. Classified
  as tap, next, prev, or nothing (site/js/gesture.js); a second finger or a
  resting palm never moves the origin.
- **Canvas**: the fixed pixel budget a full-screen view lays out into
  (the overlay body height below the title). How a view splits that canvas into
  columns, and which custom property carries the answer to CSS, is one shared
  deal in site/js/columns.js; what a row of that view COSTS stays with the view.

## Ambient

- **Ambient mode**: the screensaver state: backdrop or slideshow or clock face
  plus the info strip. The ambient engine owns entering, leaving, stepping,
  and the midnight rollover of the daily pick; it lives in
  site/js/screensaver.js and publishes the mode through isAmbient(). Which
  mode APPLIES is main.js's decision (modes.js policy), not the engine's.
- **Backdrop**: the full-bleed daily artwork behind ambient.
- **Ambient strip**: the compact digest (temperature, next departures) shown in
  ambient mode (site/js/ambient.js).

## The worker

- **Worker**: the Cloudflare Worker API proxy (signage-api) every board polls.
- **Feed**: one upstream data source proxied by a worker route (weather, ESPN,
  NJT, markets, ...). Feeds cache through cached(), the one caching seam:
  Cache API only, never KV; KV is a durable store (setup codes, the NJT day
  timetable), not a cache.
- **Digest envelope**: the contract every feed response carries: updatedAt
  (epoch seconds), stale, and optionally partial/mended. Consumed by cached(),
  the health monitor, and the board's freshness chrome.
- **Service day**: the New York transit day a timetable is valid for; it rolls
  over at midnight local, not UTC.

## Setup and fleet

- **Setup code**: the 6-character, hour-lived code minted from a config payload
  and redeemed into a scoped patch (full board, photos, video). The exchange
  (mint, redeem, failure wording) is one module; the keypads are presentations
  of it.
- **Settings surface**: the on-board settings panel (settings.js) and the phone
  setup flow (setup.js): two presentations of the same widget preferences.
- **Fleet beacon**: the anonymous hourly stats ping (boot time, widget health,
  viewport) feeding the stats dashboard on the NAS.
