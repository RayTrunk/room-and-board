# PROTOTYPE — Starlight docs site

**Throwaway.** This directory exists to answer one question: *what would
idlescreen's documentation look like on Astro Starlight, compared to
nodeterm.dev?*

It lives on the branch `proto/starlight-docs` and is **not** wired into any
deploy. Nothing in `site/`, `worker/` or the test suites is touched by it.

## Run it

From the repo root:

```bash
npm run docs:dev       # http://localhost:4321
npm run docs:build     # static output into docs-site/dist
```

## State (2026-08-26, after the IA grilling session)

The IA was settled with Sean in a grilling session and the site fully rebuilt
to it: 47 pages, end-user audience only, non-technical register. Decisions of
record: no splash (the intro page IS /docs/); install docs lead with the
no-macro path (Collaboration Control Hub terminology per Cisco's rebrand) and
frame the macro as optional; per-widget pages nested under the app's own eight
group labels, with exactly two shared pages (LIRR + Metro-North, Quote + Word
of the Day); Codes & backup is its own group; FAQ carries the Cisco 200%-zoom
bug (trigger: after a setup code loads; fix: tap the bottom bar to exit
signage, Dashboard button or ~2-min half-wake to relaunch); no self-hosting
content (GitHub carries that audience); no old-domain mentions anywhere.

Still open before graduation:

- The wordmark font (RB Centred not assumed cleared for web; system stack).
- Sean's visual vet, and his go to wire `docs:stage` into `deploy:frontdoor`.

## If this graduates

Delete this README, move the directory to whatever the real name should be, and
decide the three open questions in the branch's commit message.
