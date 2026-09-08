import type { ComponentType, ReactNode } from "react";
import type { ShortcutGroup } from "../core/shortcuts";
import type { IconProps } from "../icons";
import type { TranslationKey } from "../i18n";

/**
 * A mark a module wants on its own tab.
 *
 * The shell draws it and nothing more — it does not know what a `kind-mysql` is, only that
 * something asked for that class. This is what keeps the tab bar from growing a branch per module:
 * the two marks a database tab carries were `tab.kind` and `tab.readOnly` up here, and neither
 * meant anything to a REST client or a terminal.
 */
export interface TabBadge {
  /** Distinct within one tab's badges; the shell keys the list on it. */
  id: string;
  icon: ReactNode;
  /** Read aloud. Already translated — the shell does not know the module's i18n namespace. */
  label: string;
  /** Shown on hover. Left out when the mark needs no tooltip of its own. */
  title?: string;
  /** A class the module defines, put on the badge. */
  className?: string;
  /** A class put on the whole tab rather than on this badge — for a mark that colours the tab
   *  itself, the way a read-only connection turns its accent bar amber. */
  tabClassName?: string;
}

export interface ModuleTabProps {
  /** Whether this is the tab on screen. Every tab that has been on screen once stays mounted
   *  behind it, so the panes below need telling which of them a keyboard shortcut is meant for.
   *  (A tab restored from the last session has not been on screen yet and is not mounted at all —
   *  see `shell/session.ts`. Nothing a module writes can tell the difference: its first render is
   *  its first render either way.) */
  active: boolean;
  onTitleChange: (title: string) => void;
  onBadgesChange: (badges: TabBadge[]) => void;
  /**
   * What this module wrote for this tab the last time the app was open, or `undefined`.
   *
   * **Read it once, at mount** — a `useState` initializer — and work from that snapshot. It is a
   * prop rather than an argument only because there is nowhere else to put it: read it reactively
   * and the module overwrites itself the moment it writes. Nothing here can enforce that; it is a
   * rule, and it is in `.agent/conventions/adding-a-module.md` too.
   *
   * Reading once is not the same as acting once. A module whose store still has a file to read
   * waits for it before deciding whether what it is pointing at is gone.
   */
  restored?: unknown;
  /** What to hand back next launch. `undefined` means "forget it", not "unchanged". Must be
   *  called from an event handler, or from an effect that does not depend on this callback: the
   *  shell compares by identity, and the loop that catches otherwise is named in `shell/tabs.ts`.
   *  Ids only — see the spec this came from, linked at the top of `shell/session.ts`. */
  onStateChange: (state: unknown) => void;
}

/** A pane a module adds to the app's Settings dialog. */
export interface ModuleSettingsSection {
  labelKey: TranslationKey;
  Icon: ComponentType<IconProps>;
  Section: ComponentType;
}

/**
 * One thing MixDB can open a tab of.
 *
 * Deliberately without lifecycle hooks or an event bus between modules: a module cleans up in its
 * own `useEffect` and saves through its own store, and inventing a need nobody has yet is how a
 * shell ends up harder to add to than what it was meant to simplify.
 *
 * The one thing it does keep for a module is a single opaque slot per tab — `restored` and
 * `onStateChange` in {@link ModuleTabProps} — so a tab can come back to what it had open. That is
 * not a persistence API: the shell writes the value and hands it back, and has no idea what it is.
 */
export interface ModuleDefinition {
  id: string;
  /** The module's name in the `[+]` menu. */
  labelKey: TranslationKey;
  Icon: ComponentType<IconProps>;
  /** A tab's title when it is first opened, before the module names it. */
  defaultTitleKey: TranslationKey;
  Tab: ComponentType<ModuleTabProps>;
  settings?: ModuleSettingsSection;
  /** The Ctrl/Cmd chords this module's panes answer, for the dispatcher to resolve and for
   *  Settings to list. Contributed exactly the way `settings` is: the shell collects them and
   *  knows nothing about what any of them do. */
  shortcuts?: ShortcutGroup[];
}
