import { useEffect } from "react";

/* Windows' WebView2 moves a flat three lines per wheel notch however fast the wheel turns, so
   walking a thousand-row result set means spinning it a hundred times. Notches that arrive in
   quick succession are stretched instead, up to MAX_MULTIPLIER; a pause drops straight back to
   a plain notch, so careful scrolling still lands where the user aimed. */

/** How far a wheel spun flat out can stretch one notch. */
const MAX_MULTIPLIER = 4;
/** What each streaked notch adds to the multiplier. */
const RAMP = 0.35;
/** Notches spaced further apart than this read as deliberate, one-at-a-time scrolling. */
const STREAK_GAP_MS = 130;
/** Fallback wheel-notch size for engines without the legacy wheelDelta below; a notch is 100px
 *  at the Windows default of three lines per notch, a third of that at its smallest setting. */
const MIN_NOTCH = 45;
/** Units a wheel notch is worth in the legacy wheelDelta, whatever that lines setting says. */
const NOTCH_UNITS = 120;
/** How far off a whole tick the count may land once the integer rounding below is undone. */
const TICK_TOLERANCE = 0.05;
/** Time constant of the glide below. Chromium animates its own wheel scrolling, and taking the
 *  notch over means replacing that animation — without it a stretched notch would jump. */
const GLIDE_MS = 55;
/** Distance at which the glide is close enough to snap to the target and stop. */
const SETTLE_PX = 0.5;
/** How far the pane may sit from where the glide left it before something else is scrolling it.
 *  Panes snap their offset to whole device pixels, so a fractional pixel ratio drifts a little. */
const DRIFT_PX = 2;

/** Whether the event came from a wheel rather than a precision touchpad. Chromium puts 120 units
 *  per notch in the legacy wheelDelta however many lines Windows maps a notch to — but divides
 *  that by the device pixel ratio, so at 125% scaling a notch arrives as 96. Undoing the ratio
 *  leaves a whole number of ticks for a wheel, where a touchpad reports the fraction of a tick
 *  the fingers covered. Touchpads keep scrolling natively: their driver already lengthens a fast
 *  flick and adds inertia of its own. */
function isWheelNotch(e: WheelEvent): boolean {
  // Non-standard, so it isn't in the DOM typings, but every Chromium — WebView2 included — has it.
  const units = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
  if (typeof units !== "number" || units === 0) return Math.abs(e.deltaY) >= MIN_NOTCH;

  // wheelDelta is stored as a whole number, so a ratio like 1.75 lands the count just short of one.
  const ticks = Math.abs(units * window.devicePixelRatio) / NOTCH_UNITS;
  return ticks >= 1 - TICK_TOLERANCE && Math.abs(ticks - Math.round(ticks)) < TICK_TOLERANCE;
}

function maxScrollTop(el: HTMLElement): number {
  return Math.max(0, el.scrollHeight - el.clientHeight);
}

/** Whether the pane can still take a notch in this direction. The margin is a whole pixel because
 *  scrollHeight and clientHeight are rounded while the real limit between them is not: a pane can
 *  sit a fraction short of its own reported end, and calling that "room left" would hold the notch
 *  here instead of passing it to the pane behind. */
function hasRoom(el: HTMLElement, delta: number): boolean {
  return delta < 0 ? el.scrollTop > 1 : el.scrollTop < maxScrollTop(el) - 1;
}

/** The pane a notch belongs to: the nearest ancestor that scrolls vertically and still has room
 *  left in that direction, which is how the browser picks one too. Panes marked
 *  `overscroll-behavior` other than `auto` — most of the app's grids and lists — end the search
 *  rather than passing a notch to whatever sits behind them. */
function paneFor(start: EventTarget | null, delta: number): HTMLElement | null {
  let node: Element | null = start instanceof Element ? start : null;
  while (node) {
    if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight) {
      const style = getComputedStyle(node);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        if (hasRoom(node, delta)) return node;
        if (style.overscrollBehaviorY !== "auto") return null;
      }
    }
    node = node.parentElement;
  }
  return null;
}

interface Glide {
  el: HTMLElement;
  /** Where the notches so far have asked the pane to end up. */
  target: number;
  /** The last scrollTop this glide wrote, so a scroll from anywhere else can be spotted. */
  applied: number;
  time: number;
  frame: number;
}

export function useScrollAcceleration(): void {
  useEffect(() => {
    let glide: Glide | null = null;
    let streak = 0;
    let lastNotch = 0;
    let lastDirection = 0;

    function stop() {
      if (glide) cancelAnimationFrame(glide.frame);
      glide = null;
    }

    function step(now: number) {
      if (!glide) return;
      const { el } = glide;

      // Anything else moving the pane — a keyboard scroll, a row scrolled into view, the
      // scrollbar dragged — wins, and this glide is stale the moment it happens.
      if (Math.abs(el.scrollTop - glide.applied) > DRIFT_PX) {
        stop();
        return;
      }

      // Rows loading in underneath change how far there is to go.
      glide.target = Math.min(Math.max(glide.target, 0), maxScrollTop(el));

      const remaining = glide.target - el.scrollTop;
      if (Math.abs(remaining) < SETTLE_PX) {
        el.scrollTop = glide.target;
        stop();
        return;
      }

      // Exponential approach, taken over the real frame time so the glide lasts as long on a
      // 144Hz display as on a 60Hz one.
      const before = el.scrollTop;
      el.scrollTop = before + remaining * (1 - Math.exp(-(now - glide.time) / GLIDE_MS));
      if (el.scrollTop === before) {
        // A pane that won't take the step — one that stopped being scrollable, or a step too
        // small to survive rounding — would otherwise keep this loop running for good.
        el.scrollTop = glide.target;
        stop();
        return;
      }
      glide.applied = el.scrollTop;
      glide.time = now;
      glide.frame = requestAnimationFrame(step);
    }

    function handleWheel(e: WheelEvent) {
      if (e.defaultPrevented) return;
      // Ctrl is zoom, shift is horizontal scrolling, and a line- or page-mode delta isn't in the
      // pixels scrollTop wants. All of them stay with the browser.
      if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
      if (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return;

      const delta = e.deltaY;
      if (e.deltaX !== 0 || delta === 0 || !isWheelNotch(e)) return;

      /* A box that scrolls sideways — a strip of tabs — turns the notch a quarter and takes it
         itself. This listener is on the window in the capture phase, so it sees the notch before
         that box does; without this it would hand it to whatever pane happens to sit behind the
         strip, and the tabs and the pane would both move at once. */
      if (e.target instanceof Element && e.target.closest("[data-hscroll]") !== null) return;

      const pane = paneFor(e.target, delta);
      if (!pane) return;

      const direction = Math.sign(delta);
      const gap = e.timeStamp - lastNotch;
      // Ramping on the gap rather than on the number of notches means a wheel spun flat out
      // reaches full speed in a few notches while a steady, unhurried spin never builds at all.
      streak =
        direction === lastDirection && gap < STREAK_GAP_MS
          ? streak + (1 - gap / STREAK_GAP_MS)
          : 0;
      lastNotch = e.timeStamp;
      lastDirection = direction;

      e.preventDefault();
      const distance = delta * Math.min(1 + streak * RAMP, MAX_MULTIPLIER);

      // Notches land faster than frames do, so they accumulate onto the target the glide is
      // already heading for; starting over from the current position would swallow most of them.
      const continuing =
        glide && glide.el === pane && Math.abs(pane.scrollTop - glide.applied) <= DRIFT_PX;
      if (continuing && glide) {
        glide.target = Math.min(Math.max(glide.target + distance, 0), maxScrollTop(pane));
        return;
      }

      stop();
      glide = {
        el: pane,
        target: Math.min(Math.max(pane.scrollTop + distance, 0), maxScrollTop(pane)),
        applied: pane.scrollTop,
        time: performance.now(),
        frame: 0,
      };
      glide.frame = requestAnimationFrame(step);
    }

    window.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    return () => {
      window.removeEventListener("wheel", handleWheel, { capture: true });
      stop();
    };
  }, []);
}
