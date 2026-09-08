/**
 * Which rows the result grid shows and in what order — as a list of indexes into the rows the
 * server sent, never as rows of its own.
 *
 * That is the whole design of this file. A filtered or sorted copy of the rows would be a new array
 * of new positions every time a key is pressed in the filter box, and three things already in the
 * grid are built on the rows not moving: the column widths are measured from `rows` and would be
 * re-measured per keystroke; each row is memoised on its own identity and would be rebuilt whole;
 * and the `#` column counts a row's place in the real result, which a copy no longer knows. With
 * indexes, all three keep working and the `#` column is `view[i] + 1`.
 *
 * Free of React so the comparing and the matching — where the surprises are — can be tested on
 * their own.
 */
import { displayValue } from "../../../../core/virtualRows";

/** Which column the grid is sorted by, and which way. Null everywhere else means "as it arrived". */
export interface Sort {
  column: number;
  direction: "asc" | "desc";
}

function isNothing(value: unknown): boolean {
  return value === null || value === undefined;
}

/**
 * Two cells in the order a column of them should read, ascending.
 *
 * Nothing goes last, and it goes last **in both directions** — which is why the null test is here
 * rather than left to the caller's minus sign. A column that is mostly NULL, sorted descending to
 * find its largest value, would otherwise open on a screenful of nothing.
 *
 * Numbers and bigints are compared as themselves; everything else is compared as text with
 * `numeric: true`, so `item2` comes before `item10` rather than after it. Text is where most of a
 * result actually lives, and reading its digits is what makes an `id` column sort like an id.
 */
export function compareValues(a: unknown, b: unknown): number {
  if (isNothing(a) || isNothing(b)) {
    if (isNothing(a) && isNothing(b)) return 0;
    return isNothing(a) ? 1 : -1;
  }
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "bigint" && typeof b === "bigint") return a < b ? -1 : a > b ? 1 : 0;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/**
 * Whether any cell of the row holds `needle`.
 *
 * Compared against the very text the grid draws — `displayValue` — rather than against the raw
 * value, so what matches is what can be seen. It also means typing `null` finds the empty cells,
 * since NULL is the word drawn in them.
 *
 * A plain case-insensitive substring, no regular expressions. What gets typed here is an id or a
 * piece of an email; a box that quietly took `.` or `*` as a pattern would answer strangely to a
 * filename and there would be nothing on screen explaining why.
 */
export function rowMatches(row: unknown[], needle: string): boolean {
  const wanted = needle.toLowerCase();
  if (wanted === "") return true;
  return row.some((value) => displayValue(value).toLowerCase().includes(wanted));
}

/** Where one more click on a column heading leaves the sort: ascending, then descending, then back
 *  to the order the server sent. A different column starts the cycle again. */
export function nextSort(current: Sort | null, column: number): Sort | null {
  if (current === null || current.column !== column) return { column, direction: "asc" };
  return current.direction === "asc" ? { column, direction: "desc" } : null;
}

/**
 * The rows to draw, in the order to draw them, as indexes into `rows`.
 *
 * Filtered first and sorted after, so the sort runs over the smaller set. The needle is trimmed:
 * a trailing space out of a paste would otherwise empty the grid and look like a result with
 * nothing in it.
 *
 * The sort is stable, by comparing the original indexes when the two values are equal. Without
 * that, a column of a hundred equal values reshuffles itself under the pointer every time anything
 * else about the grid changes.
 */
export function viewIndexes(rows: unknown[][], sort: Sort | null, query: string): number[] {
  const needle = query.trim();
  const view: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (needle === "" || rowMatches(rows[i], needle)) view.push(i);
  }
  if (sort === null) return view;
  const { column, direction } = sort;
  return view.sort((a, b) => {
    const left = rows[a][column];
    const right = rows[b][column];
    const order = compareValues(left, right);
    if (order === 0) return a - b;
    // The minus sign is kept off the null cases on purpose: nothing sorts last whichever way the
    // column is pointing, and negating it here is exactly what would flip it to the top.
    if (isNothing(left) || isNothing(right)) return order;
    return direction === "desc" ? -order : order;
  });
}
