---
title: Quick start
description: Get idlescreen onto a Cisco Board Pro in about five minutes, using a setup code from your phone.
sidebar:
  order: 2
---

Five minutes, two devices: the board and your phone. No account to create.

## 1. Put the macro on the board

On the board, or in Control Hub's Macro Editor, open **Settings → Macros**.
Create a macro, paste in `macro/Dashboard.js`, save it, and enable it.

On load the macro configures the device for you (WebEngine, interactive
signage, macro autostart, standby delay and audio, meeting-start wakeup) and
adds a **Dashboard** button to the Control Panel.

Leave the signage URL on `https://idlescreen.app` for now. That serves the
welcome screen, which is what you want for a board that has no configuration
yet.

## 2. Build a configuration on your phone

Visit `idlescreen.app/setup` on your phone. Pick the widgets you want, set your
weather location, and choose your stations. Tap **Get my setup code**.

You get six characters. The code lives for one hour and works once.

## 3. Type the code into the board

On the board, tap the gear, choose **Setup code**, type the six characters, and
save. The dashboard replaces the welcome screen.

## 4. Adjust from there

Everything is editable on the glass after this point. Tap the pencil to
rearrange, tap the gear for per-widget settings. To pull the current
configuration back to your phone later, use gear → **Setup code** → **Show QR**.

## If the board has no touchscreen

A Room series device driving a TV cannot type a setup code, so the
configuration rides in the signage URL instead. Build a config at `/setup`, tap
**Get signage URL (non-touch boards)**, then set this in the device's web
interface:

```
xConfiguration WebEngine Mode: On
xConfiguration Standby Signage Mode: On
xConfiguration Standby Signage InteractionMode: NonInteractive
xConfiguration Standby Signage Url: <the generated URL>
```

:::caution[Do not install the macro on non-touch devices]
The macro's startup sets `Standby Signage Url` to its own configured value,
which would overwrite the URL you just pasted.
:::

## Next

- [Get it on a board](/guides/get-it-on-a-board/) covers the macro settings in full.
- [Make it yours](/guides/make-it-yours/) covers the editor and settings.
- [Gestures and touch](/reference/gestures/) is the whole interaction model.
