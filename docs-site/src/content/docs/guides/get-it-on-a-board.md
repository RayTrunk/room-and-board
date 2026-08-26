---
title: Get it on a board
description: Installing the signage macro, the five settings that matter, and what to do for non-touch Room series devices.
---

There are three ways a board ends up running idlescreen, and which one you want
depends on whether the device has a touchscreen.

## Touch boards: the macro

Board Pro and Desk Pro take the signage macro.

1. On the board, or in Control Hub → Macro Editor, open **Settings → Macros**.
2. Create a macro, paste in `macro/Dashboard.js`, save, enable.
3. The macro self-configures the device and adds a **Dashboard** button to the
   Control Panel that drops the board into the signage view.

It then watches the device's time zone and restarts the web engine when it
changes.

### The five settings

They sit at the top of the macro file: the signage URL plus four options.

| Setting | Default | What it does |
| --- | --- | --- |
| `SIGNAGE_URL` | `https://idlescreen.app` | The page the board loads. Replace it with a board-specific URL from `/setup` to carry configuration in the URL. |
| `STANDBY_DELAY_MINUTES` | `480` | Minutes of inactivity before full standby. 480 (eight hours) is the most RoomOS allows. |
| `SIGNAGE_AUDIO` | `'Off'` | Whether signage content may play sound, for example the Live Video widget opened full screen. |
| `WAKE_AT_MEETING_START` | `'Off'` | See below. The value space is `'Auto'` / `'Off'`, not `'On'` / `'Off'`. |
| `RESTART_WEBENGINE_ON_TIMEZONE_CHANGE` | `true` | Cycles the web engine when the OS time zone changes. |

### Why the dashboard "goes away on its own"

`WAKE_AT_MEETING_START` defaults to `'Off'`, which is a deliberate departure
from RoomOS's own default of `'Auto'`.

Left on `'Auto'`, the board wakes itself just before a booking starts to show
the join prompt, and stays awake until a few minutes past the start time. The
dashboard disappears for a stretch of every meeting on the room's calendar.
That is what people are describing when they report the dashboard vanishing
during the day.

Set it back to `'Auto'` if you want Cisco's join prompt and can live without the
dashboard for those minutes.

### Time zone restarts

The browser engine reads the OS time zone once, at start. Moving a board to a
new zone leaves the dashboard drawing the old one until something restarts the
engine. With `RESTART_WEBENGINE_ON_TIMEZONE_CHANGE` on, the macro watches
`xConfiguration Time Zone` and cycles `WebEngine Mode` off and on when it
changes. It skips the restart during a call and puts signage back afterwards if
that is where the board was.

:::note[Unconfirmed on hardware]
This behaviour has not yet been verified on a physical device. A page reload
alone may turn out to be enough. If you are testing on a board, try re-setting
the signage URL first and simplify the macro if that works.
:::

## Non-touch Room series driving a TV

These devices cannot enter setup codes, so the configuration travels in the
signage URL itself.

Get a URL from a working config: on a template board, gear → **Setup code** →
**Show QR of current config**, open it on your phone, then tap **Get signage
URL (non-touch boards)**. Or build a config on `/setup` from scratch and tap the
same button.

Then set, in the device's web interface or Control Hub:

```
xConfiguration WebEngine Mode: On
xConfiguration Standby Signage Mode: On
xConfiguration Standby Signage InteractionMode: NonInteractive
xConfiguration Standby Signage Url: <the generated URL>
```

:::danger[No macro here]
Do not install the signage macro on these devices. Its startup sets
`Standby Signage Url` to its own configured URL and would overwrite what you
pasted.
:::

On these devices the URL **is** the persistence. It survives reboots, upgrades
and web storage wipes by definition. To change the config later, regenerate the
URL (it carries a fresh timestamp, so it always beats the device's cached copy)
and paste it again. The board picks it up at its next reload: the hourly version
check, the nightly 4 AM reload, or a power cycle.

## Recommended

Pilot on one board first. Per Cisco's guidance, configure `Time OfficeHours` so
signage runs twelve hours a day or less.
