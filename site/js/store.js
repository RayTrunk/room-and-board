// What the board keeps, and the one operation that changes it: the config and
// the widget caches in localStorage, the mirror of the config in the macro
// vault, and applyConfig, which puts a new config in both and reloads onto it.
//
// The signage web-engine profile keeps this data across standby, reboots and
// RoomOS upgrades (per Cisco's WebEngine guide); the macro vault is the
// recovery layer if it is ever wiped.

import { encodeConfig, decodeConfig, normalizeConfig } from './config.js';

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

/* ---------- the device bridge, and the vault behind it ---------- */

// The macro vault named at the top of this file is reached over one WebSocket
// to the board's own xAPI, opened by main.js at boot from credentials in the
// URL fragment. That connection used to be parked on window.__signage, an
// untyped mutable global that two save paths reached through to find the
// bridge and then wrote the sync outcome back onto. The global existed for one
// reason: settings.js is a lazy import() that boot had nothing to hand it to.
// A module-level variable behind two functions is the same amount of state
// with none of the reach-through, and store.js is where it belongs, because
// the vault is the second of the two places this module keeps the config.
let bridge = null;
// null is not 'offline'. Most boards carry no auth fragment at all and never
// attempt a bridge, and Diagnostics has to be able to say "not connected"
// rather than accuse the network of something that never happened.
let vaultState = null;

// Called once, from the boot that opens the connection: the resolved bridge on
// success, nothing on failure. Passing null IS the failure report, so the two
// outcomes cannot drift apart into two different spellings of the same fact.
export function setBridge(connection) {
  bridge = connection ?? null;
  vaultState = bridge ? 'connected' : 'offline';
}

export function getBridge() {
  return bridge;
}

// 'connected' | 'synced' | 'offline', or null if no bridge was ever attempted.
export function vaultStatus() {
  return vaultState;
}

/* ---------- applying a config to the board ---------- */

// A demo session is a showroom, not a board. Somebody opening /?demo=1 to look
// around must not have a config left behind in their browser, so nothing on
// this path persists. Resolved through window at call time for the same reason
// storage() is: the answer is a property of the page, not of module load order.
export function isDemoSession() {
  return new URLSearchParams(window.location.search).get('demo') === '1';
}

// Applying a config to the board is ONE operation, and this is it: stamp it,
// persist it, mirror it to the vault if there is a bridge, reload.
//
// It was written twice before this (edit mode's Done and Settings' Save), and
// the copies had drifted the way copies do: only one of them honoured "a demo
// session never persists", and only one of them bothered to import the encoder
// lazily. Neither difference was a decision anybody made. The reload is the
// part that makes the rest inevitable, since it is the only way a layout or
// widget change actually reaches the screen, so it belongs to the operation
// rather than to whoever remembers to call it.
//
// `reload` is injectable so a test can watch the ritual finish without a real
// navigation; production never passes it.
export async function applyConfig(cfg, { reload = () => window.location.reload() } = {}) {
  // One fresh stamp, applied once, to the object that then goes everywhere:
  // storage and the vault must never disagree about when this config was made.
  const applied = normalizeConfig({ ...cfg, t: Math.floor(Date.now() / 1000) });
  if (isDemoSession()) {
    // The reload still happens: it is how the demo returns to its fixtures.
    reload();
    return applied;
  }
  // Deliberately unguarded. A quota failure that survived saveConfig's retry
  // means the save did NOT happen, and reloading onto the old config while the
  // panel says "saved" is the one outcome worse than the error.
  await saveConfig(applied);
  if (bridge) {
    try {
      await bridge.sendConfig(await encodeConfig(applied));
      vaultState = 'synced';
    } catch {
      // The vault is the recovery layer, not the store. localStorage already
      // has this config, so a failed mirror is a status to report in
      // Diagnostics, never a reason to withhold the save or skip the reload.
      vaultState = 'offline';
    }
  }
  reload();
  return applied;
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
