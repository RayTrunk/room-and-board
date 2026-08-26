---
title: Deployment
description: The static site on Cloudflare Pages, the Worker and its secrets, and the two values a fork must change.
---

Two deploy targets: a static site on Pages, and one Worker.

## 1. Static site on Cloudflare Pages

Point a Pages project at the repo:

| Setting | Value |
| --- | --- |
| Build command | `node tools/stamp-version.js` |
| Build output directory | `site` |
| Custom domain | your subdomain, added under the project's Custom domains |

The build command stamps `version.json` with the commit SHA. Boards poll it
hourly and self-reload after each deploy.

DNS and TLS are automatic when the zone is in the same Cloudflare account.

:::danger[Two values a fork must change]
Change both of these before your first deploy.

**`site/js/env.js` (`WORKER_URL`)** must point at *your* Worker:

```js
export const WORKER_URL = 'https://signage-api.yourdomain.com';
```

The shipped file routes to this project's own `api.roomboard.app` and
`api.quadrille.io`. A fork that keeps it would send every board's requests, and
the anonymous usage pings, to the original operator's Worker.

**`package.json` `deploy:site`** hardcodes `--project-name signage`. Replace it
with your Pages project's name.
:::

## 2. The Worker

```bash
cd worker
npx wrangler kv namespace create CODES     # put the id into wrangler.toml
npx wrangler secret put NJT_USER           # from developer.njtransit.com
npx wrangler secret put NJT_PASS
npx wrangler deploy
```

### Optional secrets

Every one of these is optional. The affected widget reports itself unconfigured
rather than breaking the board.

| Secret | Enables |
| --- | --- |
| `MTA_BUS_KEY` | Express Bus arrivals |
| `GDRIVE_KEY` | Google Drive photos, plus the curated Landscapes folder |
| `NASA_KEY` | NASA Daily Photo (falls back to `DEMO_KEY` when unset) |
| `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | Your own tenant's Microsoft 365 health via Graph. All three or none |
| `ALERT_WEBHOOK` | Health alerts to Slack or ntfy.sh |
| `HEARTBEAT_URL` | The dead-man check for the health cron |

:::note[The monitor cannot watch itself]
`HEARTBEAT_URL` points at a healthchecks.io-style check on roughly a twenty
minute period. The cron pings it after each **completed** run, so a cron that
stops firing goes silent and the external check pages. Without it, a dead cron
looks exactly like a healthy system.
:::

## Deploy commands

```bash
npm run deploy:site       # stamps version, deploys site/ to Pages
npm run deploy:worker     # wrangler deploy --config worker/wrangler.toml
```

:::caution[Always name the API worker explicitly]
A bare `wrangler` command resolves to the committed root `wrangler.jsonc`, which
belongs to the beta Pages worker. Always pass `--name signage-api` when you mean
the API worker.
:::

## Branches

Work happens on `dev`, not `main`. The beta host tracks `dev`; `main` is what
boards in the field are running.

:::danger[Do not delete the beta plumbing]
Beta is served by the Workers-Builds worker `room-and-board-beta` plus the
committed root `wrangler.jsonc`. Neither is dead weight, and deleting either
takes beta down.
:::
