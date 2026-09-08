/**
 * Rows of a grid as text somebody can paste somewhere else.
 *
 * Here rather than beside a grid because two grids need it and neither owns it: the data tab's
 * table hands over `Record<string, unknown>` rows keyed by column name, and the query tab's result
 * hands over positional `unknown[]` — an arbitrary SELECT may name the same column twice, and only
 * a positional row keeps the two apart. The positional form is the one that loses nothing, so it is
 * the one this file speaks, and `rowText.ts` maps down into it.
 *
 * Free of React and of any module's ideas, for the same reason it was worth extracting at all: the
 * escaping is the part that is easy to get quietly wrong and impossible to see wrong on screen.
 */

/**
 * What separates one cell from the next in each of the two table formats: a tab for what goes
 * straight into a spreadsheet's cells, a comma for what is saved as a `.csv`.
 *
 * Both are the same shape of text — the difference is only where they are going. Pasting into an
 * open spreadsheet, tabs land in cells without a word about delimiters; a CSV file is read back by
 * everything, but which character a spreadsheet takes as the separator when *opening* one depends
 * on where the machine thinks it is, which is why a paste is not sent as CSV.
 */
const TAB_SEPARATOR = "\t";
const COMMA_SEPARATOR = ",";

/** CRLF rather than a bare newline: it is what Excel writes itself, what RFC 4180 asks for, and
 *  what every other spreadsheet reads. */
const ROW_SEPARATOR = "\r\n";

/**
 * One cell of either format.
 *
 * NULL becomes an empty cell — neither format has another way of saying "nothing here", and the
 * word NULL in it would be text somebody has to clear out of a hundred cells by hand.
 *
 * A value holding the separator, a line break or a quote would otherwise break itself into columns
 * or rows of its own. Wrapped in quotes, with its own quotes doubled, it arrives as the single cell
 * it is — the escaping both formats share.
 */
function delimitedCell(value: unknown, separator: string): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  const risky = text.includes(separator) || /["\r\n]/.test(text);
  return risky ? `"${text.replace(/"/g, '""')}"` : text;
}

/** `rows` as a table of text, the column names along the top — without them a copy of six columns
 *  out of forty is six columns of unlabelled numbers. */
function delimitedText(columns: string[], rows: unknown[][], separator: string): string {
  const lines = [columns.map((name) => delimitedCell(name, separator)).join(separator)];
  for (const row of rows) {
    lines.push(columns.map((_, c) => delimitedCell(row[c], separator)).join(separator));
  }
  return lines.join(ROW_SEPARATOR);
}

/** `rows` as the tab-separated text a spreadsheet pastes into cells. */
export function tsvText(columns: string[], rows: unknown[][]): string {
  return delimitedText(columns, rows, TAB_SEPARATOR);
}

/** `rows` as CSV, for saving to a file rather than pasting into an open sheet. */
export function csvText(columns: string[], rows: unknown[][]): string {
  return delimitedText(columns, rows, COMMA_SEPARATOR);
}

/**
 * The column names with the repeats told apart: `id`, `id_2`, `id_3`.
 *
 * Only JSON needs this. The two delimited formats write a header row and a repeated name there is
 * merely a repeated name, the way the grid itself shows it; an object has one slot per key, so the
 * second `id` would land on top of the first and a column would be gone without a word. Of the
 * three ways out — drop it, refuse, rename — renaming is the only one that keeps the data.
 *
 * The suffix is searched for rather than counted, because a result may already hold a column
 * genuinely called `id_2` and taking its name would put two columns back in one slot.
 */
export function uniqueNames(columns: string[]): string[] {
  const taken = new Set<string>();
  return columns.map((name) => {
    let unique = name;
    let n = 1;
    while (taken.has(unique)) unique = `${name}_${++n}`;
    taken.add(unique);
    return unique;
  });
}

/**
 * `rows` as a JSON array of objects, indented — the form that goes into a request body or a fixture
 * rather than into a spreadsheet.
 *
 * A missing cell is written as `null` rather than left out: `JSON.stringify` drops an `undefined`
 * value and the row would come out short a key, which reads as "this row has no such column"
 * instead of "this row has nothing there".
 */
export function jsonText(columns: string[], rows: unknown[][]): string {
  const names = uniqueNames(columns);
  const objects = rows.map((row) => {
    const object: Record<string, unknown> = {};
    names.forEach((name, c) => {
      object[name] = row[c] ?? null;
    });
    return object;
  });
  return JSON.stringify(objects, null, 2);
}
