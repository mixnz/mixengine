import { useCallback, useLayoutEffect, useRef } from "react";

/** A scroll pane's geometry — three numbers rather than the element itself, so the rule below is
 *  readable in a test without a browser and the caller's only job is reading them off the DOM. */
export interface PaneBox {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

/** How far above its own end a pane may sit and still count as resting on it. scrollTop is
 *  fractional on a scaled display while the two heights are whole numbers, so a pane at its end
 *  reports a pixel or two short of it. Far below a line of text, let alone a wheel notch, so
 *  scrolling up to read is never mistaken for this. */
const SLACK_PX = 4;

/** Whether a pane is at its end — the state that decides if new lines should pull it along. */
export function isAtBottom(pane: PaneBox): boolean {
  return pane.scrollHeight - pane.clientHeight - pane.scrollTop <= SLACK_PX;
}

/**
 * Holds a log pane on its newest line, and lets go the moment the reader scrolls up.
 *
 * `content` is whatever changes when a line arrives — the entry list itself. Spread the result
 * over the scrolling element: `<div {...useTailScroll(entries)}>`.
 */
export function useTailScroll<T extends HTMLElement>(
  content: unknown,
): { ref: (el: T | null) => void; onScroll: () => void } {
  const pane = useRef<T | null>(null);
  const following = useRef(true);

  /* A callback ref rather than an effect on `content`: the pane is mounted by a button — "View
     output" — at a moment when no line has arrived, so an effect keyed on the content would not
     run and the panel would open on the oldest line it holds. */
  const ref = useCallback((el: T | null) => {
    pane.current = el;
    if (!el) return;
    following.current = true;
    el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    const el = pane.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [content]);

  /* Appending lines leaves scrollTop where it was, so this only runs for a scroll somebody asked
     for. Reading the position back rather than remembering who scrolled is what makes the pane
     pick the tail up again on its own once the reader returns to the end. */
  const onScroll = useCallback(() => {
    if (pane.current) following.current = isAtBottom(pane.current);
  }, []);

  return { ref, onScroll };
}
