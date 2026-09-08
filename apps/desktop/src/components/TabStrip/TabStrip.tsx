import { useRef, type ButtonHTMLAttributes, type HTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import { useTabSlide } from "./slide";
import { useActiveTabInView, useStripScroll } from "./useStripScroll";
import styles from "./TabStrip.module.css";

/**
 * A strip of tabs: the app's own tab bar, the REST module's open requests, and the strips inside a
 * pane.
 *
 * What is shared here is the drawing, not the behaviour. Which element is selected, what closing
 * one means, whether a tab can be closed at all — every strip answers those differently, and each
 * keeps answering them itself. What none of them should answer differently is what a tab looks
 * like, which is what kept drifting while three files each held their own copy.
 *
 * A tab's contents are children rather than props. The shell puts a connection badge before the
 * name, the REST strip puts the method there, a pane tab is a bare word — passing each of those
 * through a prop would have meant one prop per caller, which is the point at which a shared
 * component costs more than the duplication it replaced.
 *
 * To recolour the open tab's accent bar, set `--tab-accent` on the tab. See `TabStrip.module.css`.
 *
 * **The tabs scroll; what is held at either end does not.** More tabs than room used to mean a
 * scrollbar under the whole strip, the app's own settings button included — so the one control
 * that is there on every screen scrolled away with them. It sits in `leading` now, outside the part
 * that moves: it is an action on the strip rather than a tab on it, and an action you have to go
 * looking for is one that has been mislaid.
 *
 * `trailing` — `[+]` in both strips that have one — moves. A strip whose tabs all fit keeps it
 * where it has always been, a step after the last tab, which is where the eye goes for one more of
 * something. It is only pinned to the right edge once the tabs run past it, which is the one case
 * where trailing the last tab means being off the screen.
 */

interface TabStripProps extends HTMLAttributes<HTMLDivElement> {
  /** `small` is a strip inside a pane. See the note in `TabStrip.module.css`. */
  size?: "normal" | "small";
  /** Held against the left edge, outside the part that scrolls. */
  leading?: ReactNode;
  /** Held against the right edge, outside the part that scrolls. */
  trailing?: ReactNode;
  /** What `useTabReorder().strip` spreads. Named here rather than left to the rest, because it has
   *  to land on the element that actually scrolls — a drag reads `scrollLeft` off it to carry the
   *  strip along when a tab reaches either end. */
  "data-tab-strip"?: string;
}

export function TabStrip({
  size = "normal",
  leading,
  trailing,
  className,
  children,
  "data-tab-strip": dragStrip,
  ...rest
}: TabStripProps) {
  const { t } = useTranslation();
  const classes = [styles.strip, size === "small" && styles.small, className];
  const ref = useRef<HTMLDivElement>(null);
  // Costs one measurement per render and does nothing at all to a strip whose tabs never move —
  // a pane strip carries no `data-tab-id` and so has nothing to measure. See `slide.ts`.
  useTabSlide(ref);
  const { overflowing, atStart, atEnd, scrollBy } = useStripScroll(ref);
  useActiveTabInView(ref);
  return (
    <div className={classes.filter(Boolean).join(" ")} {...rest}>
      {leading}
      {/* Both arrows or neither, and only ever disabled in between: see `useStripScroll.ts`. */}
      {overflowing && (
        <button
          type="button"
          className={styles.arrow}
          disabled={atStart}
          aria-label={t("common.scrollTabsLeft")}
          title={t("common.scrollTabsLeft")}
          onClick={() => scrollBy(-1)}
        >
          <ChevronLeftIcon size={14} />
        </button>
      )}
      {/* `data-hscroll` is read by `core/scroll.ts`, which listens for the wheel on the window and
          would otherwise hand this strip's notches to whatever pane sits behind it. */}
      <div ref={ref} className={styles.scroller} data-hscroll="" data-tab-strip={dragStrip}>
        {children}
        {/* In the scroll box while everything fits, out of it once the tabs overflow.

            Moving it changes what is measured, which is a loop waiting to happen: taking it out of
            the box shrinks what is in the box, and could put the strip back under the line it just
            crossed. It cannot, and the reason is a width: leaving costs the box `trailing`, and
            arriving costs it two arrows. As long as `trailing` is the narrower of the two there is
            no gap between the two thresholds for the strip to sit in and flicker — see the arrow's
            padding in `TabStrip.module.css`, which is what keeps that true. */}
        {!overflowing && trailing}
      </div>
      {overflowing && (
        <button
          type="button"
          className={styles.arrow}
          disabled={atEnd}
          aria-label={t("common.scrollTabsRight")}
          title={t("common.scrollTabsRight")}
          onClick={() => scrollBy(1)}
        >
          <ChevronRightIcon size={14} />
        </button>
      )}
      {overflowing && trailing}
    </div>
  );
}

interface TabProps extends HTMLAttributes<HTMLDivElement> {
  active: boolean;
  /** Given, a close button appears at the end of the tab, and the middle mouse button closes it
   *  too. Omitted, the tab cannot be closed — which is what a pane tab is. */
  onClose?: () => void;
  /** What the close button is called, to anyone reading the screen and to anyone hovering it. */
  closeLabel?: string;
}

/**
 * One tab.
 *
 * A `div` rather than a `button`, because a tab that can be closed carries a button inside it and
 * a button inside a button is not markup a browser will keep. Selection and keyboard are the
 * caller's — pass `role`, `onClick` and `onKeyDown` through as the strip needs them.
 *
 * Middle-click is not: it closes the tab wherever a tab closes at all. It is the same gesture with
 * the same meaning in every strip and in every browser the user already has open, and leaving it
 * to callers is how the app ended up with it on one strip and not the other.
 *
 * A tab that can be dragged into a new place says so through what `useTabReorder` spreads onto it,
 * and is marked `data-dragging` by that hook while it is in hand — see `TabStrip.module.css`.
 */
export function Tab({
  active,
  onClose,
  closeLabel,
  className,
  children,
  onMouseDown,
  onAuxClick,
  ...rest
}: TabProps) {
  const classes = [styles.tab, active && styles.tabActive, className];
  return (
    <div
      className={classes.filter(Boolean).join(" ")}
      /* So the strip can find the open tab and keep it in view without being told which one it is —
         it takes its tabs as children and never looks inside them. See `useActiveTabInView`. */
      data-active={active ? "" : undefined}
      onMouseDown={(e: MouseEvent<HTMLDivElement>) => {
        // Chromium answers a middle press with the autoscroll cursor, which then eats the release
        // this tab is waiting for. Refused here rather than in `onAuxClick`, which comes too late.
        if (e.button === 1 && onClose !== undefined) e.preventDefault();
        onMouseDown?.(e);
      }}
      onAuxClick={(e: MouseEvent<HTMLDivElement>) => {
        if (e.button === 1 && onClose !== undefined) onClose();
        onAuxClick?.(e);
      }}
      {...rest}
    >
      {children}
      {onClose !== undefined && (
        <button
          type="button"
          className={styles.close}
          aria-label={closeLabel}
          title={closeLabel}
          onClick={(e) => {
            // Closing a tab is not selecting it, and the tab is what is listening for the click.
            e.stopPropagation();
            onClose();
          }}
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

/** The tab's name, clipped with an ellipsis when the tab runs out of room. */
export function TabTitle({ children }: { children: ReactNode }) {
  return <span className={styles.title}>{children}</span>;
}

/** An action at the end of the strip — in both strips that have one, `+` for a new tab. */
export function TabAction({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = [styles.action, className];
  return <button type="button" className={classes.filter(Boolean).join(" ")} {...rest} />;
}
