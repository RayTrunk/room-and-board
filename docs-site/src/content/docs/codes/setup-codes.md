---
title: Setup codes explained
description: The six-character codes that move a configuration from your phone or desktop onto the board.
---

A setup code moves a configuration built on your phone or desktop onto the
board: six characters, entered once. Because the board has no login, a code is
the only mechanism for moving configuration onto it.

## The rules

- A code is valid for **one hour** and can be used **once**.
- If a code expires, generate a new one — the configuration you built is
  retained.
- Entering a code changes **only what the code carries** (see below).

## Where codes come from

| Page | What its code carries |
| --- | --- |
| **idlescreen.app/setup** | The whole dashboard — widgets, layout, locations, everything |
| **idlescreen.app/photo-setup** | Only the photo slideshows — [iCloud](/docs/widgets/images/icloud-photos/), [Google Drive](/docs/widgets/images/gdrive-photos/), or both |
| **idlescreen.app/video-setup** | Only the [Live Video](/docs/widgets/images/live-video/) stream |

Entering a photo or video code changes only that part of the configuration
and leaves the rest of the dashboard unchanged.

## Where codes go in

- On a fresh board: the welcome screen's **I have a setup code** button.
- On a configured board:
  <span class="glyph glyph--gear" aria-hidden="true"></span> gear →
  **Setup code**.

## Retrieving a configuration

The same Setup code section can also hand the board's current configuration
back to a phone — see [Back up your board](/docs/codes/back-up-your-board/).
