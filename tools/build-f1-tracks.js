// Builds site/data/f1-tracks.json — one compact SVG outline per Formula 1
// circuit, keyed by the Ergast/Jolpica circuitId the /f1 digest already carries.
// Run: node tools/build-f1-tracks.js
//
// SOURCE + LICENCE (verified 2026-08-02 before vendoring, per the repo's
// open-source rule — nothing is bundled until its licence is checked):
//   bacinger/f1-circuits — "A repository of Formula 1 circuits in GeoJSON
//   format", https://github.com/bacinger/f1-circuits
//   MIT License, Copyright (c) 2019-2025 Tomislav Bacinger.
//   Confirmed against the GitHub licence API (spdx_id "MIT") and LICENSE.md.
// MIT is permissive and compatible with vendoring the DERIVED paths here, so
// long as the copyright notice travels with them: it is repeated in the header
// of the generated JSON (`_source`) and must stay there.
//
// Re-run when the calendar adds a circuit (rare — the upstream set is
// historical as well as current). A stale file only means a missing map: the
// view drops the outline for an unknown circuitId and renders everything else.
//
// WHAT THE PROJECTION DOES
// The source is a closed WGS84 LineString per circuit. Each is projected
// equirectangular about its own centre latitude (x = lon·cos(lat0), y = -lat,
// so north is up), scaled to fit a ~400px box, simplified with
// Douglas-Peucker, and rounded to 0.1 units. The START/FINISH tick is a short
// segment perpendicular to the track at the LineString's FIRST vertex, which
// in this dataset is the start/finish line. It ships as its own plain <path>
// because gen1 Qt WebEngine has no SVG clipPath — colouring one segment of a
// line means splitting the line (DESIGN.md).
import { writeFile } from 'node:fs/promises';

const SRC = 'https://raw.githubusercontent.com/bacinger/f1-circuits/master/f1-circuits.geojson';

// The upstream ids are country-year ("nl-1948"); the digest speaks Ergast
// circuitIds. Explicit, because a fuzzy name match would quietly put the wrong
// track under a Grand Prix. Verified against the Jolpica circuit table
// (78 circuits) 2026-08-02. Note us-2023 is the modern Las Vegas STRIP circuit
// (Ergast `vegas`), NOT the 1981-82 Caesars Palace one (Ergast `las_vegas`).
export const ERGAST_ID = {
  'au-1953': 'albert_park', 'bh-2002': 'bahrain', 'cn-2004': 'shanghai',
  'es-1991': 'catalunya', 'mc-1929': 'monaco', 'ca-1978': 'villeneuve',
  'fr-1969': 'ricard', 'at-1969': 'red_bull_ring', 'gb-1948': 'silverstone',
  'de-1932': 'hockenheimring', 'hu-1986': 'hungaroring', 'be-1925': 'spa',
  'it-1922': 'monza', 'sg-2008': 'marina_bay', 'ru-2014': 'sochi',
  'jp-1962': 'suzuka', 'us-2012': 'americas', 'mx-1962': 'rodriguez',
  'br-1940': 'interlagos', 'ae-2009': 'yas_marina', 'it-1953': 'imola',
  'de-1927': 'nurburgring', 'pt-2008': 'portimao', 'it-1914': 'mugello',
  'my-1999': 'sepang', 'tr-2005': 'istanbul', 'nl-1948': 'zandvoort',
  'fr-1960': 'magny_cours', 'pt-1972': 'estoril', 'br-1977': 'jacarepagua',
  'sa-2021': 'jeddah', 'us-2022': 'miami', 'qa-2004': 'losail',
  'es-2026': 'madring', 'az-2016': 'baku', 'us-2023': 'vegas',
  'us-1909': 'indianapolis', 'ar-1952': 'galvez', 'za-1961': 'kyalami',
  'us-1956': 'watkins_glen',
};

const BOX = 400;   // the longer side of the drawn outline, in viewBox units
const PAD = 14;    // room for the stroke's own width at the extremes
const TOL = 1.0;   // Douglas-Peucker tolerance, in the same units
const TICK = 20;   // start/finish tick length

// Perpendicular distance from p to the segment ab, squared.
function segDist2([px, py], [ax, ay], [bx, by]) {
  let x = ax, y = ay;
  const dx = bx - ax, dy = by - ay;
  if (dx || dy) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = bx; y = by; } else if (t > 0) { x += dx * t; y += dy * t; }
  }
  return (px - x) ** 2 + (py - y) ** 2;
}

// Douglas-Peucker. Iterative (a 200-point circuit is shallow, but recursion
// depth is not a thing to leave to chance in a build script).
export function simplify(pts, tol = TOL) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let far = -1, best = tol2;
    for (let i = lo + 1; i < hi; i += 1) {
      const d = segDist2(pts[i], pts[lo], pts[hi]);
      if (d > best) { best = d; far = i; }
    }
    if (far < 0) continue;
    keep[far] = 1;
    stack.push([lo, far], [far, hi]);
  }
  return pts.filter((_, i) => keep[i]);
}

const r1 = (n) => Math.round(n * 10) / 10;

// One GeoJSON feature -> { d, viewBox, sf, name, m }, or null if it is not a
// circuit we can key by circuitId.
export function circuitPath(feature) {
  const cid = ERGAST_ID[feature?.properties?.id];
  const ring = feature?.geometry?.coordinates;
  if (!cid || !Array.isArray(ring) || ring.length < 4) return null;

  // Closed rings repeat their first point; carry the closure in `Z` instead.
  const open = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]
    ? ring.slice(0, -1)
    : ring.slice();

  const lat0 = (Math.min(...open.map((c) => c[1])) + Math.max(...open.map((c) => c[1]))) / 2;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const flat = open.map(([lon, lat]) => [lon * k, -lat]);

  const xs = flat.map((p) => p[0]);
  const ys = flat.map((p) => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const bw = Math.max(...xs) - minX, bh = Math.max(...ys) - minY;
  const scale = BOX / Math.max(bw, bh);
  const put = ([x, y]) => [(x - minX) * scale + PAD, (y - minY) * scale + PAD];

  const box = flat.map(put);
  const pts = simplify(box);
  const d = `${pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(x)} ${r1(y)}`).join('')}Z`;

  // The tangent comes from the UNSIMPLIFIED first segment: simplification may
  // drop everything between the start and a corner far down the straight, and
  // the tick has to cross the track squarely.
  const [ax, ay] = box[0];
  const [bx, by] = box[1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const nx = -(by - ay) / len, ny = (bx - ax) / len;
  const sf = `M${r1(ax - (nx * TICK) / 2)} ${r1(ay - (ny * TICK) / 2)}L${r1(ax + (nx * TICK) / 2)} ${r1(ay + (ny * TICK) / 2)}`;

  return [cid, {
    d,
    viewBox: `0 0 ${r1(bw * scale + 2 * PAD)} ${r1(bh * scale + 2 * PAD)}`,
    sf,
    name: String(feature.properties.Location ?? ''),
    m: Number(feature.properties.length) || 0,
  }];
}

export function buildTracks(geojson) {
  const out = {};
  for (const f of geojson?.features ?? []) {
    const hit = circuitPath(f);
    if (hit) out[hit[0]] = hit[1];
  }
  return out;
}

// --- build ---------------------------------------------------------------
// Guarded so the exports above can be imported by the shape test without the
// network call running.
if (import.meta.url === `file://${process.argv[1]}`) {
  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`f1-circuits ${res.status} for ${SRC} — verify the URL (repo moved or renamed?)`);
  const circuits = buildTracks(await res.json());
  const n = Object.keys(circuits).length;
  if (n < 30) throw new Error(`only ${n} circuits mapped — upstream ids changed? check ERGAST_ID`);

  const out = {
    _source: {
      repo: 'https://github.com/bacinger/f1-circuits',
      license: 'MIT',
      copyright: 'Copyright (c) 2019-2025 Tomislav Bacinger',
      note: 'Outlines derived from the upstream GeoJSON by tools/build-f1-tracks.js: equirectangular projection, scaled, Douglas-Peucker simplified. Keys are Ergast/Jolpica circuitIds. Keep this notice with the data.',
    },
    ...circuits,
  };
  await writeFile(new URL('../site/data/f1-tracks.json', import.meta.url), JSON.stringify(out));
  const bytes = JSON.stringify(out).length;
  console.log(`f1-tracks: ${n} circuits, ${(bytes / 1024).toFixed(1)} KB`);
  console.log('ids:', Object.keys(circuits).sort().join(', '));
}
