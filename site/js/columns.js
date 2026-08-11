// One split for every full board.
//
// Every full-screen view lays out into the same canvas (expand.js's
// OVERLAY_BODY_H, 814px under the board's 1040px viewport), and every one of
// them then answers the same question: does this many items stand in one grand
// centered column, or deal into two balanced ones, or three? Six views used to
// answer it six different ways, under three custom-property names, each
// re-deriving ceil(n / 2) inside its own template string, with the split
// threshold living in a comment as often as in a constant. Two shipped bugs
// came out of that hand arithmetic and are still documented where they landed:
// the 1080-harness canvas note in expand.js, and the 943px-on-854px wall note
// in markets.js. The arithmetic lives here once now, and the views state their
// differences as inputs instead of re-deriving them in private.
//
// What STAYS with the view is the row COST model: what one row of that view is
// worth. A ticker tile is not a headline row is not a train row, and no shared
// module can know that. A view pins or measures its own row height, works out
// how many of them one column carries, and hands that number in.

// The deal: how many columns a board of `count` items takes, and how many rows
// each of those columns then carries.
//
//   fitsOneColumn  rows one column may carry before the board splits. The
//                  view's own number, arithmetic (golf's twelve pinned 60px
//                  rows inside the 814px body) or aesthetic (rail's six trains,
//                  which fit fine but huddle on a 1920px canvas).
//   maxColumns     the width ceiling. Two for the boards that balance; markets'
//                  ticker wall runs to six, and the news families stop at two
//                  or three by how long the text they carry is.
//   from           the column count to start growing from. Only the ticker wall
//                  uses it: the wall has a preferred shape at each ticker count
//                  (three across is right for six tiles), and the row budget
//                  only ever pushes that wider, never narrower.
//   rowsPerColumn  a hard row budget, for a view that must not deal more rows
//                  than its canvas seats. The news reading list is the one with
//                  it, because its corner badge promises a count that the view
//                  then has to deliver.
//
// Columns grow one at a time until the rows fit, so a board is always the
// FEWEST columns that hold it, and `rows` is the balanced share (ceil, so the
// first column is the fuller of the two). Zero items is one EMPTY column
// rather than no columns: a view asking how to lay out nothing still gets a
// shape it can render, and the one view that would rather draw nothing at all
// (the ledger) says so itself at its own call site.
export function dealColumns(count, { fitsOneColumn, maxColumns = 2, from = 1, rowsPerColumn = 0 } = {}) {
  const n = Math.max(0, count);
  let columns = Math.max(1, from);
  while (Math.ceil(n / columns) > fitsOneColumn && columns < maxColumns) columns += 1;
  const rows = Math.ceil(n / columns);
  return {
    columns,
    rows: rowsPerColumn ? Math.min(rows, rowsPerColumn) : rows,
    // What the board can seat once it is dealt. Under a row budget that is the
    // budget times the columns, not the rows actually used: a half-filled board
    // still has the seats, which is what a "+N" promise is measured against.
    seats: (rowsPerColumn || rows) * columns,
  };
}

// The same deal, applied to the items themselves: filled DOWN the first group
// and then down the second, the reading order the ledger and the dial grid both
// want (seven splits 4 + 3, never 6 + 1). The dial grid reads its groups as
// ROWS rather than columns; the arithmetic is the same deal either way, which
// is most of the reason it lives in one place.
export function dealInto(items, opts) {
  const { columns, rows } = dealColumns(items.length, opts);
  return Array.from({ length: columns }, (_, i) => items.slice(i * rows, (i + 1) * rows));
}

// The inline style attribute that hands the answer to CSS, leading space
// included so a template can write it straight after the class list.
//
// Three property names are in play and they are NOT interchangeable:
// --board-rows (the rail and golf boards) and --list-rows (the news list) carry
// rows PER COLUMN into a grid-auto-flow:column track list, while the ticker
// wall's --cols carries the COLUMN COUNT into its track template. Which
// property a view speaks, and which of the two numbers it hands over, is the
// view's business; spelling the attribute is not.
export const gridStyle = (prop, value) => ` style="${prop}:${value}"`;
