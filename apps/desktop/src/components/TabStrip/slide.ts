import { useLayoutEffect, useRef, type RefObject } from "react";

/** How long a tab takes to slide to its new place. Long enough to follow, short enough that a drag
 *  across four tabs does not turn into a queue of animations. */
const DURATION = 140;

/**
 * The tabs slide to their new places instead of jumping there.
 *
 * The reorder is live — a tab changes places under the pointer, mid-drag — and a list that snaps
 * into a new order every few pixels is one nobody can follow. So after every render this compares
 * each tab's position with where it was, and plays the difference backwards: the tab is put back
 * where the eye last saw it and animated to where it now is. The layout is never touched, only the
 * paint, which is why nothing here can disagree with the drag going on above it.
 *
 * `offsetLeft` throughout, never a rectangle: `getBoundingClientRect` includes the very transform
 * this is animating, so measuring with it would compare a tab against its own animation.
 *
 * The one tab left out is the one being carried: it is already following the pointer, and a tab
 * animated towards a place it is being held away from would be two things at once. `useTabReorder`
 * marks it and puts it back itself, in a layout effect that runs after this one.
 *
 * Not only for drags — closing a tab slides the ones after it along too.
 */
export function useTabSlide(strip: RefObject<HTMLDivElement | null>) {
  /** Where every tab was at the end of the last render. */
  const previous = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = strip.current;
    if (el === null) return;
    /* A strip on a tab that is not in front is laid out at nothing: the shell hides the panel above
       it with `display: none`, and every tab underneath reports an `offsetLeft` of zero. Measured,
       that would be recorded as a strip whose tabs are all stacked on the left — and the render
       that brings the tab back to the front would then play every one of them sliding out from
       under the first. So a hidden strip is not measured at all: the places its tabs were in when
       it was last on screen are the places it comes back to. */
    if (el.offsetParent === null) return;
    const now = new Map<string, number>();
    for (const tab of el.querySelectorAll<HTMLElement>("[data-tab-id]")) {
      const left = tab.offsetLeft;
      now.set(tab.dataset.tabId ?? "", left);
      const before = previous.current.get(tab.dataset.tabId ?? "");
      // A tab that has only just appeared has nowhere to have come from, and the one in hand is
      // not being moved by the strip. Both still leave their position above, so that the next
      // render measures against where they really are.
      if (before === undefined || before === left || tab.hasAttribute("data-dragging")) continue;
      // Where it is being *drawn* — which is not where it was laid out, if it is still mid-slide
      // from the move before this one. Read before the cancel below, which would zero it.
      const drawn = before + shift(tab);
      for (const animation of tab.getAnimations()) animation.cancel();
      tab.animate(
        [{ transform: `translateX(${drawn - left}px)` }, { transform: "translateX(0)" }],
        { duration: DURATION, easing: "ease-out" },
      );
    }
    previous.current = now;
  });
}

/** How far a tab is currently translated by an animation still running on it. */
function shift(el: HTMLElement): number {
  const { transform } = getComputedStyle(el);
  if (transform === "none" || transform === "") return 0;
  return new DOMMatrixReadOnly(transform).m41;
}
