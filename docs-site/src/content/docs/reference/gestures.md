---
title: Gestures and touch
description: "Every touch gesture in idlescreen, grouped by where you use it: the dashboard, tap views, the editor, and ambient mode."
---

idlescreen has no keyboard. Everything below is done with a finger on the glass,
from about a foot away for reading views and arm's length for the settings
surfaces.

The whole model rests on one rule, learned once and true everywhere.

:::tip[The one-tap rule]
A tap on a card opens exactly one destination. One card, one tap, one place you
land. No card advertises this with its own chrome, because it is a board-wide
rule rather than a per-card feature.
:::

## Dashboard

| Gesture | Where | What happens |
| --- | --- | --- |
| <kbd>Tap</kbd> | Any card | Opens that card's full-screen view |
| <kbd>Tap</kbd> | A rail card's alert banner | Opens that alert's full text, including what the two-line banner clamps away |
| <kbd>Tap</kbd> | ✎ pencil | Enters the layout editor |
| <kbd>Tap</kbd> | ⚙ gear | Opens Settings |

Twenty four of the thirty five widgets register an expand view. PATH, Air & Sky,
Quote of the Day, Word of the Day and Live Video have nothing behind the tap.
The six image cards (Art, Landscapes, both Photos widgets, NASA Daily Photo,
Chart of the Day) open the image viewer instead.

Every expand view is built from the render the card is already holding, so
opening one costs **no extra network request** and shows exactly what the card
had at the moment you touched it.

## Tap views

| Gesture | What happens |
| --- | --- |
| <kbd>Tap</kbd> | Closes the view, or follows a row deeper (a story, an alert, an incident) |
| <kbd>Swipe ←</kbd> | Next item |
| <kbd>Swipe →</kbd> | Previous item |

### How a gesture is classified

The numbers are exact, and live in `site/js/gesture.js`.

| Classified as | Condition |
| --- | --- |
| `tap` | Horizontal travel under 10 px **and** vertical travel under 10 px |
| `next` | Leftward travel of 60 px or more, and at least twice the vertical travel |
| `prev` | Rightward travel of 60 px or more, and at least twice the vertical travel |
| nothing | Everything else, including a drifting finger |

One press record per surface: where the finger went down, which pointer owns the
gesture, and whether the record is still fresh. A second finger or a resting
palm never moves the origin.

## Idle dismissal

Not one blanket timeout. Each surface decides for itself.

| Surface | Closes after | Why |
| --- | --- | --- |
| Expand overlay | 60 seconds untouched | A board someone walked away from returns to its resting state |
| Text and story reader | 20 seconds untouched | Shorter, because it is usually a quick read |
| Image viewer | **Never** | A picture filling the glass is the one thing here that is fine to leave up |

The image viewer's behaviour is a deliberate decision, not an oversight.

## The layout editor

Enter with the ✎ pencil. The 12×8 grid appears.

| Gesture | What happens |
| --- | --- |
| <kbd>Drag</kbd> a card | Moves it. Colliding cards are pushed aside live |
| <kbd>Drag</kbd> the corner handle | Resizes, snapping to cells and respecting the widget's minimum |
| <kbd>Tap</kbd> ✕ | Removes the card |
| <kbd>Tap</kbd> a tray chip | Re-adds a removed card |
| <kbd>Tap</kbd> Done | Saves to `localStorage` |
| <kbd>Tap</kbd> Cancel | Discards every change |

An invalid drop flashes red and snaps back.

The bottom tray flows most groups inline and folds the big ones into
collapsible drawers, by a rule rather than a judgement call: **a group collapses
if and only if it offers four or more cards**. Drawers render largest first,
ties broken alphabetically. Today that means Commute (10), Images (5), Sports
(5) and Daily (4) fold; Weather & Air, News & Social, Markets and Reference flow
inline, because below four a drawer costs a tap to save one or two chips.

## Ambient mode

| Gesture | What happens |
| --- | --- |
| <kbd>Tap</kbd> anywhere | Leaves ambient, returns to the dashboard |
| <kbd>Tap</kbd> anywhere in a Preview | Exits the preview |

## Corner counts

The **+N** badge in a card's corner is a count of what the card is not showing.
It is pure information. It is never a glyph, and it is never the affordance for
opening the card, because the one-tap rule already covers that.
