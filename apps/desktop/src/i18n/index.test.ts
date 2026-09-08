import { describe, expect, it } from "vitest";
import { resolve } from "./index";
import { EN } from "./dicts";

describe("resolve", () => {
  it("reads a nested key", () => {
    expect(resolve(EN, "common.save")).toBe(EN.common.save);
  });

  it("returns the key itself when the dictionary doesn't have it", () => {
    // Documented behaviour, per .agent/conventions/i18n.md: "An unknown key resolves to the key
    // string itself rather than throwing."
    expect(resolve(EN, "no.such.key" as never)).toBe("no.such.key");
  });

  it("does not throw when key is not a string", () => {
    // The real failure this guards: a Record<SomeUnion, TranslationKey> indexed by a value read
    // from disk (e.g. KIND_LABEL[someUnknownKind], before kindLabel() existed) can return
    // undefined, and undefined ends up here.
    expect(() => resolve(EN, undefined as never)).not.toThrow();
  });
});
