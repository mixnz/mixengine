import { useLayoutEffect, useRef, useState } from "react";

/** Gap left between the menu and the window edge, so it never sits flush against it. */
const EDGE_MARGIN = 8;

/** Where a menu ended up, once the window has had its say. */
export interface MenuPlacement {
  left: number;
  top: number;
  /** The corner it now hangs from, for the open animation to grow out of the right one. */
  transformOrigin: string;
}

/**
 * Places a menu at the pointer without letting it fall off the window.
 *
 * Below the pointer and to the right of it is the first choice — that is where the hand already
 * is. When the room below runs out the menu flips *above* the pointer rather than merely sliding
 * up, so it never covers the row that was right-clicked; the same either way for right and left.
 * A menu too tall to fit on either side of the pointer is clamped to the window instead, which is
 * the case `max-height` in the stylesheet leaves scrollable.
 */
export function placeContextMenu(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): MenuPlacement {
  const flipUp = y + height + EDGE_MARGIN > viewportHeight && y - height >= EDGE_MARGIN;
  const flipLeft = x + width + EDGE_MARGIN > viewportWidth && x - width >= EDGE_MARGIN;
  return {
    left: clamp(flipLeft ? x - width : x, width, viewportWidth),
    top: clamp(flipUp ? y - height : y, height, viewportHeight),
    transformOrigin: `${flipUp ? "bottom" : "top"} ${flipLeft ? "right" : "left"}`,
  };
}

/** Keeps one edge of the menu inside the window, the near edge winning if both cannot fit. */
function clamp(start: number, size: number, viewport: number): number {
  return Math.max(EDGE_MARGIN, Math.min(start, viewport - size - EDGE_MARGIN));
}

/**
 * The style a `.context-menu` opened at `(x, y)` should carry, and the ref it must be given.
 *
 * The menu is measured only once it is in the document: what it takes up depends on how many
 * entries it has and how long the translated labels are, neither of which the caller knows. The
 * measuring happens in a layout effect, so the corrected position is in place before the browser
 * paints and the menu is never seen at the spot it would have overflowed from.
 */
export function useContextMenuPosition(x: number, y: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<MenuPlacement>({
    left: x,
    top: y,
    transformOrigin: "top left",
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPlacement(
      placeContextMenu(x, y, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight),
    );
  }, [x, y]);

  return { ref, style: placement };
}
