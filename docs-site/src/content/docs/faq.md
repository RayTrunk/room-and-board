---
title: FAQ & Troubleshooting
description: "The questions that actually come up, each with the fix."
---

## The dashboard is suddenly zoomed way in

A known Cisco quirk: sometime after a setup code loads a configuration, the
board may zoom the page to 200%. The fix is to exit signage and let it
relaunch:

1. **Exit signage:** tap the bar at the very bottom of the screen (the strip
   the board itself owns, where "Tap here to start" appears).
2. **Relaunch it:**
   - With [the macro](/docs/board/the-macro/): swipe open the Control Panel
     and tap **Dashboard**.
   - Without the macro: just walk away — the board drops back into signage on
     its own after a couple of minutes of inactivity.

The dashboard comes back at the correct size.

## The dashboard disappears on its own during the day

The board is waking itself for meetings. A device setting called **wake at
meeting start** brings up Cisco's join prompt shortly before anything on the
room calendar, and the dashboard steps aside for a stretch of every booking.

[The macro](/docs/board/the-macro/) turns that setting off, which is the
usual fix. If you want the join prompt back, the setting is at the top of the
macro file. On boards without the macro, whoever administers the board can
change **Standby → WakeupAtMeetingStart** in Collaboration Control Hub.

## I moved the board and the clock is wrong

The dashboard reads the board's time zone when it starts, so a board that
changes zones keeps drawing the old clock until the page restarts.
[The macro](/docs/board/the-macro/) notices the change and fixes it
automatically. Without it, power-cycle the board — or wait for the overnight
refresh, which picks up the new zone too.

## I reset or wiped my board — how do I get my dashboard back?

If you took [the backup](/docs/codes/back-up-your-board/), open your saved
page, get a fresh setup code, and type it in — two minutes, everything back.

If the board's signage address carries the configuration (the **Get signage
URL** option, and all [non-touch devices](/docs/board/non-touch-devices/)),
there's nothing to do at all — the board rebuilds itself.

If neither: the dashboard needs to be
[set up again](/docs/get-started/set-up-your-board/). Take the backup this
time — it's two minutes.

## A card is dimmed and says "as of …"

The card's data source didn't answer just now, so the card is showing you the
last good data it has, honestly stamped with its age, instead of going blank.
Nothing to do — it recovers on its own when the source does.

## Do I need an account?

No. There are no accounts anywhere in idlescreen. Your dashboard lives on the
board itself, and a [setup code](/docs/codes/setup-codes/) moves
configuration on and off it. The flip side of no accounts: nothing is stored
for you anywhere else, which is why
[the backup](/docs/codes/back-up-your-board/) is worth two minutes.
