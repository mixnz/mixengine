import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import ContextMenu from "../ContextMenu";
import { PinIcon } from "../../icons";
import styles from "./ItemList.module.css";

/** One entry of the menu an item opens on right-click. */
export interface ItemAction {
  /** Distinguishes this entry from the others in the menu. */
  key: string;
  label: string;
  /** Paints the entry as destructive. For actions that lose data, not merely risky ones. */
  danger?: boolean;
  /** Greys the entry out and stops it being chosen. Shown rather than hidden, so what the menu
   * offers stays the same wherever it is opened and the missing one is not read as a bug. */
  disabled?: boolean;
  /** Why it is greyed out, as the entry's tooltip — a disabled entry with no reason is a dead end. */
  disabledHint?: string;
  /** Given the item the menu was opened on — the menu closes first, so this may open a dialog. */
  onSelect: (item: string) => void;
}

/** What a caller can ask of the list from outside it — the search box above it, which is where the
 * keyboard starts and where `ArrowDown` has to hand it over from. */
export interface ItemListHandle {
  /** Moves the keyboard onto a row and answers whether there was one to move to. A caller that is
   * told `false` keeps the keyboard where it is rather than losing it to an empty list. */
  focusItem: () => boolean;
}

interface ItemListProps {
  items: string[];
  selectedItem?: string | null;
  onSelect: (item: string) => void;
  emptyMessage?: string;
  className?: string;
  /** What right-clicking an item offers. Left out, right-click does what it always does. */
  actions?: ItemAction[];
  /**
   * An item held above the list, in reach whatever the list below is filtered down to.
   *
   * It is shown as its own row even when the list is already showing that item: the point of it is
   * that the caller sent the user here, and a row in the middle of a hundred others does not say
   * so. It takes the same menu and the same click as any other item.
   */
  pinnedItem?: string | null;
  /** The pinned row's tooltip — why it is up there, in the caller's own words. */
  pinnedHint?: string;
  /** Where the keyboard goes when `ArrowUp` is pressed on the first row: the way back out of the
   * list, which for both sidebars is the search box the user came down from. Left out, the first
   * row is simply where walking up stops. */
  onLeaveTop?: () => void;
  ref?: React.Ref<ItemListHandle>;
}

/** Stands for the pinned row where a row is named, since it is the one row that has no name of its
 *  own to be told apart by — the item it holds is also down in the list. */
const PINNED_ROW = Symbol("pinned row");

/** Where the menu was opened, and on what. */
interface MenuState {
  item: string;
  x: number;
  y: number;
}

function ItemList({
  items,
  selectedItem,
  onSelect,
  emptyMessage,
  className,
  actions,
  pinnedItem = null,
  pinnedHint,
  onLeaveTop,
  ref,
}: ItemListProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const rootRef = useRef<HTMLDivElement>(null);

  /**
   * Every row on show, in the order they are seen — the pinned one first, since it is drawn above
   * the list.
   *
   * Read out of the DOM rather than counted off `items`, because the pinned row is a second button
   * for a name the list underneath may be showing as well, and the keyboard has to walk both. It is
   * also read afresh on each key rather than kept in state: what is on show changes with the search
   * box above, and a remembered list would be one keystroke out of date.
   */
  const rows = useCallback(
    () => Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>("[data-item-row]") ?? []),
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      focusItem() {
        const buttons = rows();
        if (buttons.length === 0) return false;
        // The selected row rather than the top one: coming down from the search box lands where the
        // user already is, so the arrows carry on from there. Nothing selected — or nothing the
        // search box has left on show — and the first row is where the keyboard arrives.
        const selected = buttons.find((row) => row.dataset.itemRow === "selected");
        (selected ?? buttons[0]).focus();
        return true;
      },
    }),
    [rows],
  );

  /**
   * The arrows over the rows, once the keyboard is in the list. Enter and space are the button's
   * own — a row is a `<button>`, and pressing it is what opens what it names — so nothing here
   * touches them.
   *
   * Walking down stops at the last row rather than wrapping round to the first: the list is come
   * into from the search box above and read downwards, and a jump back to the top reads as the list
   * having scrolled under you. Walking up past the first row leaves the list altogether, which is
   * the way back to that search box.
   */
  function handleKeyDown(e: React.KeyboardEvent) {
    // An open menu holds the keyboard for as long as it is up. The row it was opened over keeps the
    // focus — the webview focuses a button on a right press as readily as on a left one, and the
    // menu takes nothing for itself — so without this the arrows would walk the list behind it while
    // its entries went on acting on the row it was opened over, and Enter would open a table the
    // menu is not about. Escape is the way out. `SqlTable` holds its own menu the same way.
    if (menu !== null) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const buttons = rows();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    // Pressed with the keyboard somewhere that is not a row: the list was read again under it and
    // the focused row went with it, which leaves the keyboard on the body.
    if (index === -1) return;
    e.preventDefault();
    switch (e.key) {
      case "Home":
        buttons[0].focus();
        break;
      case "End":
        buttons[buttons.length - 1].focus();
        break;
      case "ArrowDown":
        buttons[Math.min(index + 1, buttons.length - 1)].focus();
        break;
      case "ArrowUp":
        if (index > 0) buttons[index - 1].focus();
        else onLeaveTop?.();
        break;
    }
  }

  // The list this menu was opened over can be replaced under it — a reload, another database —
  // and an entry then acts on something no longer there. The pinned row is exempt: `items` is what
  // the search box has left of the list, and the whole point of the pin is that it stays in reach
  // outside that. Judged by this list it would look gone the moment the filter no longer matched
  // it, and its menu would be closed by the next render for a table that is still there. Whether
  // the pinned name still exists at all is the caller's to answer — it is the caller that put it
  // up there — and taking the pin down closes the menu with it.
  useEffect(() => {
    setMenu((open) =>
      open && (items.includes(open.item) || open.item === pinnedItem) ? open : null,
    );
  }, [items, pinnedItem]);

  const hasMenu = actions !== undefined && actions.length > 0;

  function openMenu(e: React.MouseEvent, item: string) {
    e.preventDefault();
    setMenu({ item, x: e.clientX, y: e.clientY });
  }

  /**
   * The one row Tab reaches, the way a listbox has one: the selected row, or the first row when
   * nothing is selected. Every other row is a `.focus()` away with the arrows.
   *
   * A column of plain buttons is a Tab stop each, and a database of two hundred tables is then two
   * hundred presses to walk past the sidebar — which is the cost the arrows above were added to
   * take away, and they only take it away if Tab stops charging it. Named rather than counted so
   * the pinned row and the list row for the same table cannot both claim it: {@link PINNED_ROW} is
   * a symbol precisely because a table may itself be called "pinned".
   */
  const firstRow = pinnedItem !== null ? PINNED_ROW : (items[0] ?? null);
  const tabStop: string | typeof PINNED_ROW | null =
    pinnedItem !== null && pinnedItem === selectedItem
      ? PINNED_ROW
      : selectedItem != null && items.includes(selectedItem)
        ? selectedItem
        : firstRow;

  return (
    <div
      ref={rootRef}
      className={`${styles.list}${className ? ` ${className}` : ""}`}
      onKeyDown={handleKeyDown}
    >
      {pinnedItem !== null && (
        <div className={styles.pinned}>
          <button
            type="button"
            title={pinnedHint}
            data-item-row={pinnedItem === selectedItem ? "selected" : ""}
            tabIndex={tabStop === PINNED_ROW ? 0 : -1}
            className={`${styles.item} ${styles.pinnedItem}${
              pinnedItem === selectedItem ? ` ${styles.itemActive}` : ""
            }`}
            onClick={() => onSelect(pinnedItem)}
            onContextMenu={hasMenu ? (e) => openMenu(e, pinnedItem) : undefined}
          >
            <PinIcon size="0.9em" className={styles.pinnedIcon} />
            <span className={styles.pinnedName}>{pinnedItem}</span>
          </button>
        </div>
      )}
      <ul className={styles.items}>
        {items.map((item) => (
          <li key={item}>
            <button
              type="button"
              data-item-row={item === selectedItem ? "selected" : ""}
              tabIndex={tabStop === item ? 0 : -1}
              className={`${styles.item}${item === selectedItem ? ` ${styles.itemActive}` : ""}`}
              onClick={() => onSelect(item)}
              onContextMenu={hasMenu ? (e) => openMenu(e, item) : undefined}
            >
              {item}
            </button>
          </li>
        ))}
        {items.length === 0 && emptyMessage && <li className={`muted ${styles.empty}`}>{emptyMessage}</li>}
      </ul>
      {menu !== null && actions !== undefined && (
        <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu}>
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              className={action.danger ? "context-menu-delete" : undefined}
              disabled={action.disabled}
              title={action.disabled ? action.disabledHint : undefined}
              onClick={() => {
                setMenu(null);
                action.onSelect(menu.item);
              }}
            >
              {action.label}
            </button>
          ))}
        </ContextMenu>
      )}
    </div>
  );
}

export default ItemList;
