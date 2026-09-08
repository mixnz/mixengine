import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { modalDepth } from "../../../../core/shortcuts";

/** How long the box takes to rise, and to settle back. Coming back is quicker on purpose: going up
 *  is worth watching because it says where the box went, while coming back is only getting out of
 *  the way of the tab underneath. */
const OPEN_MS = 300;
const CLOSE_MS = 190;

/** Fast out of the pane and slow into place — most of the distance is covered in the first quarter
 *  of the time, which is what makes it read as the box being lifted rather than dragged. It is also
 *  what keeps the squashed first frames of the movement too brief to study. */
const RISE = "cubic-bezier(0.16, 1, 0.3, 1)";
const FALL = "cubic-bezier(0.4, 0, 1, 1)";

/** How flat the box is allowed to start. A true FLIP begins at exactly the old rectangle, and for a
 *  results pane dragged down to a sliver that is a scale of 0.1 — a line, not a box, and the first
 *  frames read as a glitch rather than as a movement. */
const MIN_SCALE = 0.25;

/** Whether the machine has been asked for as little movement as possible. Read at the moment it
 *  matters rather than subscribed to: the answer only has to hold for the 300ms it is read for. */
function prefersStillness(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The transform that lays the box back over the hole it left in the tab.
 *
 * A FLIP, and the ordinary one: the box is already laid out at its full size when this is asked
 * for, so the first frame is the *new* box scaled and shifted onto the *old* box's rectangle, and
 * the animation is one uninterrupted run to `none`. Nothing is measured again after it starts, and
 * nothing inside the box is laid out twice — which is the whole reason it can be smooth over a
 * result of a thousand rows.
 *
 * `transform-origin: top left` is what makes the arithmetic this short; the CSS sets it.
 */
function ontoHome(box: HTMLElement, home: DOMRect | null): string {
  const now = box.getBoundingClientRect();
  // Nothing to measure against: the box still rises, just from nowhere in particular.
  if (!home || now.width === 0 || now.height === 0) return "translateY(32px) scale(0.96)";
  const scaleX = Math.max(home.width / now.width, MIN_SCALE);
  const scaleY = Math.max(home.height / now.height, MIN_SCALE);
  return `translate(${home.left - now.left}px, ${home.top - now.top}px) scale(${scaleX}, ${scaleY})`;
}

export interface ResultsZoom {
  /** Whether the box is lifted out of the tab — still true while it is on its way back down, since
   *  it is fixed to the viewport until it lands. Drives the class and the backdrop. */
  zoomed: boolean;
  /** Set for the descent alone, so the backdrop can fade out under the box rather than vanish from
   *  behind it the instant it lands. */
  leaving: boolean;
  open: () => void;
  close: () => void;
}

/**
 * Lifts one box out of the page and over the window, and puts it back.
 *
 * The box is never re-rendered, re-parented or copied — it is the same element throughout, with the
 * same scroll position and the same DOM under it. All that changes is a class that fixes it to the
 * viewport, and a transform that carries it there from where it was standing. That matters for what
 * this is used on: a results pane holding several grids of a thousand rows is thousands of elements
 * whose second copy would cost more than the animation.
 *
 * Escape closes it — unless a dialog or a menu is up, which answers for itself; see the listener
 * below. Anything else that calls {@link ResultsZoom.close} closes it too.
 */
export function useResultsZoom(box: RefObject<HTMLElement | null>): ResultsZoom {
  const [phase, setPhase] = useState<"resting" | "up" | "falling">("resting");
  /** Where the box stood in the tab, taken the moment before it was lifted — and where it is aimed
   *  when it goes back. */
  const home = useRef<DOMRect | null>(null);
  /** Whichever of the two movements is in the air, so the other can call it off rather than run on
   *  top of it. */
  const flight = useRef<Animation | null>(null);

  const open = useCallback(() => {
    if (phase !== "resting") return;
    // Measured here and not in the effect below: by then the class is on and the box has already
    // moved, and what is wanted is where it was standing before it did.
    home.current = box.current?.getBoundingClientRect() ?? null;
    setPhase("up");
  }, [phase, box]);

  // Runs after the class has fixed the box to the viewport and the browser has laid it out at its
  // full size, which is exactly what a FLIP needs: measure last, animate from first.
  useLayoutEffect(() => {
    if (phase !== "up") return;
    const el = box.current;
    if (!el || prefersStillness()) return;
    flight.current = el.animate([{ transform: ontoHome(el, home.current) }, { transform: "none" }], {
      duration: OPEN_MS,
      easing: RISE,
    });
  }, [phase, box]);

  const close = useCallback(() => {
    if (phase !== "up") return;
    const el = box.current;
    if (!el || prefersStillness()) {
      setPhase("resting");
      return;
    }
    setPhase("falling");
    // Before the box is measured for the way down: mid-rise it is wherever the transform has it at
    // this instant, and the descent has to start from where it belongs.
    flight.current?.cancel();
    const back = el.animate([{ transform: "none" }, { transform: ontoHome(el, home.current) }], {
      duration: CLOSE_MS,
      easing: FALL,
      // Held at the far end so the box does not flick back to full size in the frame between the
      // animation ending and the class coming off.
      fill: "forwards",
    });
    flight.current = back;
    const landed = () => setPhase("resting");
    void back.finished.then(landed, landed);
  }, [phase, box]);

  // The held final frame, let go of — but only once the class has come off and the box is back in
  // the tab, which is what a layout effect guarantees: DOM updated, nothing painted yet. Cancelling
  // it in the callback above instead would put a frame of full-size, untransformed box between the
  // two changes.
  useLayoutEffect(() => {
    if (phase !== "resting") return;
    flight.current?.cancel();
    flight.current = null;
  }, [phase]);

  useEffect(() => {
    if (phase !== "up") return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Unless something is over the box in turn. This listener is in the capture phase, so it sees
      // the key before any dialog opened out of the box below it — a cell of a result, expanded —
      // and without this it would put the box away while leaving that dialog standing over the tab
      // it came from. Escape belongs to whatever is on top, and `modalDepth` is what the rest of
      // the app asks to find out whether that is still this.
      if (modalDepth() !== 0) return;
      // Taken from whatever else is listening: nothing is over the box, so Escape is putting it
      // back and doing nothing else.
      e.stopPropagation();
      close();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [phase, close]);

  return { zoomed: phase !== "resting", leaving: phase === "falling", open, close };
}
