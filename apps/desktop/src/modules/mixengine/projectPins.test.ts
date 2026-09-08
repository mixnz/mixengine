import { describe, expect, it } from "vitest";

import { formatPins } from "./projectPins";
import type { ProjectPin } from "./api/types/ProjectPin";

describe("formatPins", () => {
  it("labels a manifest-sourced pin with its path", () => {
    const pins: ProjectPin[] = [
      {
        kind: "php",
        constraint: "8.3",
        source: { from: "manifest", path: "/srv/app/mixengine.toml" },
        resolved: "8.3.12",
      },
    ];
    expect(formatPins(pins)).toEqual([
      {
        kind: "php",
        constraint: "8.3",
        sourceLabel: "manifest",
        sourcePath: "/srv/app/mixengine.toml",
        resolvedVersion: "8.3.12",
        hint: undefined,
      },
    ]);
  });

  it("labels a row-sourced pin with no path", () => {
    const pins: ProjectPin[] = [
      { kind: "node", constraint: "^20", source: { from: "registered" }, resolved: "20.11.0" },
    ];
    const [row] = formatPins(pins);
    expect(row.sourceLabel).toBe("row");
    expect(row.sourcePath).toBeUndefined();
  });

  it("carries the hint when nothing resolves, and does not invent a resolved version", () => {
    const pins: ProjectPin[] = [
      {
        kind: "ruby",
        constraint: "3.4",
        source: { from: "registered" },
        resolved: null,
        hint: "mix runtime install ruby 3.4.1",
      },
    ];
    const [row] = formatPins(pins);
    expect(row.resolvedVersion).toBeUndefined();
    expect(row.hint).toBe("mix runtime install ruby 3.4.1");
  });

  it("keeps the input order and does not drop an empty list", () => {
    expect(formatPins([])).toEqual([]);
  });
});
