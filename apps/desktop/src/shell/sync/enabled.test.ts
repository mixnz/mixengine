import { describe, expect, it } from "vitest";
import { readEnabled, writeEnabled, type EnabledStorage } from "./enabled";

function memory(value: string | null = null): EnabledStorage & { value: string | null } {
  const store = {
    value,
    getItem: () => store.value,
    setItem: (_key: string, next: string) => void (store.value = next),
  };
  return store;
}

describe("which collections are on", () => {
  it("is none, on a machine that never chose", () => {
    expect(readEnabled(memory())).toEqual(new Set());
  });

  it("is none, when what is stored cannot be read", () => {
    expect(readEnabled(memory("{not json"))).toEqual(new Set());
    expect(readEnabled(memory('{"a":1}'))).toEqual(new Set());
    expect(readEnabled(memory('["connections", 7]'))).toEqual(new Set(["connections"]));
  });

  it("reads back what was written, once each", () => {
    const storage = memory();
    writeEnabled(storage, ["connections", "preferences", "connections"]);
    expect(readEnabled(storage)).toEqual(new Set(["connections", "preferences"]));
  });
});
