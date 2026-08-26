---
title: "The macro (optional)"
description: "What the Dashboard macro actually does, why you might want it, and how to install it. Not required."
---

The macro is **optional** — everything idlescreen does works with
[the plain address setup](/docs/board/point-your-board/). It does two things:
it sets a handful of board settings to signage-friendly values in one step,
and it adds a **Dashboard** button to the board's Control Panel so the
dashboard can be opened on demand rather than waiting for the board to go
idle.

## What it actually does

On load, the macro:

- turns on the web engine and interactive signage, and points the signage
  address at idlescreen — the same settings the
  [manual setup](/docs/board/point-your-board/) walks through;
- stretches the board's standby delay to the maximum (eight hours), so the
  dashboard stays up through the workday;
- turns **off** wake-at-meeting-start, so the dashboard is not replaced by
  the join prompt ahead of every meeting on the room calendar (this can be
  turned back on at the top of the macro file);
- adds the **Dashboard** button to the Control Panel;
- watches the board's time zone and refreshes the page if it changes, keeping
  the clock correct.

It reads no data and communicates only with the board itself.

## Installing it

1. Get `macro/Dashboard.js` from the
   [GitHub repository](https://github.com/scotty83/idlescreen).
2. On the board, or in Collaboration Control Hub's **Macro Editor**, open
   **Settings → Macros**.
3. Create a new macro, paste the file in, **Save**, and enable it.

The settings it applies are listed at the top of the file and can be adjusted
there before saving.

:::caution[Non-touch devices]
Do not install the macro on a
[non-touch device](/docs/board/non-touch-devices/) — those carry their
configuration in the signage address itself, and the macro would overwrite it.
:::
