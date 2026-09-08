/**
 * Which machine the app is running on, and what that makes a keystroke mean.
 *
 * Tauri renders in the host's own webview, so the user agent names the platform. Linux is never
 * tested for: WebKitGTK spells its system several ways (`X11`, `Wayland`, `Linux`), so it is what
 * is left once Windows and macOS have been ruled out.
 *
 * The shortcut modifier is the reason this file exists. `e.ctrlKey || e.metaKey` reads as the
 * generous answer and is the wrong one: it makes `Ctrl+A` select every row on a Mac, where `Ctrl`
 * is the key held to open a context menu, and lets the Windows key stand in for `Ctrl` everywhere
 * else. A chord is either the one the platform writes on its keyboards or it is not the chord —
 * so every shortcut in the app asks {@link hasPrimaryModifier}, and every shortcut the app draws
 * on screen is spelled by {@link shortcutLabel}, from the same answer.
 *
 * A `Cmd` chord on a Mac looks like it should collide with the menu bar Tauri installs for us,
 * where `Cmd+W` closes the window and `Cmd+A` selects all — and it does not, as long as the
 * handler calls `preventDefault`. AppKit offers a key equivalent to the key window's views before
 * the menu bar, WebKit takes it there and hands it to the page, and only an event the page leaves
 * unhandled is re-sent for the menu to claim. So `preventDefault` is what keeps `Cmd+W` on the tab
 * instead of the window; a shortcut that forgets it gets the menu's meaning instead of its own.
 */

/**
 * The user agent, or nothing at all where there is no `navigator` to ask.
 *
 * In the app there always is one — this file only has a platform to name because Tauri renders in
 * the host's webview. The empty case is the test runner: `navigator` became a Node global in 21,
 * so reading it bare threw on the Node 20 CI runs on while passing on a newer Node locally. The
 * flags below are false either way, since `Node.js/24` matches neither name, so nothing about how
 * the tests read changes — they just stop depending on which Node ran them.
 */
const USER_AGENT = globalThis.navigator?.userAgent ?? "";

/** A Mac, where the shortcut modifier is `Cmd` and `Ctrl` belongs to the context menu. */
export const IS_MAC = USER_AGENT.includes("Mac OS X");

/** Windows, asked only about the things that differ from a Unix path or spelling. */
export const IS_WINDOWS = USER_AGENT.includes("Windows");

/**
 * Whether this event is holding the modifier this platform puts its shortcuts under — `Cmd` on a
 * Mac, `Ctrl` everywhere else.
 *
 * The *other* modifier being down is what rules the chord out. On a Mac that keeps `Ctrl+Click`
 * free for the context menu it has always opened, and on Windows it keeps `Win+Ctrl` — which the
 * desktop itself uses to switch between them — out of the app's shortcuts.
 */
export function hasPrimaryModifier(e: Pick<KeyboardEvent, "ctrlKey" | "metaKey">): boolean {
  return IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

/**
 * `Ctrl` down and `Cmd` up, asked of every platform — what a chord marked `ctrl` is held to.
 *
 * Off a Mac this is {@link hasPrimaryModifier} word for word, and that is the point: one flag
 * covers both platforms because on only one of them do they differ. Why any chord would want it
 * rather than the primary modifier is written on `Chord.ctrl`.
 */
export function hasCtrlOnly(e: Pick<KeyboardEvent, "ctrlKey" | "metaKey">): boolean {
  return e.ctrlKey && !e.metaKey;
}

/** The modifier as it is written on the keyboard in front of the user. Exported because a shortcut
 *  drawn one glyph at a time — the `<kbd>` pairs — needs the modifier on its own. */
export const MODIFIER_LABEL = IS_MAC ? "⌘" : "Ctrl";

/**
 * A chord written the way this platform writes one: `⇧⌘F` on a Mac, `Ctrl+Shift+F` elsewhere.
 *
 * The two conventions differ in more than the modifier's name. A Mac writes its chords as symbols
 * with no separator and in a fixed order — `⌃⌥⇧⌘` — while everything else names the keys and joins
 * them with `+`. Spelled by hand at each call site the two would drift apart, and a shortcut
 * written in a tooltip the way no keyboard writes it is one the user has to translate before
 * pressing.
 */
export function shortcutLabel(
  key: string,
  mods: { alt?: boolean; shift?: boolean; ctrl?: boolean } = {},
): string {
  if (IS_MAC) {
    const middle = `${mods.alt ? "⌥" : ""}${mods.shift ? "⇧" : ""}`;
    // `⌃⌥⇧⌘` is the order a Mac writes them in, so the primary glyph sits at whichever end of that
    // it belongs to: `⌃` opens the run and `⌘` closes it.
    return mods.ctrl ? `⌃${middle}${key}` : `${middle}⌘${key}`;
  }
  // Off a Mac there is nothing to choose between: a `ctrl` chord and a primary-modifier chord are
  // both written `Ctrl+…` because both are the same key.
  const parts = ["Ctrl"];
  if (mods.alt) parts.push("Alt");
  if (mods.shift) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

/**
 * A key as this platform writes it on its own keyboards.
 *
 * Only the keys that are not simply their own letter need saying: `T` is `T` everywhere, while a
 * Mac writes `Tab` as `⇥` and everything else spells the word. Here rather than at the call site,
 * so a chord's glyphs all come from the same file as its modifier's.
 */
export function keyLabel(key: string): string {
  if (key === "tab") return IS_MAC ? "⇥" : "Tab";
  return key.toUpperCase();
}
