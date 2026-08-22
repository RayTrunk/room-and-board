// Assemble the idlescreen.io front door from site/ into dist/frontdoor.
//
// The front door is the public widget guide served on its own origin so it
// can cache normally while the app keeps `no-cache` (see site/_headers). It
// used to be a hand-curled mirror of the live /info page, which meant it went
// stale whenever /info shipped without anyone re-running the mirror; this
// script makes it a build product of the same commit instead. CI deploys the
// output to the `quadrille-site` Pages project on every push to main
// (.github/workflows/test.yml), and `npm run deploy:frontdoor` is the manual
// fallback. That project name predates two renames now and is deliberately
// frozen: idlescreen.io and unsleep.io are both custom domains attached to it,
// so renaming the project would break those attachments to rename a string
// nobody sees.
//
// There are no brand rewrites here, and that absence is the design. The guide
// carries its own title, copy and app links, and this script serves the same
// bytes the app serves at /info. A rewrite layer would let the two origins
// drift, which is the exact failure the hand-curled mirror used to produce.
// Brand copy changes belong in site/info.html.
//
// The file list is EXPLICIT on purpose: the guide is self-contained (one
// stylesheet, one script, the changelog it fetches, and its images), and an
// explicit list fails loudly in CI when a new dependency is added to
// info.html without being shipped here — a silent partial copy would serve a
// broken page with a green build.
import { cpSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(repo, 'dist/frontdoor');

const FILES = [
  // [source under site/, destination under dist/frontdoor/]
  ['info.html', 'index.html'], // the guide IS the front door's root...
  ['info.html', 'info.html'], // ...and /info keeps working for old links
  // The guide's footer links this relatively, so it must exist on BOTH
  // origins — idlescreen.io/terms and idlescreen.app/terms are the same bytes. The
  // reference guard below is what enforces that it keeps being shipped.
  ['terms.html', 'terms.html'],
  ['css/info.css', 'css/info.css'],
  ['js/info.js', 'js/info.js'],
  ['data/changelog.json', 'data/changelog.json'], // also the health probe
  // Icon filenames track site/assets and the guide's <link rel="icon">; they
  // are brand-named, so a rename on either side has to land on both.
  ['assets/idlescreen-quad.svg', 'assets/idlescreen-quad.svg'],
  ['assets/idlescreen-favicon-32.png', 'assets/idlescreen-favicon-32.png'],
  ['assets/idlescreen-icon-180.png', 'assets/idlescreen-icon-180.png'],
  // Every superseded set still ships, and the list only ever grows. The front
  // door caches normally (that is its point), so HTML cached under an earlier
  // name keeps resolving its icons until it expires instead of 404ing them —
  // and Pages propagates PER-ASSET, so a copy that stops shipping goes missing
  // while the page that references it is still being served.
  ['assets/unsleep-quad.svg', 'assets/unsleep-quad.svg'],
  ['assets/unsleep-favicon-32.png', 'assets/unsleep-favicon-32.png'],
  ['assets/unsleep-icon-180.png', 'assets/unsleep-icon-180.png'],
  ['assets/quadrille-favicon-32.png', 'assets/quadrille-favicon-32.png'],
  ['assets/quadrille-icon-180.png', 'assets/quadrille-icon-180.png'],
];
const DIRS = [['assets/info', 'assets/info']];

// Name the missing sources before copying. cpSync would fail anyway, but on
// the first one and with a bare ENOENT path; a renamed asset set is worth a
// sentence that says which side of the rename is out of step.
const absent = [...FILES.map(([s]) => s), ...DIRS.map(([s]) => s)].filter((s) => !existsSync(resolve(repo, 'site', s)));
if (absent.length) {
  console.error('front door cannot find these under site/:', absent);
  process.exit(1);
}

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
