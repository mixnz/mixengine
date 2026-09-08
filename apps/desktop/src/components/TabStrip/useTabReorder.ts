import { useEffect, useLayoutEffect, useRef, type MouseEvent, type PointerEvent } from "react";
import { dropTargetAt, type DropSide, type TabBox } from "./reorder";

/**
 * Dragging a tab along its strip.
 *
 * The strip keeps the order; this keeps the drag. A caller says what a move means — `moveTab` for a
 * list of tabs, `moveId` for a list of ids, both in `reorder.ts` — and spreads what comes back onto
 * the strip and onto every tab:
 *
 * ```tsx
 * const reorder = useTabReorder((from, to, side) => setTabs((prev) => moveTab(prev, from, to, side)));
 * ...
 * <TabStrip {...reorder.strip}>
 *   <Tab {...reorder.tab(tab.id)} active={...} onClose={...}>
 * ```
 *
 * **The tab itself is what moves.** HTML5 drag and drop would have been less code — the browser
 * draws the carried thing for free — but what it draws is a snapshot on a layer of its own, which
 * floats out over the whole window, ignores the strip it belongs to, and leaves the real tab sitting
 * greyed out where it started. Pointer events instead: the tab is translated under the pointer,
 * held to the band the tabs stand in, and never stops being the element on the strip.
 *
 * **The move happens as the tab is carried, not when it is let go.** The tab under the pointer is
 * the tab in its new place, so there is no line to draw promising something that has not happened
 * yet. Letting go only ends the drag, and `Escape` does the same: the tabs have already moved and
 * stay moved — they were never anywhere else to be put back to.
 *
 * **Where the tab is decides, not where the pointer is.** It takes a neighbour's place once it is
 * carried past the middle of it — see `dropTargetAt`, which is where the exact line is drawn. The
 * two part company as soon as the tab is up against either end of the strip, and it is the tab the
 * eye is following.
 *
 * A press only becomes a drag after {@link THRESHOLD}, so a tab is still something you can click.
 * Once it has become one it is no longer a click: letting go of a tab that has been carried — a
 * hand's width or four pixels, far enough to move it or not — does not also select it. Every strip
 * in the app opens something when a tab is picked, and a tab put back where it came from was never
 * a request to open it. That is what `onClickCapture` below is for.
 */

/** How far the pointer travels before a press on a tab is a drag rather than a click. */
const THRESHOLD = 4;
/** How long a tab takes to fall back into place once it is let go. Matches `slide.ts`. */
const SETTLE = 140;
/** How close to the end of a strip that scrolls starts carrying the strip along. */
const EDGE = 48;
/** How fast, at the very edge, in pixels a frame. */
const SPEED = 14;

/** One drag, from the press that may become one to the release that ends it. */
interface Held {
  id: string;
  el: HTMLElement;
  strip: HTMLElement;
  /** Where inside the tab it was taken hold of. Fixed for the whole drag — that is what makes the
   *  tab feel held, rather than towed along on a string. */
  grab: number;
  /** How far the tab's left edge may travel: the band the tabs themselves stand in. */
  min: number;
  max: number;
  /** Where the tab's left edge is being *drawn*, in the strip's own content. */
  left: number;
  /** Where the press landed, and where the pointer is now, on the window. */
  startX: number;
  clientX: number;
  /** False until the press has passed `THRESHOLD` and become a drag. */
  dragging: boolean;
  frame: number;
  /** Drops every window listener this drag put up. */
  stop: AbortController;
}

/** What the caller spreads onto the `TabStrip`. */
export interface StripDragProps {
  "data-tab-strip": string;
}

/** What the caller spreads onto each `Tab`. */
export interface TabDragProps {
  "data-tab-id": string;
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  /** Swallows the click a finished drag leaves behind. In the capture phase, which is what stops
   *  it reaching the `onClick` the caller put on the same tab. */
  onClickCapture: (e: MouseEvent<HTMLElement>) => void;
}

export interface TabReorder {
  strip: StripDragProps;
  tab: (id: string) => TabDragProps;
}

export function useTabReorder(
  onMove: (fromId: string, toId: string, side: DropSide) => void,
): TabReorder {
  const held = useRef<Held | null>(null);
  /* Set when a drag ends, cleared by the click it leaves behind — or by the next press, for the
     drags that leave none: a tab let go over the window rather than over itself sends its click to
     whatever the two presses have in common, which is not the tab. Left standing, that would eat
     the next real click on a tab instead of this one's. */
  const dragged = useRef(false);
  /* The listeners below are put up once, when the press lands, and outlive the render that put
     them up. Reported through a ref, so a drag always answers to the current caller. */
  const move = useRef(onMove);
  move.current = onMove;

  /* A move changes the order, which changes where the carried tab is laid out, which changes the
     transform that holds it under the pointer. Recomputed after every render and before the frame
     is painted, so the tab is never drawn anywhere but where it is being held. Runs after
     `useTabSlide`, which is a layout effect one component further in. */
  useLayoutEffect(() => {
    if (held.current !== null && held.current.dragging) draw(held.current);
  });

  /* Unmounting in the middle of a drag — Ctrl+W on the tab being carried — is a release with
     nobody left to hand the tab back to. Aborting the listeners is not enough on its own: `tick`
     asks `held.current` whether to keep going, not the listeners, so it went on booking a frame
     for ever against a strip no longer in the document. There `getBoundingClientRect()` is all
     zeros, `near` is 0 and `over` is `Infinity`; the loop ran a frame at a time for the life of
     the app and held the detached strip in memory with it. */
  useEffect(() => () => void letGo(), []);

  function boxes(strip: HTMLElement): TabBox[] {
    return [...strip.querySelectorAll<HTMLElement>("[data-tab-id]")].map((el) => ({
      id: el.dataset.tabId ?? "",
      left: el.offsetLeft,
      width: el.offsetWidth,
    }));
  }

  function draw(h: Held) {
    h.el.style.transform = `translateX(${h.left - h.el.offsetLeft}px)`;
  }

  /* `offsetLeft` and not a rectangle, on both sides of this: a tab sliding to its new place has a
     rectangle that is still on its way there, and a drag aimed at where a tab is sliding *from*
     never settles. See `slide.ts`. */
  function follow(h: Held) {
    const x = h.clientX - h.strip.getBoundingClientRect().left + h.strip.scrollLeft;
    h.left = Math.min(Math.max(x - h.grab, h.min), h.max);
    draw(h);
    const target = dropTargetAt(h.left, boxes(h.strip), h.id);
    if (target !== null) move.current(h.id, target.id, target.side);
  }

  /* A strip with more tabs than room scrolls, and a tab carried to either end has to be able to go
     further than the window shows. A frame at a time for the life of the drag, not once per
     pointer move: the pointer can come to rest at the edge and the strip must keep going. */
  function tick() {
    const h = held.current;
    if (h === null || !h.dragging) return;
    h.frame = requestAnimationFrame(tick);
    const rect = h.strip.getBoundingClientRect();
    const near = Math.min(EDGE, rect.width / 3);
    const over =
      h.clientX < rect.left + near
        ? (h.clientX - rect.left - near) / near
        : h.clientX > rect.right - near
          ? (h.clientX - rect.right + near) / near
          : 0;
    if (over === 0) return;
    const was = h.strip.scrollLeft;
    h.strip.scrollLeft = was + SPEED * over;
    if (h.strip.scrollLeft !== was) follow(h);
  }

  /** Everything a hold owns, let go of: the window listeners, the frame `tick` has booked, and the
   *  ref that keeps both alive. Hands back what was being held, or null when nothing was. */
  function letGo(): Held | null {
    const h = held.current;
    held.current = null;
    if (h === null) return null;
    h.stop.abort();
    cancelAnimationFrame(h.frame);
    return h;
  }

  function release() {
    const h = letGo();
    if (h === null || !h.dragging) return;
    dragged.current = true;
    h.el.removeAttribute("data-dragging");
    /* Let go a few pixels off its gap, because the pointer was never exactly on one. It falls the
       rest of the way rather than snapping there — the same slide the other tabs have been making
       around it all along. */
    const from = h.left - h.el.offsetLeft;
    h.el.style.transform = "";
    if (from !== 0) {
      h.el.animate([{ transform: `translateX(${from}px)` }, { transform: "translateX(0)" }], {
        duration: SETTLE,
        easing: "ease-out",
      });
    }
  }

  return {
    strip: { "data-tab-strip": "" },

    tab: (id) => ({
      "data-tab-id": id,

      onClickCapture: (e) => {
        if (!dragged.current) return;
        dragged.current = false;
        e.stopPropagation();
      },

      onPointerDown: (e) => {
        /* Ahead of the button check below, so that a press this hook takes no further interest in
           still clears what the last drag left behind. */
        dragged.current = false;
        // The close button is a press of its own, and so is anything else a caller puts in a tab.
        if (e.button !== 0 || (e.target as HTMLElement).closest("button") !== null) return;
        const el = e.currentTarget;
        const strip = el.closest<HTMLElement>("[data-tab-strip]");
        if (strip === null) return;
        const all = boxes(strip);
        const first = all[0];
        const last = all[all.length - 1];
        if (first === undefined || last === undefined) return;
        const x = e.clientX - strip.getBoundingClientRect().left + strip.scrollLeft;
        const h: Held = {
          id,
          el,
          strip,
          grab: x - el.offsetLeft,
          min: first.left,
          max: last.left + last.width - el.offsetWidth,
          left: el.offsetLeft,
          startX: e.clientX,
          clientX: e.clientX,
          dragging: false,
          frame: 0,
          stop: new AbortController(),
        };
        held.current = h;

        /* On the window rather than on the tab, and no pointer capture: React moves the tab's own
           element as the order changes, and an element taken out of the page and put back loses
           the capture along the way. The window is the one thing a drag can hold on to. */
        const { signal } = h.stop;
        window.addEventListener(
          "pointermove",
          (ev) => {
            h.clientX = ev.clientX;
            if (!h.dragging) {
              if (Math.abs(ev.clientX - h.startX) < THRESHOLD) return;
              h.dragging = true;
              /* Whatever was being played on it — a slide from the move before, or the settle of
                 a drag that has only just ended — outranks an inline transform for as long as it
                 runs, and the hand outranks both. */
              for (const animation of h.el.getAnimations()) animation.cancel();
              h.el.setAttribute("data-dragging", "");
              h.frame = requestAnimationFrame(tick);
            }
            follow(h);
          },
          { signal },
        );
        window.addEventListener("pointerup", release, { signal });
        // The webview taking the gesture for itself — a touch that turned into a scroll.
        window.addEventListener("pointercancel", release, { signal });
        window.addEventListener(
          "keydown",
          (ev) => {
            if (ev.key === "Escape") release();
          },
          { signal },
        );
      },
    }),
  };
}
