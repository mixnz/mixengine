/**
 * Which rows of a result the grid has chosen, and cutting those rows out as data.
 *
 * Rows, the way the data tab's table does it — a plain click takes one, the platform's own modifier
 * toggles one, Shift takes everything between the anchor and here. What someone reaches into a
 * result for is a set of rows to paste somewhere else, and a rectangle of cells made that the one
 * thing they could not have: half a row is not a record.
 *
 * Every coordinate here is a **view** coordinate — which row down the screen — not an index into
 * the rows the server sent. The two differ the moment anything is sorted or filtered, and
 * {@link cutOut} is the single place the one is turned back into the other.
 */

/**
 * The chosen rows, plus the two positions a list selection has to remember.
 *
 * `rows` alone would not do: Shift+click means "from where I started to here", and a bare set has
 * forgotten where that was. `focus` is where an arrow key moves from, which is not the anchor the
 * moment Shift has been held once.
 */
export interface Selection {
  rows: ReadonlySet<number>;
  /** Where a Shift range measures from. */
  anchor: number;
  /** The row the keyboard is on. */
  focus: number;
}

/** The two modifiers a click can carry. `extend` is Shift; `toggle` is Ctrl, or ⌘ on a Mac. */
export interface Modifiers {
  extend: boolean;
  toggle: boolean;
}

function clamp(value: number, last: number): number {
  return Math.min(Math.max(value, 0), last);
}

/** Every row between two, either way round. */
function range(from: number, to: number): number[] {
  const [low, high] = from <= to ? [from, to] : [to, from];
  const out: number[] = [];
  for (let i = low; i <= high; i++) out.push(i);
  return out;
}

/**
 * A click landing on a row.
 *
 * Shift extends from the anchor, which stays where it was. Shift with the modifier adds that stretch
 * to what is already chosen rather than replacing it — which is how a list is asked for two blocks
 * of rows out of the middle of it.
 */
export function pickRow(current: Selection | null, row: number, mods: Modifiers): Selection {
  if (mods.extend && current !== null) {
    const stretch = range(current.anchor, row);
    const rows = mods.toggle ? new Set([...current.rows, ...stretch]) : new Set(stretch);
    return { rows, anchor: current.anchor, focus: row };
  }
  if (mods.toggle && current !== null) {
    const rows = new Set(current.rows);
    if (!rows.delete(row)) rows.add(row);
    return { rows, anchor: row, focus: row };
  }
  return { rows: new Set([row]), anchor: row, focus: row };
}

/**
 * An arrow key. `delta` is how many rows to move; `extend` is Shift held, which stretches the
 * selection from its anchor instead of moving it.
 *
 * From nothing, the first press lands on the first row rather than one step past it — the key was
 * asking to get into the grid, not to move within it.
 */
export function stepRow(
  current: Selection | null,
  delta: number,
  extend: boolean,
  rowCount: number
): Selection | null {
  if (rowCount === 0) return null;
  if (current === null) return { rows: new Set([0]), anchor: 0, focus: 0 };
  const row = clamp(current.focus + delta, rowCount - 1);
  return pickRow(current, row, { extend, toggle: false });
}

/** Every row there is, or nothing when there are none — an empty grid has no row to anchor on. */
export function allRows(rowCount: number): Selection | null {
  if (rowCount === 0) return null;
  return {
    rows: new Set(range(0, rowCount - 1)),
    anchor: 0,
    focus: rowCount - 1,
  };
}

/**
 * The chosen rows as data of their own, in the shape `gridText` takes.
 *
 * The one place view coordinates go back to being rows of the result: `view[r]` is which row the
 * server actually sent, and they come out in the order they are on screen rather than the order
 * they were clicked — a copy of a sorted grid pastes the way the grid looks.
 */
export function cutOut(
  selection: Selection,
  view: number[],
  rows: unknown[][],
  columns: string[]
): { columns: string[]; rows: unknown[][] } {
  const out: unknown[][] = [];
  for (let r = 0; r < view.length; r++) {
    if (!selection.rows.has(r)) continue;
    const row = rows[view[r]];
    if (row !== undefined) out.push(row);
  }
  return { columns, rows: out };
}
