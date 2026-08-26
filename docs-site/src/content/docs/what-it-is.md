---
title: What idlescreen is
description: A personal signage dashboard for touch-enabled Cisco RoomOS endpoints, personalized per device without authentication.
sidebar:
  order: 1
---

idlescreen is a lightweight signage dashboard for touch-enabled Cisco RoomOS
endpoints such as the Board Pro and Desk Pro. It fills the hours those devices
spend idle with something worth glancing at: worldwide weather and surf, NYC
area transit boards, market tickers, sports scores, headlines, cloud service
status, public domain art, and small daily delights.

It is hosted entirely on the public internet, personalized per device
**without authentication**, with preferences that survive reboots and RoomOS
upgrades.

## Who it is for

Someone with a Cisco Board Pro in a private office. The device idles most of the
day. They glance at it from their desk, three to six feet away, dozens of times:
before leaving for a train, while getting coffee, during a pause. They configure
it once from their phone or by touch, then mostly never think about it again.

Success is a user answering "when is my train?" or "do I need a coat?" from
their chair in under two seconds, and the display feeling like theirs rather
than the company's.

## What it is not

- Not a corporate BI dashboard. No KPI tiles, no enterprise chrome.
- Not a consumer smart display. No bubbly cards, no mascots.
- Not a digital menu board. Nothing rotates, slides or demands attention.

## Design principles

1. **Two second reads.** Every widget's primary fact (minutes, degrees, track)
   is legible and findable at six feet without searching.
2. **The data is the decoration.** Subway bullet colors, market sparklines and
   artwork carry the visual interest. The chrome stays neutral.
3. **Calm motion only.** Slow crossfades and values updating in place.
4. **Degrade visibly, never blankly.** Stale data dims and gets a timestamp. A
   dead feed never becomes an empty screen.
5. **Personal, not corporate.** Your greeting, your stations, your art.

## How the pieces fit

Three parts, and only the middle one is a server.

| Part | What it is | Where it runs |
| --- | --- | --- |
| The dashboard | A static page: widgets, ambient art, touch settings | Cloudflare Pages |
| The API | One Worker proxying the feeds that need a proxy | Cloudflare Workers |
| The board | A paste-and-go macro plus `localStorage` | The device itself |

Most feeds are fetched **straight from the browser**, because they are CORS-open
and keyless: weather and air quality, National Weather Service alerts, LIRR and
Metro-North realtime, art from the Met and the Art Institute of Chicago and
Cleveland, Bluesky, and Wikimedia history. Everything else rides the Worker's
cache layer.

Your configuration is deflate plus base64url JSON, roughly 200 characters.
`localStorage` is the primary store, and the same string can ride the signage
URL as a `#cfg=` fragment so a wiped board re-seeds itself. See
[the configuration string](/docs/reference/configuration/).
