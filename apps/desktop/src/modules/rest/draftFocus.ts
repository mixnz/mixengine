import { useEffect, useRef } from "react";

/**
 * The keyboard, kept on the row that typing into the foot of a table just made.
 *
 * Both request tables have an empty row at the foot that is not in the data: typing into it is what
 * adds a row. The box that was typed into is not the box that row is then edited in — the draft is
 * always empty and always at the bottom — so left alone, the caret stays on the draft and the
 * second character starts a *second* row. `owe` names the box the new row will have, and the effect
 * hands it the keyboard the moment it exists.
 *
 * A slot is any string the caller can rebuild for the new row; both tables use `${id}:${column}`.
 */
export function useDraftFocus() {
  const boxes = useRef(new Map<string, HTMLInputElement>());
  const owed = useRef<string | null>(null);

  useEffect(() => {
    const slot = owed.current;
    if (slot === null) return;
    owed.current = null;
    const box = boxes.current.get(slot);
    if (box === undefined) return;
    box.focus();
    // The caret goes after the character that made the row, not before it.
    box.setSelectionRange(box.value.length, box.value.length);
  });

  const bind = (slot: string) => (el: HTMLInputElement | null) => {
    if (el === null) boxes.current.delete(slot);
    else boxes.current.set(slot, el);
  };

  const owe = (slot: string) => {
    owed.current = slot;
  };

  return { bind, owe };
}
