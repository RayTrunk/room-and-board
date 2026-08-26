---
title: Point your board at idlescreen
description: The simplest install — set the board's signage address to idlescreen.app. Collaboration Control Hub steps, or the equivalent commands.
---

idlescreen is a web page the board shows when it is idle. Installation
consists of telling the board which address to show; nothing is installed on
the device itself. An [optional macro](/docs/board/the-macro/) adds a few
conveniences.

## In Collaboration Control Hub

1. Sign in at **admin.webex.com**, open **Devices**, and find your board.
2. On the device's **Overview** tab, under **Configurations**, click
   **Digital signage**.
3. Toggle on **Enable Digital Signage** and **Enable Interactivity**, choose
   **URL** as the signage service, paste `https://idlescreen.app`, and click
   **Save**.

That completes the installation — the toggle also enables the web engine and
sets a standby delay. The next time the board goes idle (half-wake, about two
minutes of inactivity by default), the idlescreen welcome screen appears and
[setup](/docs/set-up-your-board/) can begin.

:::tip[Audio]
Signage audio is off by default, and the panel doesn't surface it. If you plan
to use the Live Video widget with sound, set **Standby → Signage → Audio** to
On under **All configurations**.
:::

## Equivalent commands

The same configuration, via the device's local web interface or API:

```
xConfiguration WebEngine Mode: On
xConfiguration Standby Signage Mode: On
xConfiguration Standby Signage InteractiveMode: Interactive
xConfiguration Standby Signage Url: https://idlescreen.app
```

## Which address to use

`https://idlescreen.app` serves the welcome screen and is the correct address
for a new board. A board that has already been set up can instead carry its whole
configuration inside its own address — see
[Back up your board](/docs/codes/back-up-your-board/) for how to get that URL
and why you might want it.

## Recommendations

Pilot on one board before rolling out to several. Cisco also recommends
signage run twelve hours a day or less — the board's **Office Hours** setting
controls that.
