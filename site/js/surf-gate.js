// Ocean gate for the Surf card.
//
// Surf is the first widget whose availability depends on WHERE the board is
// rather than on what its owner turned on. A board in Denver has no surf to
// report, so offering the card there would be a promise the model cannot keep:
// the id stays out of every add picker until a probe has confirmed that the
// effective spot actually resolves to open water.
//
// The verdict has to be readable SYNCHRONOUSLY — isAddable is a pure predicate
// called while a picker is being built — so a probe result is cached in
// localStorage, stamped with the location it was taken for. A miss means "not
// yet", never "no": the card simply does not appear until a probe lands, and
// the two surfaces that can afford an await (board boot, the /setup wizard)
// kick one in the background and repaint when it does.
//
// Storage, not the Cache API: this is one tiny record per board, written at
// most once a day, and it must survive a reload to be readable synchronously
// at first paint. (The Cache-API rule in the worker is about response bodies.)

const KEY = 'sgn.surf.probe';

// How long a verdict stands. Coastlines do not move; this exists so a board
// that probed during an upstream outage re-asks within a day rather than
// hiding the card forever.
export const PROBE_TTL_MS = 24 * 60 * 60 * 1000;

// How far the model may snap the pin before "the ocean near your board" stops
// being true. Open-Meteo resolves each marine variable on its own ~5 km wave
// grid and returns the CENTER of the cell it chose, so a genuinely coastal pin
// lands within a few km; 30 km is generous enough for a bay or a barrier
// island and tight enough to reject an inland town that happens to sit within
// reach of a stray water cell.
export const MAX_SNAP_KM = 30;

// Widget ids the gate governs. A list rather than a literal so the predicate
// reads like its BETA_ONLY / ADVANCED_WIDGETS siblings in config.js.
export const OCEAN_WIDGETS = Object.freeze(['surf']);

const RAD = Math.PI / 180;
const R_KM = 6371.0088;

// Resolve through window, exactly as store.js does: Node >= 22 defines a stub
// `localStorage` global that is undefined without a flag and would shadow the
// DOM one under test.
const storage = () => window.localStorage;

// A coordinate, or NaN. Number(null) is 0 and Number('') is 0, and a pin at
// 0,0 in the Gulf of Guinea is very much an ocean — so a missing coordinate has
// to be rejected before it is coerced, not after.
export const coord = (v) =>
  (v === null || v === undefined || v === '' ? NaN : Number(v));

// Which spot a cached verdict belongs to. Rounded to ~100 m: re-picking the
// same town from the geocoder can jitter the last decimals, and re-probing on
// that is pure noise. Any real move re-probes.
export const spotKey = (loc) =>
  `${coord(loc?.lat).toFixed(3)},${coord(loc?.lon).toFixed(3)}`;

// Distance and bearing from the requested pin to the grid cell the model
// actually answered for. Equirectangular: at the tens-of-km scale that matters
// here it agrees with the great circle to well under a metre, and it keeps the
// math legible.
//
// The bearing is the whole reason this is worth computing. A marine model only
// has cells over WATER, so the direction it had to move the pin to find one IS
// the direction of the sea — the shore-facing normal, derived for free from a
// call the widget was making anyway. (Verified: Bridgehampton 172 deg, Bondi
// 42 deg.)
export function snapVector(pin, cell) {
  const lat1 = coord(pin?.lat);
  const lon1 = coord(pin?.lon);
  const lat2 = coord(cell?.lat);
  const lon2 = coord(cell?.lon);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return { km: null, bearing: null };
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD * Math.cos(((lat1 + lat2) / 2) * RAD);
  return {
    km: Math.hypot(dLat, dLon) * R_KM,
    // atan2(east, north): 0 = due north, clockwise, the compass convention.
    bearing: (Math.atan2(dLon, dLat) / RAD + 360) % 360,
  };
}

// Smallest angle between two bearings, 0..180.
export const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// Onshore / offshore / cross, from the wind's METEOROLOGICAL direction (the
// bearing it blows FROM) and the seaward normal. Wind arriving from the water
// is onshore and mushes the face; wind arriving from the land is offshore and
// holds it up. Anything in between is cross, which is a real third answer and
// not a rounding of the other two.
export function windQuality(windFromDeg, shoreBearing) {
  if (!Number.isFinite(windFromDeg) || !Number.isFinite(shoreBearing)) return null;
  const d = angleBetween(windFromDeg, shoreBearing);
  if (d <= 45) return 'onshore';
  if (d >= 135) return 'offshore';
  return 'cross';
}

export function readProbe() {
  try {
    const raw = storage().getItem(KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    return rec && typeof rec === 'object' && typeof rec.key === 'string' ? rec : null;
  } catch {
    return null; // storage unavailable — best-effort, mirroring store.js
  }
}

export function writeProbe(rec) {
  try {
    storage().setItem(KEY, JSON.stringify(rec));
  } catch {
    // Storage full or blocked. The card stays hidden, which is the safe way
    // for this gate to fail.
  }
}

export function clearProbe() {
  try {
    storage().removeItem(KEY);
  } catch {
    // best-effort
  }
}

// The cached verdict for THIS spot, if there is a usable one. Returns null on a
// miss, on a stale record, and on a record taken for somewhere else — the three
// cases the callers all treat the same way ("re-probe").
export function probeVerdict(loc, nowMs = Date.now()) {
  const rec = readProbe();
  if (!rec) return null;
  if (rec.key !== spotKey(loc)) return null;
  if (!Number.isFinite(rec.t) || nowMs - rec.t > PROBE_TTL_MS) return null;
  return rec;
}

// The sync answer isAddable needs. Deliberately pessimistic: no verdict means
// no card.
export function hasOcean(loc, nowMs = Date.now()) {
  return probeVerdict(loc, nowMs)?.ocean === true;
}

// Turn a marine payload into a verdict. Usable water needs BOTH a real wave
// reading (an inland pin gets a 200 with every value null) and a snap short
// enough that the answer still describes the board's own coast.
export function verdictFrom(loc, json, nowMs = Date.now()) {
  const wave = json?.current?.wave_height;
  const { km, bearing } = snapVector(loc, { lat: json?.latitude, lon: json?.longitude });
  const ocean = Number.isFinite(wave) && Number.isFinite(km) && km <= MAX_SNAP_KM;
  return {
    key: spotKey(loc),
    t: nowMs,
    ocean,
    km: Number.isFinite(km) ? Number(km.toFixed(2)) : null,
    bearing: Number.isFinite(bearing) ? Number(bearing.toFixed(1)) : null,
  };
}

// The probe URL: one variable, so it costs ~0.1 of a weighted Open-Meteo call.
// A board that has the card placed never pays it — surf.js records the same
// verdict out of the full refresh it was making anyway.
export const probeUrl = (loc) =>
  'https://marine-api.open-meteo.com/v1/marine'
  + `?latitude=${loc.lat}&longitude=${loc.lon}&current=wave_height&length_unit=imperial`;

export async function probeOcean(loc, net, nowMs = Date.now()) {
  const json = await net.fetchJSON(probeUrl(loc));
  const rec = verdictFrom(loc, json, nowMs);
  writeProbe(rec);
  return rec;
}

// Fire-and-forget: kicked once per surface (board boot, /setup boot) and only
// when the cache has nothing usable to say. `onDone` lets a picker repaint
// itself when a verdict lands mid-session. Never rejects — a failed probe just
// leaves the card hidden until the next kick.
export function ensureOceanProbe(loc, net, onDone = null, nowMs = Date.now()) {
  if (!Number.isFinite(coord(loc?.lat)) || !Number.isFinite(coord(loc?.lon)) || probeVerdict(loc, nowMs)) return false;
  Promise.resolve()
    .then(() => probeOcean(loc, net, Date.now()))
    .then((rec) => onDone?.(rec))
    .catch(() => {});
  return true;
}
