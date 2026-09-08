import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./Tooltip.module.css";

/**
 * A tooltip the app draws itself, rather than the one the browser draws from `title`.
 *
 * The difference is what the text is drawn *with*. A `title` tooltip is browser chrome: it is
 * painted outside the page, in the system's UI font, and no stylesheet reaches it. This one is an
 * element of the page like any other, so it is set in the app's own Fira Code — which matters
 * wherever the text contains something the font itself draws, `->` becoming a single long arrow
 * being the case that brought this into being.
 *
 * The cost of leaving `title` behind is everything the browser was doing for free: the delay before
 * it appears, staying inside the window, and going away again. All three are below.
 */

/** How long the pointer has to rest before it appears. Shorter than the browser's own second-odd
 *  wait — this is asked for by pointing at a small badge, not stumbled upon. */
const DELAY_MS = 350;

/** Between the anchor and the bubble, and between the bubble and the edge of the window. */
const GAP = 6;
const EDGE = 8;

interface Props {
  /** What to say, already translated. */
  text: string;
  /** What the pointer rests on. */
  children: ReactNode;
}

function Tooltip({ text, children }: Props) {
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  /** The pending appearance, so leaving before the wait is up cancels it. */
  const timer = useRef(0);
  const [open, setOpen] = useState(false);
  const id = useId();

  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    // Everything that leaves the tooltip pointing at nothing. Scroll is the one that matters here:
    // the bubble is fixed to the window while the grid under it moves, so a moment later it would
    // be labelling a different column. Captured, or a scroll inside the grid never reaches this.
    const away = () => hide();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("scroll", away, true);
    window.addEventListener("blur", away);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("blur", away);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Measured and placed before the browser paints, so it is never seen anywhere but where it
  // belongs. Written onto the element rather than held in state: this runs after the render that
  // put the bubble on screen, and a second render to move it would be a frame late.
  useLayoutEffect(() => {
    const bubbleEl = bubble.current;
    const anchorEl = anchor.current;
    if (!open || !bubbleEl || !anchorEl) return;
    const at = anchorEl.getBoundingClientRect();
    const box = bubbleEl.getBoundingClientRect();
    // Above by preference — the pointer is below the anchor more often than above it, and a bubble
    // under the pointer is a bubble in the way. Underneath when there is no room up there.
    const above = at.top - box.height - GAP >= EDGE;
    const left = Math.min(
      Math.max(EDGE, at.left + at.width / 2 - box.width / 2),
      Math.max(EDGE, window.innerWidth - box.width - EDGE)
    );
    bubbleEl.style.left = `${Math.round(left)}px`;
    bubbleEl.style.top = `${Math.round(above ? at.top - box.height - GAP : at.bottom + GAP)}px`;
    bubbleEl.style.visibility = "visible";
  }, [open, text]);

  return (
    <>
      <span
        ref={anchor}
        className={styles.anchor}
        // An empty `title` is not a title of nothing — it is what stops the browser from walking up
        // and using an ancestor's. Without it, an anchor inside something that has a `title` of its
        // own draws two tooltips: this one, and the browser's a second later, on top of it. The
        // grid's header cells are exactly that, since each carries its sort hint.
        title=""
        // Described by, not labelled by: what the anchor *is* is its own content — the FK chip
        // reads as "FK" — and this says the rest of it.
        aria-describedby={open ? id : undefined}
        onPointerEnter={() => {
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setOpen(true), DELAY_MS);
        }}
        onPointerLeave={hide}
        // A click on the anchor is a click on whatever is under it — sorting the column, in the
        // one place this is used — and what that does next is worth watching without a bubble
        // over it.
        onPointerDown={hide}
        onFocus={() => setOpen(true)}
        onBlur={hide}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div ref={bubble} id={id} role="tooltip" className={`${styles.bubble} glass`}>
            {text}
          </div>,
          document.body
        )}
    </>
  );
}

export default Tooltip;
