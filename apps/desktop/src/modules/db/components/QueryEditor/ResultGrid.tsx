import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  displayValue,
  gridStyle,
  measureColumns,
  useVirtualRows,
  widestValues,
} from "../../../../core/virtualRows";
import ContextMenu from "../../../../components/ContextMenu";
import Input from "../../../../components/Input";
import { ChevronDownIcon, ChevronUpIcon } from "../../../../icons";
import { copyText } from "../../../../core/clipboard";
import { errorMessage } from "../../../../core/errors";
import { csvText, jsonText, tsvText } from "../../../../core/gridText";
import { hasPrimaryModifier } from "../../../../core/platform";
import { useTranslation } from "../../../../i18n";
import {
  allRows,
  cutOut,
  pickRow,
  stepRow,
  type Modifiers,
  // Shadows the DOM's own `Selection` inside this file. Nothing here calls `window.getSelection()`,
  // so nothing is lost, and renaming it would leave this the one file that calls it something else.
  type Selection,
} from "./resultSelection";
import { nextSort, viewIndexes, type Sort } from "./resultView";
import CellDialog from "../../../../components/CellDialog";
import styles from "./QueryEditor.module.css";

/** How long a cell value has to be before it is worth a tooltip. Cells are cut off at 320px, which
 * no value this short reaches at the grid's font size. */
const TOOLTIP_FROM = 24;

/** Where handing the browser the whole set stops being the cheap thing to do.
 *
 * Below this the rows are rendered as they always were — the table sizes its own columns, and a
 * few dozen rows cost nothing. Above it the window takes over: a set of five hundred rows across
 * twenty columns is ten thousand cells, and the layout of every one of them is redone from scratch
 * every time the tab is shown again, since a tab behind another one is `display: none` and has no
 * layout to keep. That is the lag: not the scrolling, but the switching. */
const VIRTUAL_FROM = 60;

/** How many rows a result needs before the filter box is worth its place on the strip.
 *
 * Below this the whole set is on the screen or one flick of the wheel away, and a box for narrowing
 * it down is furniture. */
const FIND_FROM = 20;

/**
 * How tall a row of this grid is — stated, never measured. See `virtualRows.ts` for why that
 * distinction is the whole of what makes a window of rows sound.
 *
 * It is 27px because that is what a row here comes to: a 20px line, 3px of padding above and
 * below, and the 1px rule underneath. The stylesheet pins all four — the line height explicitly,
 * so that no glyph in a cell can quietly make a row taller than this says it is.
 *
 * Two shorter than the other three grids, as it was two shorter at 31px against their 33px: this
 * grid pads 3px where they pad 4px, because a result set is read in bulk and the other three are
 * read a row at a time.
 */
export const ROW_HEIGHT = 27;

/** What a cell of this grid spends on itself: 8px of padding either side, and the 1px rule down its
 *  right edge. */
const CELL_CHROME = 17;

/** The band a column is kept inside, chrome included. */
const MIN_COLUMN = 48;
const MAX_COLUMN = 320;

/** The column widths the grid is pinned to, and the total they add up to. */
interface GridLayout {
  /** The `#` column, which holds the last row's number and nothing else ever. */
  numberWidth: number;
  /** One per result column, in order. */
  widths: number[];
  /** What the table is set to, since a fixed layout only obeys the columns when the table itself
   *  has a width of its own to divide. */
  total: number;
}

/**
 * What the sort mark takes on a heading, its margin included.
 *
 * Read off the DOM rather than worked out from the stylesheet, which says it in `em` of a font this
 * file does not know the size of. One measurement covers every column: unlike the data tab's
 * headings, these carry the mark and nothing else, so they all carry the same width.
 */
function markWidth(table: HTMLTableElement): number {
  const mark = table.querySelector<HTMLElement>(`.${styles.sortMark}`);
  if (!mark) return 0;
  const style = getComputedStyle(mark);
  const margins = (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
  // `offsetWidth` is 0 in a tab standing behind another one, which has no layout at all — and a
  // result can perfectly well arrive in one. The stylesheet gives the mark a width of exactly 1em,
  // so the computed font size says the same thing without needing a box; computed margins are
  // already resolved to pixels either way.
  const box = mark.offsetWidth || parseFloat(style.fontSize) || 0;
  return Math.ceil(box + margins);
}

function measureLayout(
  table: HTMLTableElement,
  columns: string[],
  rows: unknown[][]
): GridLayout | null {
  const sizing = { chrome: CELL_CHROME, min: MIN_COLUMN, max: MAX_COLUMN };
  // Every heading is measured with room for its sort mark, whether or not it is the sorted one.
  // A column whose values are wider than its name has that room already; a column named by its
  // own widest string had exactly enough for the name, and the mark pushed the name into an
  // ellipsis — the heading then read `created_at...` with nothing after it to say which way it
  // was sorted.
  const mark = markWidth(table);
  const widths = measureColumns(
    table,
    columns,
    widestValues(rows, columns.length, (row, c) => row[c]),
    sizing,
    columns.map(() => mark)
  );
  if (!widths) return null;
  // Measured on its own and with a floor of nothing: the `#` column holds a row number, and giving
  // it the same floor as a column of real values would waste the width on every result.
  const number = measureColumns(table, ["#"], [[String(rows.length)]], { ...sizing, min: 0 });
  if (!number) return null;
  const numberWidth = number[0];
  return { numberWidth, widths, total: widths.reduce((sum, w) => sum + w, numberWidth) };
}

interface RowProps {
  row: unknown[];
  /** Where this row sits in the result the server sent — which is what the `#` column counts, and
   *  what it goes on counting once the grid is sorted. */
  index: number;
  /** Where it sits in what is on screen. The coordinate the selection speaks in, and the one the
   *  handlers report back. */
  viewRow: number;
  columns: string[];
  /** Whether this row is one of the chosen. A boolean rather than the selection itself: the set of
   *  chosen rows is a new object every time it changes, and one crossing this boundary would be a
   *  memo that never hits. */
  picked: boolean;
  onPick: (viewRow: number, mods: Modifiers) => void;
  onOpen: (viewRow: number, col: number) => void;
  onMenu: (e: ReactMouseEvent, viewRow: number, col: number) => void;
}

/**
 * One row, memoised on the things it is drawn from.
 *
 * Which matters when the window moves: the rows either side of the change keep the same row object,
 * the same index and the same columns, so the whole of the work of a block scrolled past is the new
 * block's rows. Without this, moving the window by sixteen rows rebuilds every cell of all sixty in
 * it — a thousand-odd cells for a change of a few hundred, and the difference is visible in a tall
 * pane like the expanded view.
 */
const ResultRow = memo(function ResultRow({
  row,
  index,
  viewRow,
  columns,
  picked,
  onPick,
  onOpen,
  onMenu,
}: RowProps) {
  return (
    // Marked with where it sits on screen so the keyboard can scroll it into sight while the grid
    // is short enough to size its own rows.
    <tr
      data-view-row={viewRow}
      className={picked ? styles.rowPicked : undefined}
      aria-selected={picked}
    >
      <td className={styles.rowNumber}>{index + 1}</td>
      {columns.map((_, c) => {
        const value = displayValue(row[c]);
        const isNull = row[c] === null || row[c] === undefined;
        return (
          <td
            key={c}
            className={isNull ? styles.cellNull : undefined}
            // Only where the cell can actually be cut short. A result of a thousand rows is tens of
            // thousands of cells, and a tooltip on every one of them is weight the grid carries for
            // nothing.
            title={value.length > TOOLTIP_FROM ? value : undefined}
            onMouseDown={(e) => {
              // Left button only, and preventDefault so a Shift+click extends the grid's rows
              // instead of sweeping up the browser's own text selection across them.
              if (e.button !== 0) return;
              e.preventDefault();
              onPick(viewRow, { extend: e.shiftKey, toggle: hasPrimaryModifier(e) });
            }}
            onDoubleClick={() => onOpen(viewRow, c)}
            onContextMenu={(e) => onMenu(e, viewRow, c)}
          >
            {value}
          </td>
        );
      })}
    </tr>
  );
});

interface Props {
  columns: string[];
  /** Positional, the way the backend sends them — an arbitrary SELECT may name the same column
   *  twice, and only a positional row keeps the two apart. */
  rows: unknown[][];
  /** What this result did, in one line — "1,000 rows" and the like. Handed down rather than worked
   *  out here so that it can share a strip with the filter box instead of taking a line of its own
   *  above it; see `.gridTools` in the stylesheet. */
  summary: string;
}

/**
 * One result set, as a grid that only ever holds the rows you can see.
 *
 * Past {@link VIRTUAL_FROM} rows the tbody is the visible window plus a spacer above and below it,
 * so a set of five hundred rows costs the browser the same as a set of forty. What that buys is not
 * mainly the scrolling — it is everything that makes the whole table lay itself out again: showing
 * the tab after a look at the data, coming back to this connection from another one, dragging the
 * divider, lifting the pane over the window.
 *
 * Below that many rows none of it applies and the table sizes itself, as it used to.
 */
function ResultGrid({ columns, rows, summary }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  /** The measured columns, or null while the table is sizing itself — a small result, or the first
   *  frame of a large one. */
  const [layout, setLayout] = useState<GridLayout | null>(null);

  const { t } = useTranslation();
  const [sort, setSort] = useState<Sort | null>(null);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  /** The cell the dialog is open on, in view coordinates. */
  const [expanded, setExpanded] = useState<{ row: number; col: number } | null>(null);
  /** Where the right-click was, in client coordinates, and which cell it landed on — the menu can
   *  open that one cell, and a selection of whole rows says nothing about which column was under
   *  the pointer. */
  const [menu, setMenu] = useState<{ x: number; y: number; row: number; col: number } | null>(null);
  /** A clipboard the webview refused, said out loud rather than left as a copy that did nothing. */
  const [copyFailed, setCopyFailed] = useState("");

  /** Which rows are on screen and in what order, as indexes into `rows`. See `resultView.ts` for
   *  why this is a list of indexes and never a list of rows. */
  const view = useMemo(() => viewIndexes(rows, sort, query), [rows, sort, query]);

  const total = view.length;
  const virtual = total >= VIRTUAL_FROM;
  const window = useVirtualRows(scrollRef, { total, rowHeight: ROW_HEIGHT, enabled: virtual });

  // Measured before the browser paints, so the first thing shown is already the fixed layout: a
  // frame of self-sized columns followed by a frame of measured ones would be a visible flinch.
  //
  // Measured from `rows`, not from `view`: a column is as wide as the data in it, not as wide as
  // whatever is being looked at. Measuring the view would make the columns twitch under the pointer
  // on every keystroke in the filter box.
  useLayoutEffect(() => {
    if (!virtual) {
      setLayout(null);
      return;
    }
    const table = tableRef.current;
    if (!table) return;
    setLayout(measureLayout(table, columns, rows));
  }, [virtual, columns, rows]);

  // A new result is a new set of rows under the same box, and whatever the last one was scrolled to
  // means nothing to it.
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [columns, rows, sort, query]);

  // A new result is a new set of columns and values, and a needle typed for the last one is very
  // likely to hide all of this one — with the box scrolled out of sight above and no way to tell
  // why the grid is empty.
  useEffect(() => {
    setQuery("");
    setSort(null);
  }, [columns, rows]);

  // Sorting, filtering or a new result moves every row out from under the selection. Keeping the
  // same row numbers would leave it highlighting rows nobody chose — worse than losing it.
  useEffect(() => {
    setSelection(null);
    setExpanded(null);
    setMenu(null);
    setCopyFailed("");
  }, [columns, rows, sort, query]);

  /** Hands the keyboard to the grid, which a click on a cell does not do by itself.
   *
   *  The cells call `preventDefault` on `mousedown` — they have to, or a Shift+click sweeps the
   *  browser's own text selection across the rows instead of choosing them — and moving the focus
   *  is one of the default actions that cancels. Left as it was, `.gridWrap` never took the focus a
   *  click looked like it was giving it, and `Ctrl+A`, `Ctrl+C` and the arrow keys all hung off a
   *  `keydown` that never arrived.
   *
   *  `preventScroll` because this runs mid-click: the row under the pointer is on screen already,
   *  and a scroll box asked for the focus can otherwise jog itself to where it thinks the focus
   *  ought to be. */
  function takeKeyboard() {
    scrollRef.current?.focus({ preventScroll: true });
  }

  // All three take no dependencies, so their identity never changes and the memo on `ResultRow`
  // holds. Which is why each reads the state it needs through a functional update rather than
  // closing over it. `scrollRef` is a ref, so reading it costs them nothing either.
  const onPick = useCallback((viewRow: number, mods: Modifiers) => {
    takeKeyboard();
    setSelection((current) => pickRow(current, viewRow, mods));
  }, []);

  const onOpen = useCallback((viewRow: number, col: number) => {
    setExpanded({ row: viewRow, col });
  }, []);

  const onMenu = useCallback((e: ReactMouseEvent, viewRow: number, col: number) => {
    e.preventDefault();
    // Same as a left click, and for the same reason: the menu is about to leave a selection behind,
    // and Escape or Ctrl+C on it should reach the grid rather than nothing at all.
    takeKeyboard();
    // The row is taken first when the click landed outside the selection, the way the data tab's
    // table does it: every entry in the menu acts on what is highlighted, and a menu acting on rows
    // other than the highlighted ones would be read as acting on the wrong ones. A right click
    // *inside* the selection leaves it alone, which is what makes "copy these forty rows" one
    // gesture.
    setSelection((current) =>
      current !== null && current.rows.has(viewRow)
        ? current
        : { rows: new Set([viewRow]), anchor: viewRow, focus: viewRow }
    );
    setMenu({ x: e.clientX, y: e.clientY, row: viewRow, col });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  /** Puts text on the clipboard, and says so when the webview will not have it — a copy that
   *  quietly did nothing is the one outcome worth interrupting someone over, since they find out by
   *  pasting the wrong thing somewhere else. */
  function copy(text: string) {
    setMenu(null);
    void copyText(text)
      .then(() => setCopyFailed(""))
      .catch((e) => setCopyFailed(errorMessage(t, e)));
  }

  /** The whole result, or the rows chosen out of it — the two things every entry of the menu is one
   *  of.
   *
   *  The whole result goes through `view` rather than straight through `rows`: "copy the whole
   *  result" while something is sorted or filtered means what is on screen, not what the server
   *  sent. */
  function partOf(whole: boolean): { columns: string[]; rows: unknown[][] } {
    if (whole) return { columns, rows: view.map((index) => rows[index]) };
    if (selection === null) return { columns: [], rows: [] };
    return cutOut(selection, view, rows, columns);
  }

  function copyPart(whole: boolean, as: "tsv" | "csv" | "json") {
    const part = partOf(whole);
    if (part.rows.length === 0) return;
    const write = as === "csv" ? csvText : as === "json" ? jsonText : tsvText;
    copy(write(part.columns, part.rows));
  }

  /** Brings a row into sight after the keyboard has moved onto it. Two routes because there are two
   *  kinds of grid: a windowed one has every row pinned to `ROW_HEIGHT`, so where the row is can be
   *  worked out — and it has to be, since the row may not be in the DOM yet. A short one sizes its
   *  own rows, so the element is asked instead. */
  function revealRow(viewRow: number) {
    const box = scrollRef.current;
    if (!box) return;
    if (!virtual) {
      box.querySelector(`[data-view-row="${viewRow}"]`)?.scrollIntoView({ block: "nearest" });
      return;
    }
    const head = box.querySelector("thead")?.clientHeight ?? 0;
    const top = viewRow * ROW_HEIGHT;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + ROW_HEIGHT > box.scrollTop + box.clientHeight - head) {
      box.scrollTop = top + ROW_HEIGHT + head - box.clientHeight;
    }
  }

  /** The grid's keys, and only while the grid holds the keyboard: this hangs off `.gridWrap`, which
   *  takes focus when it is clicked. The SQL editor above keeps every key of its own.
   *
   *  Left and Right are deliberately not here. What is selected is whole rows, so there is nothing
   *  sideways to move onto — and leaving the two keys alone hands them to the scroll box, which is
   *  what a result wider than the pane wants them for anyway. */
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelection(allRows(view.length));
      return;
    }
    if (mod && e.key.toLowerCase() === "c") {
      e.preventDefault();
      copyPart(false, "tsv");
      return;
    }
    if (e.key === "Escape") {
      setSelection(null);
      return;
    }
    const step = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : null;
    if (step === null) return;
    e.preventDefault();
    const next = stepRow(selection, step, e.shiftKey, view.length);
    setSelection(next);
    if (next !== null) revealRow(next.focus);
  }

  const visible = view.slice(window.first, window.last);
  const spacerSpan = columns.length + 1;

  const filtering = query.trim() !== "";
  /** Measured on the whole result, not on what is left after filtering: a box that vanished once it
   *  had done its job would take away the only way to undo it. */
  const showFind = rows.length >= FIND_FROM;

  return (
    <div className={styles.gridBox}>
      {/* One strip, not two. What the result did and the box for narrowing it down are both one
          line of text about the same set of rows, and stacking them spent two lines of a pane whose
          whole job is the rows underneath. While the filter is on, the count stands in for the
          summary rather than joining it — "1,000 rows" beside "12 of 1,000 rows" is the same
          sentence twice. */}
      <div className={styles.gridTools}>
        <span className={styles.resultSummary}>
          {filtering ? t("query.findCount", { n: view.length, m: rows.length }) : summary}
        </span>
        {showFind && (
          <Input
            size="small"
            className={styles.findInput}
            value={query}
            placeholder={t("query.findPlaceholder")}
            aria-label={t("query.findPlaceholder")}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
      </div>
      <div
        className={styles.gridWrap}
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={virtual ? window.onScroll : undefined}
      >
        <table
          ref={tableRef}
          // Rows pinned whenever they are windowed; columns pinned once they have been measured. Two
          // classes because they answer to different conditions — the measuring can fail in a way the
          // windowing cannot, and a windowed grid whose rows were left to size themselves is the one
          // state that must not exist.
          className={[styles.grid, virtual && styles.gridRows, layout && styles.gridFixed]
            .filter(Boolean)
            .join(" ")}
          style={virtual ? gridStyle(ROW_HEIGHT, layout?.total ?? null) : undefined}
        >
          {layout && (
            <colgroup>
              <col style={{ width: layout.numberWidth }} />
              {layout.widths.map((width, c) => (
                <col key={c} style={{ width }} />
              ))}
            </colgroup>
          )}
          <thead>
            <tr>
              <th className={styles.rowNumber}>#</th>
              {columns.map((column, c) => {
                // Keyed by position: an arbitrary SELECT may well name the same column twice, which
                // is also why the rows are positional.
                const active = sort?.column === c ? sort.direction : null;
                const next = nextSort(sort, c);
                return (
                  <th
                    key={c}
                    className={styles.sortable}
                    aria-sort={
                      active === "asc" ? "ascending" : active === "desc" ? "descending" : "none"
                    }
                    title={
                      next === null
                        ? t("query.sortNone")
                        : t(next.direction === "asc" ? "query.sortAsc" : "query.sortDesc", { column })
                    }
                    onClick={() => setSort(next)}
                  >
                    {column}
                    {/* Always there, empty until this is the sorted column — the columns are
                        measured with room for it, and a mark that came and went would move every
                        heading sideways on each click. The same chevrons the data tab's grid marks
                        its sorted column with, so one gesture does not have two vocabularies. */}
                    <span className={styles.sortMark} aria-hidden="true">
                      {active === "asc" ? <ChevronUpIcon /> : null}
                      {active === "desc" ? <ChevronDownIcon /> : null}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {virtual && (
              <tr className={styles.spacer} style={{ height: window.padTop }} aria-hidden="true">
                <td colSpan={spacerSpan} />
              </tr>
            )}
            {visible.map((index, i) => {
              const viewRow = window.first + i;
              return (
                // Keyed by where the row sits in the result rather than by where it sits on screen,
                // so a sort moves the rows about instead of rebuilding every one of them.
                <ResultRow
                  key={index}
                  row={rows[index]}
                  index={index}
                  viewRow={viewRow}
                  columns={columns}
                  picked={selection?.rows.has(viewRow) === true}
                  onPick={onPick}
                  onOpen={onOpen}
                  onMenu={onMenu}
                />
              );
            })}
            {virtual && (
              <tr className={styles.spacer} style={{ height: window.padBottom }} aria-hidden="true">
                <td colSpan={spacerSpan} />
              </tr>
            )}
          </tbody>
        </table>
        {total === 0 && (
          <p className={styles.noRows}>
            {filtering ? t("query.noMatchingRows") : t("query.noRows")}
          </p>
        )}
      </div>
      {/* Under the grid rather than up on the tool strip: a clipboard the webview refused has
          nothing to do with the line that says how many rows came back. */}
      {copyFailed !== "" && (
        <p className={styles.copyFailed} role="alert">
          {copyFailed}
        </p>
      )}
      {menu !== null && (
        <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu}>
          <button
            type="button"
            onClick={() => {
              setExpanded({ row: menu.row, col: menu.col });
              setMenu(null);
            }}
          >
            {t("query.expandCell")}
          </button>
          {/* The three groups the menu is really made of: what to do with the cell under the
              pointer, what to do with the rows that are picked, and what to do with the result as
              a whole. Six copy entries in one run read as one list of six and are chosen from by
              counting; separated, the scope is read before the format. */}
          <div className="context-menu-separator" />
          <button type="button" onClick={() => copyPart(false, "tsv")}>
            {t("query.copySelectionTsv")}
          </button>
          <button type="button" onClick={() => copyPart(false, "csv")}>
            {t("query.copySelectionCsv")}
          </button>
          <button type="button" onClick={() => copyPart(false, "json")}>
            {t("query.copySelectionJson")}
          </button>
          <div className="context-menu-separator" />
          <button type="button" onClick={() => copyPart(true, "tsv")}>
            {t("query.copyAllTsv")}
          </button>
          <button type="button" onClick={() => copyPart(true, "csv")}>
            {t("query.copyAllCsv")}
          </button>
          <button type="button" onClick={() => copyPart(true, "json")}>
            {t("query.copyAllJson")}
          </button>
        </ContextMenu>
      )}
      {expanded !== null && rows[view[expanded.row]] !== undefined && (
        <CellDialog
          column={columns[expanded.col]}
          // The number the `#` column shows for that row, which is its place in the result rather
          // than its place on screen.
          rowNumber={view[expanded.row] + 1}
          value={rows[view[expanded.row]][expanded.col]}
          onClose={() => setExpanded(null)}
        />
      )}
    </div>
  );
}

export default memo(ResultGrid);
