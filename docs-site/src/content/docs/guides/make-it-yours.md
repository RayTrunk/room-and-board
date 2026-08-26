---
title: Make it yours
description: The editor, the settings surfaces, tap views and display modes.
---

Everything is opt-in. A fresh board shows the clock and greeting across the top,
which is always on, and nothing else until you add it.

## The editor

Tap the ✎ pencil. See [the editor gestures](/reference/gestures/#the-layout-editor)
for the full list.

Each widget has a minimum size and shows more content as its card grows. The
edit screen tells you how many rows fit.

A few widgets have **two** legal minimums rather than one. World Clock is
canonically 2×3 (five cities) but 3×2 is equally legal and fits three. Word of
the Day works the same way. Neither fits a 2×2 square, but both fit either
rectangle. The edit tile names whichever minimum the card is actually in, so a
perfectly legal 3×2 never reads "3×2 · min 2×3" and contradicts itself.

Layouts live in config v3. Older v1 and v2 configs migrate automatically on
first load.

## Settings

On the board by touch, or from your phone at `/setup`. Each widget has its own
section.

Configurable list widgets (markets, sports, world clock, headlines, Substack,
Bluesky) ship with sensible starter entries that you can remove like any other.

**Settings → Widgets** is a signpost to the editor rather than a second place to
toggle cards. It carried its own toggle list until August 2026, which was a
worse editor: minimum size only, and no way to say what actually fits.

## Display modes

**Settings → Display** decides what is on screen and when.

| Mode | Behaviour |
| --- | --- |
| Always dashboard | The dashboard, all the time |
| Always screensaver | The screensaver, all the time |
| Scheduled | The dashboard during your daily time windows, the screensaver the rest of the time |

Scheduled mode takes up to four windows a day, in fifteen minute steps.

## Some widget defaults worth knowing

| Widget | Default or requirement |
| --- | --- |
| Weather | ZIP 10001, changeable to any city worldwide |
| World Clock | Up to 10 cities. Defaults: New York, San Francisco, London, Hyderabad, Hong Kong |
| LIRR | Penn Station, Grand Central, or both. A stops-at station is **required** |
| Metro-North | Grand Central. A stops-at station is **required** |
| NJ Transit, Amtrak | Fixed to New York Penn |
| Amtrak | A destination is **required**; the card prompts until one is chosen |
| PATH, NYC Ferry | One chosen station or landing, named in the card corner |

Where a card requires a choice, it prompts until you make one rather than
guessing.

## When something breaks

Every widget degrades visibly. A dead feed dims the card and stamps "as of …"
rather than going blank. Long text taps through to full screen.
