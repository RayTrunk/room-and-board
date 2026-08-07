// Deployment endpoints. The Worker URL is the only environment-specific
// value in the shipped site; update it when deploying under your own domain.
// New-name aware: a page served from any quadrille.io host talks to the
// worker's quadrille alias, so the new-name stack is self-contained end to
// end; every other origin (roomboard.app and friends) keeps the original
// worker domain. (The rvc.tech fallback pair was retired 2026-08-07.)
export const WORKER_URL =
  typeof location !== 'undefined' && location.hostname.endsWith('quadrille.io')
    ? 'https://api.quadrille.io'
    : 'https://api.roomboard.app';
