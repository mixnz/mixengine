import type { ITheme } from "@xterm/xterm";

/** Reads one custom property off the document, resolved — `getComputedStyle` in the window, a
 *  table in a test. */
export type ReadToken = (name: string) => string;

/** Which `--ansi-*` token each slot of xterm's theme takes. */
const SLOTS: [keyof ITheme, string][] = [
  ["background", "--ansi-background"],
  ["foreground", "--ansi-foreground"],
  ["cursor", "--ansi-cursor"],
  ["cursorAccent", "--ansi-background"],
  ["selectionBackground", "--ansi-selection"],
  ["black", "--ansi-black"],
  ["red", "--ansi-red"],
  ["green", "--ansi-green"],
  ["yellow", "--ansi-yellow"],
  ["blue", "--ansi-blue"],
  ["magenta", "--ansi-magenta"],
  ["cyan", "--ansi-cyan"],
  ["white", "--ansi-white"],
  ["brightBlack", "--ansi-bright-black"],
  ["brightRed", "--ansi-bright-red"],
  ["brightGreen", "--ansi-bright-green"],
  ["brightYellow", "--ansi-bright-yellow"],
  ["brightBlue", "--ansi-bright-blue"],
  ["brightMagenta", "--ansi-bright-magenta"],
  ["brightCyan", "--ansi-bright-cyan"],
  ["brightWhite", "--ansi-bright-white"],
];

/**
 * xterm's theme, taken from the app's tokens.
 *
 * xterm draws on a canvas and cannot resolve a `var()`, so the colours are read out of the
 * stylesheet as values — which also means they are read again whenever the theme or the accent
 * changes (see `TerminalView`). A token that resolves to nothing is left out, and xterm keeps its
 * own default for that slot rather than drawing in an empty colour.
 */
export function terminalTheme(read: ReadToken): ITheme {
  const theme: ITheme = {};
  for (const [slot, token] of SLOTS) {
    const value = read(token).trim();
    if (value !== "") (theme as Record<string, string>)[slot] = value;
  }
  return theme;
}

/** The search addon's four decoration colours, from the two match tokens: a match, and the one the
 *  search is on. The overview ruler takes the same pair, so the marks down the side match. */
export function searchDecorations(read: ReadToken) {
  const match = read("--ansi-match").trim();
  const active = read("--ansi-match-active").trim();
  return {
    matchBackground: match,
    matchOverviewRuler: match,
    activeMatchBackground: active,
    activeMatchColorOverviewRuler: active,
  };
}

/** The reader the window uses: the root element's resolved custom properties. */
export function readDocumentToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name);
}
