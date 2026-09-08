/** Which edge of the tab under the pointer the dragged one would land against. */
export type DropSide = "before" | "after";

/**
 * Moving one tab along a strip, worked out on the list rather than on the strip.
 *
 * Kept away from the drag itself — {@link useTabReorder} is the drag — because every strip stores
 * its order differently: the shell keeps a list of tabs, the REST module keeps a list of ids, and
 * a pane strip has an order that is written down in its own source. What they share is the
 * arithmetic, which is the one part of a reorder that is easy to get subtly wrong.
 *
 * Like the rest of `shell/tabs.ts`, a move that changes nothing hands back **the array it was
 * given** — a drop that lands a tab back where it started must not make React redraw the strip,
 * and must not make the shell write a new session file.
 */

/**
 * Where the lifted tab goes back in, counted in the list it has been lifted *out* of, or `null`
 * when it would land where it already is.
 *
 * The two indices are into the original list, which is why this cannot simply be `to`: removing
 * the tab first shifts everything after it down by one.
 */
function landingIndex(from: number, to: number, side: DropSide): number | null {
  if (from < 0 || to < 0 || from === to) return null;
  // `to` after the removal.
  const target = from < to ? to - 1 : to;
  const at = side === "before" ? target : target + 1;
  return at === from ? null : at;
}

function reorder<T>(items: T[], from: number, to: number, side: DropSide): T[] {
  const at = landingIndex(from, to, side);
  if (at === null) return items;
  const rest = items.filter((_, i) => i !== from);
  return [...rest.slice(0, at), items[from], ...rest.slice(at)];
}

/** The move over a list of ids — what a strip that stores only ids reorders. */
export function moveId(ids: string[], fromId: string, toId: string, side: DropSide): string[] {
  return reorder(ids, ids.indexOf(fromId), ids.indexOf(toId), side);
}

/** The same move over a list of things that carry their own id. */
export function moveTab<T extends { id: string }>(
  tabs: T[],
  fromId: string,
  toId: string,
  side: DropSide,
): T[] {
  const index = (id: string) => tabs.findIndex((t) => t.id === id);
  return reorder(tabs, index(fromId), index(toId), side);
}

/**
 * One tab as the strip is laid out right now: its id, and where it sits.
 *
 * Measured in the strip's own content — `offsetLeft`, not a rectangle on the window. A tab that is
 * mid-slide is being *drawn* somewhere its rectangle would report and its layout box is not, and
 * aiming a drag at where a tab is sliding *from* is how a live reorder starts oscillating.
 */
export interface TabBox {
  id: string;
  left: number;
  width: number;
}

/** A tab to sit against, and which of its edges. `null` is "nowhere worth moving to". */
export interface DropTarget {
  id: string;
  side: DropSide;
}

/**
 * How far past a gap the carried tab has to be taken before it settles into it, as a fraction of
 * the narrower of the two tabs involved.
 *
 * Without it a tab would change places the moment it crossed the line, and a tab that has just
 * changed places would be a hair from changing back — the strip flickering between two orders as
 * the hand shakes. This is the room it has to be brought back through before the move undoes
 * itself, and it is the same room in both directions, which is what makes a move stay made.
 *
 * A sixth, measured against the narrower tab, so that on a strip whose tabs are all one width — the
 * shell's, and most REST strips — a tab moves at exactly two thirds of a tab's travel, which is
 * what this rule was written as before it could deal with tabs of different widths.
 */
const GRIP = 1 / 6;

/**
 * Where the tab being carried belongs, from where it is drawn and the strip as it stands.
 *
 * The strip is read with the carried tab lifted out of it: the others keep their order and their
 * widths for the whole of a drag, so the gaps between them are the one thing in a live reorder
 * that does not move as the answer changes. The carried tab goes in the gap it is nearest — it has
 * left the gap it is in once it is past the middle of the tab beside it, plus {@link GRIP}.
 *
 * Measuring it that way is what makes it hold still. The rule this replaced asked how much of its
 * neighbour the carried tab covered, which is a question whose answer changes the moment the move
 * is made, and two tabs of different widths could not agree on it: a narrow tab can never cover two
 * thirds of a wide one, however far it is dragged, so it would not go past it at all — and a rule
 * lenient enough to let it would have swapped the two back and forth for ever.
 *
 * Measured on the carried tab and not on the pointer: the two part company the moment the tab is
 * up against either end of the strip, and again whenever it is taken hold of near one of its own
 * edges. It is the tab that is being watched.
 *
 * `left` is where the carried tab's left edge is *drawn*, in the strip's own content — the same
 * space as {@link TabBox}. Its width comes from its own box, because the strip goes on laying it
 * out at full size in the place it was lifted from.
 *
 * Hands back `null` when the tab is still in the gap it came from, which is most of a drag. That
 * is also what makes applying the same answer twice harmless: "put `a` after `c`", asked of a
 * strip where `a` is already after `c`, moves nothing. Which matters, because a drag can outrun
 * React by a frame.
 *
 * Numbers rather than elements, so the rule can be read and tested without a DOM.
 */
export function dropTargetAt(left: number, boxes: TabBox[], draggedId: string): DropTarget | null {
  const from = boxes.findIndex((b) => b.id === draggedId);
  // Nothing on the strip is being carried — a drag left over from a tab that has since closed.
  if (from < 0) return null;
  const width = boxes[from].width;
  /* The strip with the carried tab lifted out: everything that was after it closes up by its
     width. The gap the tab would go back into at index `i` starts where `others[i]` does, and
     `from` is the gap it came out of. */
  const others = boxes
    .filter((_, i) => i !== from)
    .map((b, i) => (i < from ? b : { ...b, left: b.left - width }));
  /** The point the carried tab's left edge has to pass to leave the gap on either side of `i`. */
  const past = (i: number, forward: boolean) => {
    const b = others[i];
    const grip = Math.min(width, b.width) * GRIP;
    return b.left + b.width / 2 + (forward ? grip : -grip);
  };
  /* One of these two runs and the other cannot: a tab is either ahead of where it was laid out or
     behind it. Both step a gap at a time, so a drag that outruns a frame and clears two tabs at
     once lands where it is rather than where it was going. */
  let at = from;
  while (at < others.length && left > past(at, true)) at++;
  while (at > 0 && left < past(at - 1, false)) at--;
  if (at === from) return null;
  /* Either way round it is `boxes[at]` that the carried tab sits against — going left, the tab
     whose gap it is taking; going right, the tab it has just cleared, which is one further along
     `boxes` than it is along `others` for exactly that reason. */
  return { id: boxes[at].id, side: at < from ? "before" : "after" };
}
