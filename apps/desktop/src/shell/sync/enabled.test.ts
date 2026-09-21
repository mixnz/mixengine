import { describe, expect, it } from "vitest";
import { readEnabled, setEnabled, toggleRow, writeEnabled, type EnabledStorage } from "./enabled";

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

  it("turns one row on or off and leaves the rest", () => {
    const storage = memory('["preferences"]');
    expect(setEnabled(storage, "connections", true)).toEqual(new Set(["connections", "preferences"]));
    expect(setEnabled(storage, "preferences", false)).toEqual(new Set(["connections"]));
  });

  const rows = [{ id: "connections" }, { id: "connection-secrets", belongsTo: "connections" }, { id: "preferences" }];

  it("will not turn a secret row on before the row it belongs to", () => {
    const storage = memory();
    expect(toggleRow(storage, rows, "connection-secrets", true)).toEqual(new Set());
    toggleRow(storage, rows, "connections", true);
    expect(toggleRow(storage, rows, "connection-secrets", true)).toEqual(
      new Set(["connections", "connection-secrets"]),
    );
  });

  it("turns a secret row off with the row it belongs to, and leaves it off after", () => {
    const storage = memory('["connection-secrets", "connections", "preferences"]');
    expect(toggleRow(storage, rows, "connections", false)).toEqual(new Set(["preferences"]));
    expect(toggleRow(storage, rows, "connections", true)).toEqual(new Set(["connections", "preferences"]));
  });
});
