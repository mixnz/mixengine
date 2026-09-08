import { describe, expect, it } from "vitest";
import { buildJsonTree } from "./jsonTree";

describe("buildJsonTree", () => {
  it("makes a leaf of a scalar", () => {
    expect(buildJsonTree(42)).toEqual({
      path: "$",
      label: "$",
      value: "42",
      summary: null,
      children: null,
    });
  });

  it("quotes a string so it cannot be mistaken for a number", () => {
    expect(buildJsonTree("42").value).toBe('"42"');
  });

  it("writes null and the booleans as themselves", () => {
    expect(buildJsonTree(null).value).toBe("null");
    expect(buildJsonTree(true).value).toBe("true");
  });

  it("counts an object's fields on the branch", () => {
    const tree = buildJsonTree({ a: 1, b: 2 });
    expect(tree.summary).toBe("{2}");
    expect(tree.value).toBeNull();
    expect(tree.children?.map((c) => c.label)).toEqual(["a", "b"]);
  });

  it("counts an array's items", () => {
    expect(buildJsonTree([1, 2, 3]).summary).toBe("[3]");
  });

  it("gives every node the path that reaches it", () => {
    const tree = buildJsonTree({ data: { items: [{ id: 7 }] } });
    const id = tree.children![0].children![0].children![0].children![0];
    expect(id.path).toBe("$.data.items[0].id");
  });

  // A key with a dot or a space in it cannot be written with one, so it is written the other way
  // — which matters because the path is what "Copy path" puts on the clipboard.
  it("brackets a key that cannot be written after a dot", () => {
    expect(buildJsonTree({ "content-type": 1 }).children![0].path).toBe('$["content-type"]');
  });

  it("names an array's children by their index", () => {
    expect(buildJsonTree(["a"]).children![0].label).toBe("0");
  });

  it("has nothing under an empty object", () => {
    expect(buildJsonTree({})).toEqual({
      path: "$",
      label: "$",
      value: null,
      summary: "{0}",
      children: [],
    });
  });
});
