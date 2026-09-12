/* Captured output is stored exactly as the program wrote it — the log file a bug report carries
   must be the real one. Escape codes are a terminal's business, and there is no terminal on this
   end: a pane that renders them as text prints `[32;1mDONE[39;22m`, the ESC itself being the one
   byte that leaves no mark. So they come off here, on the way to the screen. */

/** `ESC [` … a final byte in `@`–`~`: colour, cursor moves, erasing a line. Nearly all of it. */
const CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;

/** `ESC ]` … terminated by BEL or by `ESC \` — a window title, a hyperlink. Carries text of its
 *  own, so a pattern aimed at the CSI above would leave that text behind as a log line. */
const OSC = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g;

/**
 * One line of captured output with its terminal escape codes taken out.
 *
 * The two families above are what programs actually emit into a pipe — Composer's progress bars,
 * Laravel's `--ansi`, npm's spinners. The single-character escapes (`ESC =`, `ESC ( B`) belong to
 * a terminal being set up rather than to output, and are left alone rather than guessed at.
 */
export function stripAnsi(text: string): string {
  return text.replace(OSC, "").replace(CSI, "");
}
