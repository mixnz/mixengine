import { describe, expect, it } from "vitest";
import { formatLogMessage } from "./log";

describe("formatLogMessage", () => {
  it("carries an Error's stack, not just its message", () => {
    const err = new Error("boom");
    const line = formatLogMessage("react", err);
    expect(line.startsWith("[react] ")).toBe(true);
    expect(line).toContain("boom");
    // Error.stack always starts with "<Name>: <message>" when there is one — and there is one
    // here: this jsdom-less vitest run is still real V8 (Node), so err.stack exists.
    expect(line).toContain(err.stack ?? err.message);
  });

  it("stringifies a thrown value that isn't an Error", () => {
    expect(formatLogMessage("promise", "just a string")).toBe("[promise] just a string");
  });

  it("appends context on its own line when given one", () => {
    const line = formatLogMessage("react", new Error("boom"), "in <DbTab>");
    expect(line.endsWith("\nin <DbTab>")).toBe(true);
  });

  it("omits the trailing newline when there is no context", () => {
    const line = formatLogMessage("promise", "x");
    expect(line.endsWith("\n")).toBe(false);
  });
});
