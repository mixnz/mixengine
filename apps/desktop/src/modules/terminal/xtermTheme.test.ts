import { describe, expect, it } from "vitest";
import { searchDecorations, terminalTheme } from "./xtermTheme";

function reader(table: Record<string, string>) {
  return (name: string) => table[name] ?? "";
}

describe("terminalTheme", () => {
  it("fills each slot from its token", () => {
    const theme = terminalTheme(
      reader({
        "--ansi-background": " #0b1017",
        "--ansi-foreground": "#e6eaf0",
        "--ansi-red": "#f08a80",
        "--ansi-bright-cyan": "#93ddd3",
        "--ansi-selection": "rgb(92 203 147 / 0.3)",
      }),
    );
    expect(theme.background).toBe("#0b1017");
    expect(theme.cursorAccent).toBe("#0b1017");
    expect(theme.red).toBe("#f08a80");
    expect(theme.brightCyan).toBe("#93ddd3");
    expect(theme.selectionBackground).toBe("rgb(92 203 147 / 0.3)");
  });

  it("leaves out a slot whose token resolves to nothing, so xterm keeps its default", () => {
    const theme = terminalTheme(reader({ "--ansi-background": "#fff" }));
    expect(theme.background).toBe("#fff");
    expect("foreground" in theme).toBe(false);
  });
});

describe("searchDecorations", () => {
  it("gives the overview ruler the same pair as the matches", () => {
    const decorations = searchDecorations(reader({ "--ansi-match": "a", "--ansi-match-active": "b" }));
    expect(decorations).toEqual({
      matchBackground: "a",
      matchOverviewRuler: "a",
      activeMatchBackground: "b",
      activeMatchColorOverviewRuler: "b",
    });
  });
});
