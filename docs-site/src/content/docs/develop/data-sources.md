---
title: Data sources
description: Where every feed comes from, which need a key, and which are fetched straight from the browser.
---

Two paths. Feeds that are CORS-open and keyless are fetched **straight from the
browser**. Everything else rides the Worker's Cache API layer, which also means
one upstream request is shared across every board rather than repeated per
device.

## Fetched directly by the browser

| Source | Powers | Notes |
| --- | --- | --- |
| Open-Meteo | Weather, Air & Sky | Free tier is non-commercial. Roughly 288 weighted calls a day per board against a 10,000 ceiling |
| Open-Meteo Marine | Surf | Same free tier |
| api.weather.gov | US alert banners | Enhancement only, skipped outside US bounding boxes so a non-US board does not 400 every refresh |
| MTA LIRR + MNR GTFS-RT | Rail boards | GET only, HEAD returns 403. 60 s jittered polling |
| Met, Art Institute of Chicago, Cleveland | Art | CC0 works, via a build-time manifest |
| Bluesky public AppView | Bluesky posts | Also validates handles when adding accounts |
| Wikimedia | This Day in History | |

## Proxied by the Worker

| Source | Key needed | Notes |
| --- | --- | --- |
| MTA alert feeds | none | An ~800 KB raw subway feed reduced to a ~2 KB digest shared fleet-wide |
| MTA BusTime SIRI | `MTA_BUS_KEY` | Free key. Widget reports unconfigured until set |
| NJ Transit RailData | `NJT_USER` / `NJT_PASS` | Their terms **require** serving from a non-NJT server |
| Amtraker | none | Unofficial community API; there is no official public Amtrak feed |
| Yahoo Finance | none | Unofficial. Browser UA, five minute cache, widget hides if it breaks |
| ESPN site API | none | Live scores are joined to the league scoreboard Worker-side, because the team feed nulls them mid-game |
| Jolpica-F1 | none | Four endpoints merged into one digest |
| Public status pages | none | Statuspage instances plus Slack, Microsoft, Google, Webex and AWS public JSON |
| Google Drive API | `GDRIVE_KEY` | Free Cloud project with the Drive API enabled |
| NASA APOD | `NASA_KEY` | Falls back to `DEMO_KEY` when unset |
| Statista | none | No feed exists; the Worker scrapes the listing page |

## Two rules that are easy to get wrong

:::danger[ESPN needs a `curl/` User-Agent]
ESPN returns 403 unless the User-Agent **starts with** `curl/`. This is the
exact opposite of the Yahoo Finance rule, which needs a browser UA. Never unify
them. Doing so took My Teams, Golf and Tennis down for a day in August 2026.
:::

:::caution[Jolpica calls must be sequential]
Jolpica's unauthenticated burst limit sits around four requests a second. Four
parallel fetches land exactly on it, and one to three draw a 429 depending on
timing. The Worker issues them **strictly sequentially, 250 ms apart**. A board
once spent a night showing a drivers-only card while every endpoint was
answering 200 to a polite client.
:::

## Caching

The Worker caches in the **Cache API**, never in KV.

KV is a durable store here, for setup codes and the NJT day timetable, and it
carries a 1,000 write per day cap on the free plan. Using it as a cache would
exhaust that cap and break setup codes, which is the one thing on the board that
cannot degrade gracefully.

## Artwork that is deliberately hotlinked

F1 circuit diagrams, driver flags and team logos load straight from their
owners' CDNs rather than being mirrored into the repo, because the artwork is
not ours. This is fragile by construction: if F1 reshuffles its URLs, every
diagram 404s at once, which is exactly why bundled circuit outlines exist as the
tier below.
