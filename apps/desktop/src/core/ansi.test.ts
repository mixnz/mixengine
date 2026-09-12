import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi";

describe("stripAnsi", () => {
  it("keeps the word a colour sequence was wrapped around", () => {
    expect(stripAnsi("\x1b[32;1mDONE\x1b[39;22m")).toBe("DONE");
  });

  /* One real line out of `composer install`: Laravel's post-autoload-dump runs
     `artisan package:discover --ansi`, which pads every package name out to the width of the
     terminal it thinks it has with grey dots — one escape pair per dot. */
  it("reads back a line of Laravel's package discovery", () => {
    const dots = "\x1b[90m.\x1b[39m".repeat(3);
    expect(stripAnsi(`  laravel/tinker ${dots} \x1b[32;1mDONE\x1b[39;22m`)).toBe(
      "  laravel/tinker ... DONE",
    );
  });

  /* Not every sequence paints something. A progress bar erases its line and walks the cursor back
     to column one, and those carry no text at all — a colour-only filter would leave them behind. */
  it("strips a sequence that moves the cursor rather than colouring", () => {
    expect(stripAnsi("\x1b[2K\x1b[1Gdownloading")).toBe("downloading");
  });

  /* A program that renames the terminal window writes the new title into the stream itself. There
     is no terminal here to take it, so the title would otherwise be printed as a log line. */
  it("strips a window title a program set on its way past", () => {
    expect(stripAnsi("\x1b]0;composer install\x07done")).toBe("done");
  });

  /* Brackets and a trailing `m` are ordinary things for a log line to contain, and an over-eager
     pattern that ate them would quietly corrupt output nobody coloured. */
  it("leaves a line carrying no escape alone", () => {
    expect(stripAnsi("Warning: items[0] is 12m past due")).toBe("Warning: items[0] is 12m past due");
  });
});
