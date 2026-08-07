// Assemble the quadrille.io front door from site/ into dist/frontdoor.
//
// The front door is the public widget guide served on its own origin so it
// can cache normally while the app keeps `no-cache` (see site/_headers). It
// used to be a hand-curled mirror of the live /info page, which meant it went
// stale whenever /info shipped without anyone re-running the mirror; this
// script makes it a build product of the same commit instead. CI deploys the
// output to the `quadrille-site` Pages project on every push to main
// (.github/workflows/test.yml), and `npm run deploy:frontdoor` is the manual
// fallback.
//
// The file list is EXPLICIT on purpose: the guide is self-contained (one
// stylesheet, one script, the changelog it fetches, and its images), and an
// explicit list fails loudly in CI when a new dependency is added to
// info.html without being shipped here — a silent partial copy would serve a
// broken page with a green build.
import { cpSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(repo, 'dist/frontdoor');

const FILES = [
  // [source under site/, destination under dist/frontdoor/]
  ['info.html', 'index.html'], // the guide IS the front door's root...
  ['info.html', 'info.html'], // ...and /info keeps working for old links
  ['css/info.css', 'css/info.css'],
  ['js/info.js', 'js/info.js'],
  ['data/changelog.json', 'data/changelog.json'], // also the health probe
  ['assets/quadrille-favicon-32.png', 'assets/quadrille-favicon-32.png'],
  ['assets/quadrille-icon-180.png', 'assets/quadrille-icon-180.png'],
];
const DIRS = [['assets/info', 'assets/info']];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const [src, dest] of FILES) {
  const to = resolve(out, dest);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(resolve(repo, 'site', src), to);
}
for (const [src, dest] of DIRS) {
  cpSync(resolve(repo, 'site', src), resolve(out, dest), { recursive: true });
}

// Guard: the guide must not lean on app-relative URLs the front door cannot
// serve. Everything it references must be in the explicit list above, or an
// absolute URL into the app origin (the /setup pointer is absolute by design).
const html = readFileSync(resolve(out, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)].map((m) => m[1]);
const missing = refs.filter((r) => !/^https?:/.test(r) && !FILES.some(([, d]) => d === r) && !r.startsWith('assets/info/'));
if (missing.length) {
  console.error('front door references files it does not ship:', missing);
  process.exit(1);
}
console.log(`front door assembled: ${FILES.length} files + assets/info -> ${out}`);
