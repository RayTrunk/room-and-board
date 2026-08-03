// Deployment endpoints. The Worker URL is the only environment-specific
// value in the shipped site; update it when deploying under your own domain.
// Backup-domain aware: a page served from the rvc.tech fallback talks to the
// worker's rvc.tech alias, so a network that blocks roomboard.app (e.g. a
// corporate newly-registered-domain filter) can't take out both halves.
// Self-hosted / Docker: any host outside the known production domains routes
// through the nginx reverse proxy at /api (no CORS, no Cloudflare needed).
const _h = typeof location !== 'undefined' ? location.hostname : '';
export const WORKER_URL =
  _h.endsWith('.rvc.tech') ? 'https://signage-api.rvc.tech'
  : (_h === 'roomboard.app' || _h === 'www.roomboard.app') ? 'https://api.roomboard.app'
  : '/api';
