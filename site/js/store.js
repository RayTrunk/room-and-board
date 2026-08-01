// localStorage persistence. The signage web-engine profile keeps this data
// across standby, reboots and RoomOS upgrades (per Cisco's WebEngine guide);
// the macro vault is the recovery layer if it is ever wiped.

import { encodeConfig, decodeConfig } from './config.js';

const CFG_KEY = 'sgn.cfg';
const CACHE_PREFIX = 'sgn.cache.';

// Resolve through window: Node >=22 defines a stub `localStorage` global that
// is undefined without a flag and would shadow the DOM one under test.
const storage = () => window.localStorage;

export async function loadConfig() {
  // getItem inside the try: a storage-unavailable throw here would otherwise
  // kill boot before the watchdog exists.
  try {
    const raw = storage().getItem(CFG_KEY);
    if (!raw) return null;
    return await decodeConfig(raw);
  } catch {
    return null;
  }
}

export async function saveConfig(cfg) {
  const encoded = await encodeConfig(cfg);
  try {
    storage().setItem(CFG_KEY, encoded);
  } catch {
    // Quota: the config MUST win over the best-effort widget caches — drop
    // them and retry once. A second failure propagates to the caller.
    for (let i = storage().length - 1; i >= 0; i--) {
      const k = storage().key(i);
      if (k && k.startsWith(CACHE_PREFIX)) storage().removeItem(k);
    }
    storage().setItem(CFG_KEY, encoded);
  }
}

export function saveCache(id, data, t = Math.floor(Date.now() / 1000)) {
  try {
    storage().setItem(CACHE_PREFIX + id, JSON.stringify({ t, data }));
  } catch {
    // Storage full or unavailable — cache is best-effort.
  }
}

export function loadCache(id) {
  try {
    const raw = storage().getItem(CACHE_PREFIX + id);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null; // storage unavailable — best-effort, mirroring saveCache
  }
}

/* ---------- pending edit-mode handoff ---------- */

// Settings → Widgets hands off to edit mode, and when it has changes to save
// first that save reloads the board (the only way config changes get applied).
// The intent to open the editor therefore cannot live in a variable, so it is
// parked here for the length of that one reload. sessionStorage, not local:
// this belongs to the tab and the moment, never to the board.
//
// The timestamp is the safety catch. A save that throws before it reloads would
// otherwise leave the flag lying there for the NIGHTLY reload to find, and a
// board that wakes up in edit mode at 4 AM is a genuinely bad morning.
const EDIT_KEY = 'sgn.editafter';
const EDIT_WINDOW_MS = 60 * 1000;

export function markPendingEdit() {
  try {
    window.sessionStorage.setItem(EDIT_KEY, String(Date.now()));
  } catch {
    // Storage-blocked kiosk: the save still lands, the editor just doesn't open.
  }
}

// Reads AND clears: the intent is spent whether or not the caller acts on it.
export function takePendingEdit() {
  try {
    const at = Number(window.sessionStorage.getItem(EDIT_KEY));
    window.sessionStorage.removeItem(EDIT_KEY);
    return at > 0 && Date.now() - at < EDIT_WINDOW_MS;
  } catch {
    return false;
  }
}
