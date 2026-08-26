---
title: Weather and air
description: Weather, Air & Sky and Surf. One location drives all three cards.
---

Three cards, and one location drives all of them.

## Weather

Current conditions, an hourly temperature trend line, and a multi-day forecast
strip, worldwide, from Open-Meteo. US locations also get a National Weather
Service alert banner when one is active.

Tap for the fuller picture. A single upstream call serves both the card and the
overlay.

**Configure:** Settings → Weather. Search any city worldwide or a five digit US
ZIP. Picking a location defaults the unit by region (US to °F, elsewhere to
°C), and the °F/°C toggle overrides that.

## Air & Sky

Labeled AQI and UV index dials, colour-coded by band, plus sunrise, sunset and
the moon phase.

**Configure:** nothing. It uses your weather location.

This is one of the five cards with nothing behind a tap.

## Surf

Wave height and period, the swell bearing, water temperature, and whether the
wind is onshore, offshore or cross-shore, over an hourly build chart.

Tap for the 48 hour picture: the groundswell split out from the local wind chop,
the week's peaks, and the water paired with the air.

**Configure:** nothing. It uses your weather location.

:::note[Modeled, not observed]
Surf data is modeled (Open-Meteo Marine) rather than buoy-observed, and the card
says how far offshore the model cell sits. Every marine field is independently
nullable upstream, so a spot can legitimately report a wave height and no
period.
:::

### Why Surf is not always offered

The card is only offered where a probe confirms open water nearby.

The same pin-to-cell vector that finds the water gives the card its shore-facing
normal for free: a marine model only has cells over water, so the direction it
had to move the pin to find one **is** the direction of the sea. That normal
against the wind bearing is what makes "onshore / offshore / cross-shore"
possible with no coastline dataset at all.
