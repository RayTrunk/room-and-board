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

## What is real and what is not

- **Real:** every page's content is drawn from `README.md`, `CONTEXT.md`,
  `PRODUCT.md` and `site/info.html`. The gesture numbers come from
  `site/js/gesture.js`.
- **Real:** the brand tokens in `src/styles/idlescreen.css` are mapped from
  `site/css/main.css` (`--accent: #64b4fa`, `--bg: #000`, `--bg-card: #121212`).
- **Not real:** the sidebar covers a representative slice, not the whole
  product. Markets, Sports, News & Social, Images, Daily and Reference have no
  widget pages yet.
- **Not real:** `site: 'https://docs.idlescreen.app'` in `astro.config.mjs` is a
  placeholder. No such host exists.
- **Not decided:** the wordmark font. The board uses RB Centred, which is not
  cleared for web redistribution here, so this falls back to a system stack.

## If this graduates

Delete this README, move the directory to whatever the real name should be, and
decide the three open questions in the branch's commit message.
