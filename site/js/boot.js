// Boot-time config selection: the URL fragment and localStorage both carry a
// timestamped config; the newest one wins.

import { pickNewest } from './config.js';

// The encoded config a signage URL carries in its `#cfg=` fragment, or null.
// This is the board's recovery path, not a convenience: web storage can be
// wiped (a browser reset, a RoomOS reimage, a Clear web storage tap) and the
// URL the device is pinned to still holds a complete config, so the next
// reload puts the board back exactly as it was.
//
// `cfg` is the only key read. Early macro builds also rode a rotating device
// account's credentials in an `auth` key, for a page↔device WebSocket
// back-channel; the macro went standalone and the client half was removed on
// 2026-08-21, so an old URL still carrying `auth` is now ignored the same way
// any unknown fragment key is.
export function fragmentConfig(hash) {
  if (!hash) return null;
  return new URLSearchParams(hash.replace(/^#/, '')).get('cfg');
}

export function chooseBootConfig(fragmentCfg, storedCfg) {
  const cfg = pickNewest(fragmentCfg, storedCfg);
  if (!cfg) return { cfg: null, source: 'none' };
  return { cfg, source: cfg === fragmentCfg ? 'fragment' : 'local' };
}
