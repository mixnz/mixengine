import { describe, expect, it } from "vitest";
import { snippetFromSync, snippetToSync } from "./snippetsStore";

const snippet = { id: "s1", title: "Tail", group: "ssh", template: "tail -f {{file}}" } as never;

describe("a cheatsheet snippet in sync", () => {
  it("comes back as it went", () => {
    expect(snippetFromSync(snippetToSync(snippet))).toEqual(snippet);
  });

  it("refuses what the module would refuse from its own file", () => {
    expect(snippetFromSync({ id: "x", data: { title: 1 } })).toBeNull();
  });
});
