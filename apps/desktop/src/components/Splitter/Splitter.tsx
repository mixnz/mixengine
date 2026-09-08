import { useCallback, useEffect, useRef } from "react";
import styles from "./Splitter.module.css";

interface SplitterProps {
  /** Which way the bar runs. `vertical` is a bar between two panes side by side. */
  orientation: "vertical" | "horizontal";
  /** Read aloud; the bar has no text of its own. */
  ariaLabel: string;
  title?: string;
  /** The drag is about to start — the caller records whatever it is about to move from. */
  onDragStart?: () => void;
  /** How far the pointer has come since the drag began, in pixels. Positive is right, or down. */
  onDrag: (delta: number) => void;
  /** The same distance, once, when the button is let go — where a caller persists the result. */
  onDragEnd?: (delta: number) => void;
  onDoubleClick?: () => void;
}

/**
 * The bar between two panes.
 *
 * It reports distances and nothing else: what a pixel of drag means is the caller's, because one
 * divider moves a sidebar in pixels and the next splits a pane by ratio. Listeners go on the
 * document rather than the bar, so a fast drag that outruns the pointer keeps resizing.
 */
function Splitter({
  orientation,
  ariaLabel,
  title,
  onDragStart,
  onDrag,
  onDragEnd,
  onDoubleClick,
}: SplitterProps) {
  /**
   * How to take the current drag's listeners off the document, or null when no drag is running.
   *
   * Held in a ref because the unmount below has to reach it: the listeners are on the document, not
   * on this element, so React takes nothing off on the way out. A pane closed mid-drag — a tab
   * closed, a connection dropped — would otherwise leave a `mousemove` handler calling back into a
   * component that is gone, for as long as the button stays down.
   */
  const stop = useRef<(() => void) | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Otherwise the webview starts a text selection and the panes flicker blue under the drag.
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const distance = (ev: MouseEvent) =>
        orientation === "vertical" ? ev.clientX - startX : ev.clientY - startY;
      onDragStart?.();

      function onMouseMove(ev: MouseEvent) {
        onDrag(distance(ev));
      }
      function onMouseUp(ev: MouseEvent) {
        stop.current?.();
        onDragEnd?.(distance(ev));
      }
      stop.current = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        stop.current = null;
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [orientation, onDrag, onDragEnd, onDragStart],
  );

  /* Only the listeners come off. `onDragEnd` is where a caller writes the new size down, and a
     drag interrupted by the pane disappearing is not a size anybody chose. */
  useEffect(() => () => stop.current?.(), []);

  return (
    <div
      className={`${styles.splitter} ${styles[orientation]}`}
      onMouseDown={handleMouseDown}
      onDoubleClick={onDoubleClick}
      role="separator"
      aria-orientation={orientation}
      aria-label={ariaLabel}
      title={title}
    />
  );
}

export default Splitter;
