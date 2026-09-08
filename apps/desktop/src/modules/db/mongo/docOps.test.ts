import { describe, expect, it } from "vitest";
import type { TypedValue } from "./bsonTypes";
import { deleteAtPath, getAtPath, renameKeyAtPath, setAtPath } from "./docOps";

const doc = (): TypedValue => ({
  _id: { $type: "ObjectId", $value: "0".repeat(24) },
  name: "ann",
  address: { city: "Hanoi", tags: ["a", "b"] },
});

describe("getAtPath", () => {
  it("walks objects and arrays alike", () => {
    expect(getAtPath(doc(), [])).toEqual(doc());
    expect(getAtPath(doc(), ["name"])).toBe("ann");
    expect(getAtPath(doc(), ["address", "city"])).toBe("Hanoi");
    expect(getAtPath(doc(), ["address", "tags", "1"])).toBe("b");
  });

  it("stops at a value that holds nothing", () => {
    expect(getAtPath(doc(), ["name", "length"])).toBeUndefined();
    expect(getAtPath(doc(), ["nowhere", "deeper"])).toBeUndefined();
    expect(getAtPath(doc(), ["address", "tags", "9"])).toBeUndefined();
  });

  it("does not walk into a tagged value", () => {
    // A wrapper is one value, not a two-key document — `$value` is how it is carried, not a field
    // of it, and letting a path reach in would put the editor inside the wire format.
    expect(getAtPath(doc(), ["_id", "$value"])).toBeUndefined();
  });
});

describe("setAtPath", () => {
  it("writes a value and leaves the rest as it was", () => {
    const next = setAtPath(doc(), ["address", "city"], "Hue");
    expect(getAtPath(next, ["address", "city"])).toBe("Hue");
    expect(getAtPath(next, ["name"])).toBe("ann");
  });

  it("replaces the whole document for an empty path", () => {
    expect(setAtPath(doc(), [], "gone")).toBe("gone");
  });

  it("leaves the original untouched", () => {
    const before = doc();
    setAtPath(before, ["name"], "bob");
    expect(getAtPath(before, ["name"])).toBe("ann");
  });

  it("shares everything outside the branch it changed", () => {
    // What React state updates go by: a changed reference only where something changed. Without
    // this every edit re-renders every row of the document.
    const before = doc() as Record<string, TypedValue>;
    const after = setAtPath(before, ["address", "city"], "Hue") as Record<string, TypedValue>;
    expect(after).not.toBe(before);
    expect(after.address).not.toBe(before.address);
    expect(after._id).toBe(before._id);
  });

  it("creates what is missing along the way", () => {
    const next = setAtPath({}, ["a", "b"], 1);
    expect(next).toEqual({ a: { b: 1 } });
  });

  it("writes through a value that is not a container by replacing it", () => {
    // `name` is a string; asking for `name.first` means the string was the wrong shape, and the
    // alternative to replacing it is refusing an edit the tree already offered.
    expect(setAtPath(doc(), ["name", "first"], "a")).toMatchObject({ name: { first: "a" } });
  });

  it("keeps an array an array", () => {
    const next = setAtPath(doc(), ["address", "tags", "0"], "z");
    expect(getAtPath(next, ["address", "tags"])).toEqual(["z", "b"]);
  });
});

describe("deleteAtPath", () => {
  it("removes an object key outright", () => {
    const next = deleteAtPath(doc(), ["name"]) as Record<string, TypedValue>;
    expect("name" in next).toBe(false);
    expect(next.address).toBeDefined();
  });

  it("splices an array item out rather than leaving a hole", () => {
    // A `null` left behind would be a value the document does not have, and it would come back
    // from the server as one.
    const next = deleteAtPath(doc(), ["address", "tags", "0"]);
    expect(getAtPath(next, ["address", "tags"])).toEqual(["b"]);
  });

  it("removes something nested without disturbing its siblings", () => {
    const next = deleteAtPath(doc(), ["address", "city"]);
    expect(getAtPath(next, ["address"])).toEqual({ tags: ["a", "b"] });
  });

  it("hands the document back untouched when there is nothing to remove", () => {
    const before = doc();
    expect(deleteAtPath(before, [])).toBe(before);
    expect(deleteAtPath("a string", ["x"])).toBe("a string");
  });

  it("leaves the original untouched", () => {
    const before = doc();
    deleteAtPath(before, ["name"]);
    expect(getAtPath(before, ["name"])).toBe("ann");
  });
});

describe("renameKeyAtPath", () => {
  it("moves the field to the end, the way $rename does", () => {
    // MongoDB drops the field and re-inserts it under the new name, so the order the editor shows
    // is the order the server will report back.
    const next = renameKeyAtPath(doc(), ["name"], "fullName") as Record<string, TypedValue>;
    expect(Object.keys(next)).toEqual(["_id", "address", "fullName"]);
    expect(next.fullName).toBe("ann");
  });

  it("renames a nested key without moving its parent", () => {
    const next = renameKeyAtPath(doc(), ["address", "city"], "town") as Record<string, TypedValue>;
    expect(Object.keys(next)).toEqual(["_id", "name", "address"]);
    expect(getAtPath(next, ["address", "town"])).toBe("Hanoi");
  });

  it("has nothing to rename on an array item or an empty path", () => {
    // Array items have no key to rename, so the path's parent must be an object.
    const before = doc();
    expect(renameKeyAtPath(before, [], "x")).toBe(before);
    expect(getAtPath(renameKeyAtPath(before, ["address", "tags", "0"], "x"), ["address", "tags"]))
      .toEqual(["a", "b"]);
  });

  it("leaves the original untouched", () => {
    const before = doc();
    renameKeyAtPath(before, ["name"], "fullName");
    expect(getAtPath(before, ["name"])).toBe("ann");
  });
});
