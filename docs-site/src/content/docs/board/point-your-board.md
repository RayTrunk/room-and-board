---
title: Point your board at idlescreen
description: The simplest install — set the board's signage address to idlescreen.app. Collaboration Control Hub steps, or the equivalent commands.
---

idlescreen is a web page the board shows when it is idle. Installing it is
nothing more than telling the board which address to show. No app, no macro,
nothing downloaded onto the device — though there is an
[optional macro](/docs/board/the-macro/) that smooths a few edges.

## In Collaboration Control Hub

1. Sign in at **admin.webex.com** and open **Devices**.
2. Select the board, then open **Configurations** → **All configurations**.
3. Search for and set:

| Configuration | Value |
| --- | --- |
| WebEngine → Mode | **On** |
| Standby → Signage → Mode | **On** |
| Standby → Signage → InteractiveMode | **Interactive** |
| Standby → Signage → Url | `https://idlescreen.app` |

That's the whole install. The next time the board goes idle (half-wake, about
two minutes of inactivity by default), the idlescreen welcome screen appears
and [setup](/docs/get-started/set-up-your-board/) takes it from there.

:::tip[Audio]
**Standby → Signage → Audio** is off by default. Leave it off unless you plan
to use the Live Video widget with sound.
:::

## The same thing as commands

If you prefer the device's local web interface or the terminal, these four
lines are the equivalent:

```
xConfiguration WebEngine Mode: On
xConfiguration Standby Signage Mode: On
xConfiguration Standby Signage InteractiveMode: Interactive
xConfiguration Standby Signage Url: https://idlescreen.app
```

## Which address to use

`https://idlescreen.app` serves the welcome screen and is right for a new
board. A board that has already been set up can instead carry its whole
configuration inside its own address — see
[Back up your board](/docs/codes/back-up-your-board/) for how to get that URL
and why you might want it.

## Good practice

Pilot on one board before rolling out to several. Cisco also recommends
signage run twelve hours a day or less — the board's **Office Hours** setting
controls that.
