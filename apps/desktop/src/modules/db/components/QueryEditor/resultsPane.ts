import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

/** How tall the results stand when they first arrive. A handful of rows and a header — enough to
 *  see what came back and read some of it, without taking the script off the screen. The Expand
 *  button is there for the times that is not enough. */
const DEFAULT_HEIGHT = 240;

/** The floor for a drag. Below this the pane is shorter than one result's own header and summary,
 *  which is a state nobody is aiming for — they are aiming for closed, and closed is not on offer
 *  while there is something to show. */
export const MIN_HEIGHT = 96;

/** What is kept for the editor no matter how far the divider is dragged up. The script is the point
 *  of the tab; a divider that can bury it is a divider that can strand someone. */
export const MIN_EDITOR = 150;

/** How far one press of an arrow key moves the divider. */
const KEY_STEP = 16;

/**
 * A height kept between its floor and whatever the editor can spare.
 *
 * `room` is what the editor and the pane have between them — the two measured together, not the
 * height of the tab. The difference is the toolbar, the footer bar and the gaps of the column they
 * all sit in: reserving {@link MIN_EDITOR} out of the tab's height leaves the editor those to pay
 * for as well, and since the editor will not shrink past its own `min-height`, what pays instead is
 * the bar at the bottom, pushed off the edge of a tab that does not clip.
 *
 * Nothing measured yet is not the same as no room: before the first layout the answer is whatever
 * was asked for, since clamping against zero would snap the pane to its floor for a frame.
 */
export function fitHeight(next: number, room: number): number {
  const ceiling = room > 0 ? Math.max(MIN_HEIGHT, room - MIN_EDITOR) : Number.POSITIVE_INFINITY;
  return Math.min(Math.max(Math.round(next), MIN_HEIGHT), ceiling);
}

export interface ResultsPane {
  /** The pane's height in pixels — what the slot animates to when the results appear, and what the
   *  divider changes. */
  height: number;
  /** Set for the length of a drag, so the height can follow the pointer exactly instead of chasing
   *  it through a transition. */
  dragging: boolean;
  /** Put away by hand, while there is still a result behind it. Separate from having nothing to
   *  show: the height it was dragged to is kept, and the same button brings it back. */
  shut: boolean;
  /** What the footer's button does. */
  toggle: () => void;
  /** Undoes {@link shut}. Called when a script is sent — a run is a request to see what came back,
   *  and it would land behind a closed pane otherwise. */
  reveal: () => void;
  /** Everything the divider needs. Spread onto it. */
  divider: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  };
}

/**
 * How much room the results are given, and the divider that changes it.
 *
 * The height is the results' rather than the editor's, which is the way round that matches how the
 * tab is used: the editor takes whatever is left, so a tab with nothing to show is all editor, and
 * one showing a result gives up exactly as much of it as the result was asked for.
 *
 * Pointer capture rather than window listeners: once the divider owns the pointer, every move and
 * the release come back to it even when the pointer has run off the top of the app.
 *
 * It is handed the editor pane and the slot, not the tab that holds them: what bounds the pane is
 * the room those two share, and the tab's own height counts a toolbar and a footer bar the divider
 * has no claim on.
 */
export function useResultsPane(
  editor: RefObject<HTMLElement | null>,
  slot: RefObject<HTMLElement | null>
): ResultsPane {
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [dragging, setDragging] = useState(false);
  const [shut, setShut] = useState(false);
  /** Where the pointer was and how tall the pane stood when the drag began. The height is followed
   *  from there rather than from the pointer's position, so grabbing the divider anywhere along its
   *  height does not jump it. */
  const from = useRef({ y: 0, height: 0 });

  /** The room the two of them share, measured at the moment it is asked — the window is resizable
   *  and the answer is different after every resize. Their sum is the same number whichever way the
   *  divider has split it, mid-transition included: the editor takes whatever the pane is not
   *  using, so what one loses the other has. */
  const fit = useCallback(
    (next: number) => {
      const room = (editor.current?.clientHeight ?? 0) + (slot.current?.clientHeight ?? 0);
      return fitHeight(next, room);
    },
    [editor, slot]
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      // Otherwise the drag selects the text either side of the divider as it goes.
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      from.current = { y: e.clientY, height };
      setDragging(true);
    },
    [height]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!dragging) return;
      // Upwards is taller: the divider is the top edge of the pane, so the pane grows by however
      // far the pointer has risen above where it started.
      setHeight(fit(from.current.height + (from.current.y - e.clientY)));
    },
    [dragging, fit]
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!dragging) return;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setDragging(false);
    },
    [dragging]
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>) => {
      const step = e.key === "ArrowUp" ? KEY_STEP : e.key === "ArrowDown" ? -KEY_STEP : 0;
      if (step === 0) return;
      e.preventDefault();
      setHeight((current) => fit(current + step));
    },
    [fit]
  );

  // The divider owns the pointer for the length of the drag, but not the cursor: that is still
  // whatever the pointer happens to be over, which for a divider being dragged is the editor or the
  // results either side of it. Held on the body instead, along with the selection the drag would
  // otherwise sweep up as it crosses them.
  useEffect(() => {
    if (!dragging) return;
    const { style } = document.body;
    const cursor = style.cursor;
    const select = style.userSelect;
    style.cursor = "row-resize";
    style.userSelect = "none";
    return () => {
      style.cursor = cursor;
      style.userSelect = select;
    };
  }, [dragging]);

  // A window dragged shorter can leave the pane taller than the tab it is in, and then the editor
  // above it has nowhere to be. Re-fitting on resize is the only thing that notices.
  useEffect(() => {
    function onResize() {
      setHeight((current) => fit(current));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fit]);

  const toggle = useCallback(() => setShut((current) => !current), []);
  const reveal = useCallback(() => setShut(false), []);

  return {
    height,
    dragging,
    shut,
    toggle,
    reveal,
    divider: { onPointerDown, onPointerMove, onPointerUp, onKeyDown },
  };
}
