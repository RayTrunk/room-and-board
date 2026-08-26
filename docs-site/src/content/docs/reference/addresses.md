---
title: Addresses
description: Which name serves what, and why every address the board has ever answered to keeps working.
---

**idlescreen.io** is the site. **idlescreen.app** is the app.

Every address a board has ever answered to keeps working. A board pointed at
`unsleep.app`, `app.quadrille.io` or `roomboard.app` needs no attention.

## The map

| Role | Addresses |
| --- | --- |
| The app (the dashboard a board loads) | `idlescreen.app`, `unsleep.app`, `roomboard.app`, `app.quadrille.io` |
| The front door (the public guide) | `idlescreen.io`, `unsleep.io`, `quadrille.io` |
| The API (one Worker) | `api.idlescreen.app`, `api.unsleep.app`, `api.roomboard.app`, `api.quadrille.io` |
| Beta | `beta.idlescreen.*`, `beta.unsleep.*`, and the older pair |

The app names are custom domains on the **same** Cloudflare Pages project, so
the content behind them can never be what differs. What can fail on its own is a
given domain's attachment or its DNS record, which is why the health monitor
probes several of them separately rather than trusting one.

The front door is a **separate** Pages project with its own deploy job.

## Why the old names stay

Boards are configured once and then forgotten, often for years, sometimes by
someone who has since left. Retiring a name would silently blank a screen in
someone's office with no error anyone would see. The cost of keeping a DNS
record is close to zero, so they stay.

## For the macro

Leave `SIGNAGE_URL` on `https://idlescreen.app` for the welcome screen. The
older names work identically if a board already has one.
