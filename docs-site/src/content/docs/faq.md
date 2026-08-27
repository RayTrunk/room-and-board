---
title: FAQ & Troubleshooting
description: Common questions and known issues, each with the fix.
---

## The dashboard disappears on its own during the day

The board is waking itself for meetings. A device setting called **wake at
meeting start** brings up Cisco's join prompt shortly before anything on the
room calendar, and the dashboard is replaced for a stretch of every booking.

[The macro](/docs/board/the-macro/) turns that setting off, which is the
usual fix. To keep the join prompt instead, the setting is at the top of the
macro file. On boards without the macro, whoever administers the board can
change **Standby → WakeupAtMeetingStart** in Collaboration Control Hub.

## I moved the board and the clock is wrong

The dashboard reads the board's time zone when it starts, so a board that
changes zones keeps the old clock until the page restarts.
[The macro](/docs/board/the-macro/) detects the change and handles this
automatically. Without it, power-cycle the board, or wait for the overnight
refresh, which picks up the new zone as well.

## I reset or wiped my board — how do I get my dashboard back?

If a [backup](/docs/codes/back-up-your-board/) was taken: open the saved
page, get a fresh setup code, and enter it. The dashboard is restored in
full.

If the board's signage address carries the configuration (the **Get signage
URL** option, and all [non-touch devices](/docs/board/non-touch-devices/)):
no action is needed — the board rebuilds itself.

If neither: the dashboard needs to be
[set up again](/docs/set-up-your-board/). Taking a backup afterwards avoids
this next time.

## A card is dimmed and says "as of …"

The card's data source didn't answer on the last refresh, so the card shows
its most recent good data, stamped with its age, instead of going blank. No
action is needed; it recovers when the source does.

## Do I need an account?

No. There are no accounts anywhere in idlescreen. The configuration lives on
the board itself, and a [setup code](/docs/codes/setup-codes/) moves it on
and off. Because nothing is stored elsewhere, the
[backup](/docs/codes/back-up-your-board/) is the only other copy of your
configuration.
