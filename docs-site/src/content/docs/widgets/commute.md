---
title: Commute
description: "Ten transit cards, NYC-area except TfL: subway status, three commuter rail boards, PATH, ferry, bus, Citi Bike and London."
---

Ten cards, NYC-area except TfL.

The three commuter rail boards (LIRR, Metro-North, NJ Transit) print each row's
line name as a filled chip in the agency's own official colour rather than as
one more line of dim text, so the line reads at a glance instead of looking like
a repeat of the destination above it. Every colour pair is gated at the 4.5:1 AA
contrast floor by the test suite.

## Subway Status

Good Service or the current alert for each line you pick. Alerting lines float
above the quiet ones, and the card taps into the full status board.

**Configure:** Settings → Subway. Tap line bullets. The shuttle "S" and express
variants are matched automatically.

## LIRR and Metro-North

Departure boards with live minutes, track, and service alerts.

LIRR picks its terminal: Penn Station (default), Grand Central, or both, with
each row tagged by terminal when both are on. Metro-North is Grand Central.

**Configure:** their Settings sections. Pick the station your trains must stop
at, which is required and named in the card corner. The card prompts until one
is chosen. Toggle the alert banner.

## NJ Transit

Scheduled departures from New York Penn: time, destination, and line.

RailData's schedule feed carries no live track or per-train status, so live
delays and disruptions arrive as a service-alert banner instead. Amtrak trains
sharing the station are filtered out, since they have their own card.

**Configure:** Settings → NJ Transit. Filter to the lines you ride, where none
selected means all of them. Toggle alerts.

## Amtrak

Departures from Moynihan Train Hall / New York Penn, with route, train number,
status, and platform when assigned. Shows trains stopping at your destination
with the arrival time there.

**Configure:** Settings → Amtrak. A destination is required and the card prompts
until one is chosen.

## PATH

Next trains at one station as coloured line dots plus minutes. Choose one
direction or both.

**Configure:** Settings → PATH.

## NYC Ferry

Next departures from one landing, with route name and colour.

**Configure:** Settings → NYC Ferry.

## Express Bus

Arrivals for up to two route and stop picks. Choose an express route (QM, BM,
SIM, X), then direction, then stop, shown in minutes or distance.

**Configure:** Settings → Express Bus. Needs a free BusTime key on the Worker,
though the picker works without it.

## Citi Bike

Live bikes (e-bikes called out) and open docks at up to six stations. Keyless.

**Configure:** Settings → Citi Bike. Search a station by its cross-streets.

## TfL Status

London line status across Tube, Elizabeth line, DLR and Overground: a coloured
dot, the name, and either "Good Service" or the current disruption, per line you
pick. Tap a disrupted line for the full reason. Keyless.

**Configure:** Settings → TfL Status. Toggle lines by mode.

## Rail board layout

The rail boards size themselves to their list: one grand centered column up to
six departures, two balanced columns beyond that.

A service-alert banner on a rail card is its own tap target and opens that
alert's full text, including details the two-line banner clamps away.
