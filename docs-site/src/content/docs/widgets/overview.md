---
title: Widget overview
description: Thirty five cards across eight groups, all opt-in, each with a minimum size and a full-screen view.
---

Everything is opt-in. Tap the ✎ pencil to add, remove, resize and arrange
widgets on the 12×8 grid. The add tray groups them into the eight categories
below, the same labels the on-board tray, the Settings nav and the phone
`/setup` page all use, so a card sits in the same place wherever you meet it.

The clock and greeting across the top is always on.

## The eight groups

| Group | Cards | What it answers |
| --- | --- | --- |
| [Commute](/widgets/commute/) | 10 | When is my train, and is the line running |
| [Weather & Air](/widgets/weather-and-air/) | 3 | Do I need a coat |
| Markets | 2 | Where are the indices, and what is the finance news |
| Sports | 5 | How did my teams do |
| News & Social | 4 | What happened |
| Images | 5 | Something worth looking at |
| Daily | 4 | One new thing each morning |
| Reference | 2 | What time is it there, and are our tools up |

## How sizing works

Each widget has a minimum size and shows more content as its card grows. The
edit screen tells you how many rows fit.

Two related ideas keep the numbers honest:

- **Capacity** is the estimated number of rows a card can show at a given size,
  from a pixel-calibrated table.
- **Fit** is the measured correction: render, measure, then shed or grow until
  the content actually fits. The shed count is what feeds the **+N** badge.

The estimate deliberately over-promises, and fit corrects it.

## Tap to expand

Almost every card opens full screen on a tap. The exceptions are shorter to list
than the rule:

- **24 of 35** widgets register an expand view.
- **PATH, Air & Sky, Quote of the Day, Word of the Day and Live Video** have
  nothing behind the tap.
- The **six image cards** open the image viewer instead.

By family:

- **List cards** (Markets, Subway, Cloud Services, TfL Status, Citi Bike,
  Express Bus, World Clock, the rail boards) show everything they fetched rather
  than only what fit.
- **Weather**, **Surf** and **Formula 1** open a fuller reading of the same
  data: the wider forecast, the 48 hour marine picture, the whole season.
- The **news family** opens a reading list, whose rows tap through again to the
  story itself.
- **My Teams**, **Golf** and **Tennis** open their boards. **This Day in
  History** opens the whole day.

Every expand view is built from the render the card is already holding, so it
costs no extra request.

## Degradation

Every widget degrades gracefully. A dead feed dims the card and stamps "as of …"
rather than going blank. Long text taps to full screen.
