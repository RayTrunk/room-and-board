// HTML -> readable plain text, for upstream feeds that deliver prose as markup.
//
// The board escapes every string at render time (defense in depth against
// injection), so any tag that survives the digest prints as LITERAL TEXT on a
// real board — that is the bug this fixes: a Slack incident body arrived as
// "<p>We&#39;re currently investigating...</p>" and the full-screen reader
// showed it verbatim, tags and all. Sanitize at the data boundary instead:
// the vm stores text, the renderer keeps escaping it.
//
// The client has its own decoder for RSS (site/js/widgets/newscore.js); this is
// the Worker-side twin — the two can't share a module (that one imports DOM
// helpers), but the "strip, decode, strip again" lesson is the same one.

// Common named entities seen in status/incident copy. Numeric refs are handled
// inline; an unknown named ref is left alone rather than mangled.
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', bull: '•', middot: '·',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  copy: '©', reg: '®', trade: '™', deg: '°', times: '×', frasl: '/',
  laquo: '«', raquo: '»', euro: '€', pound: '£', yen: '¥', sect: '§',
};

// A named ref needs its semicolon (so "AT&T" survives); a numeric one may drop
// it — sloppy feeds emit bare "&#9992" (see njt.js, same quirk).
const ENTITY = /&(?:#x([0-9a-f]+);?|#(\d+);?|([a-z][a-z0-9]*);)/gi;

function decodeEntities(s) {
  return s.replace(ENTITY, (m, hex, dec, name) => {
    if (hex !== undefined || dec !== undefined) {
      const n = hex !== undefined ? parseInt(hex, 16) : Number(dec);
      // Bound to valid Unicode: fromCodePoint throws RangeError above 0x10FFFF,
      // which would kill this service's whole parse on every refresh.
      return Number.isFinite(n) && n > 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : m;
    }
    const c = NAMED[name.toLowerCase()];
    return c === undefined ? m : c;
  });
}

const SCRIPTISH = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const COMMENT = /<!--[\s\S]*?-->/g;
// Line-level markup keeps its single break; block-level markup opens a
// paragraph. Everything else is presentational and simply disappears.
const LINE = /<(?:br|hr|li|tr)\b[^>]*\/?>/gi;
const BLOCK = /<\/?(?:p|div|ul|ol|dl|table|tbody|thead|h[1-6]|blockquote|section|article|header|footer|pre|figure)\b[^>]*>/gi;
const ANY_TAG = /<\/?[a-z!/][^>]*>/gi;
// Only re-strip after decoding when something tag-SHAPED appeared: requiring a
// letter right after "<" keeps arithmetic prose ("a < b") intact.
const TAGISH = /<\/?[a-z][a-z0-9]*[^>]*>/i;

function stripMarkup(s) {
  return s
    .replace(SCRIPTISH, ' ')
    .replace(COMMENT, ' ')
    .replace(LINE, '\n')
    .replace(BLOCK, '\n\n')
    .replace(ANY_TAG, '');
}

// One space between words, at most one blank line between paragraphs, no
// stray padding at either end. Newlines that were already in the source
// (Google's dashboard prose is plain text with real \n) are preserved.
function collapse(s) {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Convert feed markup to plain text: <p>/<br> become paragraph/line breaks,
 * every other tag is dropped, entities are decoded, whitespace is collapsed.
 * Plain text passes through unchanged (beyond trimming/whitespace tidying).
 */
export function htmlToText(input) {
  let s = String(input ?? '');
  // Two passes: some feeds entity-ENCODE their markup ("&lt;p&gt;"), so those
  // tags only become strippable after the first decode.
  for (let pass = 0; pass < 2; pass += 1) {
    s = decodeEntities(stripMarkup(s));
    if (!TAGISH.test(s)) break;
  }
  return collapse(s);
}
