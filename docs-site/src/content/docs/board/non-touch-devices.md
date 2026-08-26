---
title: Non-touch devices
description: Room series devices driving a TV can run idlescreen too — the configuration travels inside the signage address.
---

A Room series device driving a TV has no touchscreen, so it can't type a setup
code. It can still run idlescreen: the whole configuration travels **inside
the signage address itself**.

## The one limitation

Without touch there is no tapping, so **widgets can't expand** — no card opens
full screen. The dashboard is a pure glanceable display. Everything else
works: live data, the screensaver, all of it.

## Getting the address

You need a configured dashboard to copy. Either:

- On a board that's already set up the way you want: <span class="glyph glyph--gear" aria-hidden="true"></span> gear → **Setup code**
  → **Show QR of current config**, scan it with your phone, then tap
  **Get signage URL (non-touch boards)** — or
- Build a fresh configuration at **idlescreen.app/setup** and tap the same
  button.

Either way your phone or browser now holds a long address with the whole
configuration inside it.

## Applying it

In Collaboration Control Hub: find the device under **Devices**, open
**Digital signage** on its Overview tab, toggle on **Enable Digital Signage**
— leaving **Enable Interactivity** off, since there's nothing to touch —
choose **URL**, paste the generated address, and **Save**.

Or via commands:

```
xConfiguration WebEngine Mode: On
xConfiguration Standby Signage Mode: On
xConfiguration Standby Signage InteractionMode: NonInteractive
xConfiguration Standby Signage Url: <the address you generated>
```

:::caution[No macro on these devices]
The [macro](/docs/board/the-macro/) sets the signage address to its own value
on startup, which would overwrite the address you just pasted. Leave it off.
:::

## Changing the configuration later

The address **is** the configuration, so changing the dashboard means
generating a fresh address (same steps as above) and pasting it in again. The
device picks it up at its next page reload — boards check hourly and reload
overnight, and a power cycle forces it.

The upside of this arrangement: the configuration survives absolutely
anything, including a full device wipe, because it lives in the device's
settings rather than on the device's screen.
