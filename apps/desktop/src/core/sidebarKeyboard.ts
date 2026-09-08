import { useEffect, useRef, type KeyboardEvent } from "react";
import type { RefObject } from "react";

import type { ItemListHandle } from "../components/ItemList";

/**
 * The keyboard of a sidebar: the search box, and the list under it.
 *
 * Callers want the same thing of it — open a group and the caret is in the box, `↓` hands the
 * keyboard to the list, `↑` off the top row hands it back — and they had it written out twice, which
 * is two places for the same rule to drift apart in. What differs between them is only what the
 * list holds, and that is the caller's own business either way.
 */
export interface SidebarKeyboard {
  /** Goes on the sidebar's search `Input`, which passes it down to the element. */
  searchRef: RefObject<HTMLInputElement | null>;
  /** Goes on the sidebar's `ItemList`, which is what the search box hands the keyboard to. */
  listRef: RefObject<ItemListHandle | null>;
  /** Goes on the search box: `↓` into the list. */
  onSearchKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  /** Goes on the list as `onLeaveTop`: `↑` off the top row, back to the box. */
  focusSearch: () => void;
}

/**
 * Wires that keyboard up for a sidebar whose picker currently reads `selectedGroup` — a database for
 * the SQL and Mongo workspaces, and whatever a later module's sidebar groups its list by.
 *
 * `active` is what keeps the focus-taking to the tab being looked at: a group can be chosen — or
 * arrive with the connection — while this tab is behind another, and every background tab would
 * otherwise pull the keyboard off whatever the user was actually typing into.
 */
export function useSidebarKeyboard(active: boolean, selectedGroup: string): SidebarKeyboard {
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<ItemListHandle>(null);

  /**
   * The group the search box was last focused for — what keeps the focus to the one moment a group
   * is opened, rather than to every render or every return to the tab.
   */
  const focusedGroup = useRef<string | null>(null);

  // A group opened leaves the keyboard in the search box, which is where the next thing the user
  // does with this sidebar starts: type a few letters, then `ArrowDown` into the list.
  useEffect(() => {
    if (selectedGroup === "") {
      // The picker is empty again — a group dropped, or one that stopped being listed. Coming back
      // to the same name later is opening it afresh, and the box is due the keyboard again.
      focusedGroup.current = null;
      return;
    }
    if (!active || focusedGroup.current === selectedGroup) return;
    focusedGroup.current = selectedGroup;
    searchRef.current?.focus();
  }, [active, selectedGroup]);

  /** `ArrowDown` hands the keyboard to the list, where the arrows walk the rows and Enter opens the
   *  one they are on. Nothing on show to walk and the caret stays here. */
  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "ArrowDown" || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    // Mid-composition the arrows belong to the input method: they pick between the candidates it is
    // offering, and taking one to move the focus instead strands a half-typed word in the box.
    if (e.nativeEvent.isComposing) return;
    if (listRef.current?.focusItem()) e.preventDefault();
  }

  function focusSearch() {
    searchRef.current?.focus();
  }

  return { searchRef, listRef, onSearchKeyDown, focusSearch };
}
