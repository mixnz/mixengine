import type { Chord, ShortcutDef, ShortcutGroup } from "./types";

/** A keystroke, already read: the DOM questions are asked once by the dispatcher and answered as
 *  plain flags, so everything below is testable without a browser. */
export interface Press {
  /** Already lower case. */
  key: string;
  shift: boolean;
  alt: boolean;
  /** What `hasPrimaryModifier` said. */
  mod: boolean;
  /** `Ctrl` down and `Cmd` up, asked of every platform rather than of this one. Off a Mac it is
   *  the same answer `mod` gives; on a Mac it is the only way to spell a chord at all for the
   *  handful of keys `Cmd` cannot reach — see {@link Chord.ctrl}. */
  ctrlOnly: boolean;
  /** What `isTextEntry` said. */
  typing: boolean;
}

export type Decision =
  | { do: "run"; id: string }
  | { do: "swallow" }
  | { do: "nothing" };

export interface ShortcutContext {
  /** How many dialogs and menus are up. Anything above zero and the keyboard is theirs. */
  modalDepth: number;
  /** The ids listening right now, **in the order they started listening** — newest last. An array
   *  and not a set: the tie-break below needs that order, and the catalogue cannot supply it. */
  enabled: string[];
}

function chordMatches(chord: Chord, press: Press): boolean {
  return (
    chord.key === press.key &&
    (chord.shift ?? false) === press.shift &&
    (chord.alt ?? false) === press.alt &&
    // Off a Mac the two flags carry the same answer, so nothing already in the catalogue changes
    // meaning by this line existing.
    (chord.ctrl ? press.ctrlOnly : press.mod)
  );
}

/** The chord a def is filed under, or any of the other spellings of it — see `ShortcutDef.alias`. */
function matches(def: ShortcutDef, press: Press): boolean {
  return chordMatches(def.chord, press) || (def.alias?.some((c) => chordMatches(c, press)) ?? false);
}

/**
 * What a keystroke means: run something, take the key off the webview, or let it through.
 *
 * Every rule the app has about shortcuts lives here, and nothing else does — no DOM, no React, no
 * clock. The dispatcher around it is fifteen lines of glue, which is the point: this repo tests
 * pure logic and nothing else, so the logic is what everything worth being wrong about goes into.
 */
export function decide(press: Press, groups: ShortcutGroup[], ctx: ShortcutContext): Decision {
  // Neither modifier down and there is no chord here to find; which of the two counts is then
  // `chordMatches`'s question, one def at a time.
  if (!press.mod && !press.ctrlOnly) return { do: "nothing" };

  const candidates = groups
    .flatMap((group) => group.defs)
    // A list, not a find: two panes may want one chord, and the day they do this is already the
    // place that decides between them rather than a thing to be rewritten.
    .filter((def) => matches(def, press))
    // CodeMirror binds these on the editor itself and gets there first. They are in the catalogue
    // to be listed, not to be dispatched.
    .filter((def) => def.owner !== "editor")
    // Where the user is typing, the field's own editing is left alone — and a chord left alone is
    // left alone completely, swallowing included.
    .filter((def) => !press.typing || def.whenTyping !== "ignore");

  const claimed = new Set(
    candidates
      // A modal decides who *acts*, not what the webview is allowed to have: the keyboard belongs
      // to whatever is on top, but select-all painting the app's chrome blue is no better an answer
      // behind a dialog than in front of one. So this filter is here rather than above.
      .filter((def) => ctx.modalDepth === 0 || def.inModal === true)
      .map((def) => def.id),
  );
  // Ordered by `ctx.enabled`, never by the catalogue: which handler came up last is a fact about
  // the screen, and the catalogue is static data that knows nothing about it.
  const live = ctx.enabled.filter((id) => claimed.has(id));

  if (live.length > 0) {
    if (live.length > 1 && import.meta.env.DEV) {
      console.warn(
        `Shortcut clash: ${live.join(", ")} all answer this chord. Running ${live[live.length - 1]}.`,
      );
    }
    return { do: "run", id: live[live.length - 1] };
  }

  return candidates.some((def) => def.unhandled === "swallow")
    ? { do: "swallow" }
    : { do: "nothing" };
}
