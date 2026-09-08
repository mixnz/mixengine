import { describe, expect, it } from "vitest";
import { MONGO_FILTER_OPERATORS, mergeDocumentFields, mongoOperatorArity } from "./filters";

describe("MONGO_FILTER_OPERATORS", () => {
  it("names each operator once", () => {
    const ids = MONGO_FILTER_OPERATORS.map((op) => op.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries the three questions only a schemaless collection can be asked", () => {
    // "the field isn't there" and "the field is null" are two different questions here, and the
    // SQL set has no way to spell either.
    const ids = MONGO_FILTER_OPERATORS.map((op) => op.id);
    expect(ids).toContain("exists");
    expect(ids).toContain("notExists");
    expect(ids).toContain("type");
  });

  it("has no LIKE, a regex saying the same thing", () => {
    const ids: string[] = MONGO_FILTER_OPERATORS.map((op) => op.id);
    expect(ids).not.toContain("like");
    expect(ids).toContain("regexp");
  });
});

describe("mongoOperatorArity", () => {
  it("reads each operator's value the way the backend will", () => {
    expect(mongoOperatorArity("eq")).toBe("one");
    expect(mongoOperatorArity("in")).toBe("list");
    expect(mongoOperatorArity("notIn")).toBe("list");
    expect(mongoOperatorArity("between")).toBe("pair");
    expect(mongoOperatorArity("notBetween")).toBe("pair");
    for (const none of ["exists", "notExists", "isNull", "isNotNull", "isEmpty", "isNotEmpty"] as const) {
      expect(mongoOperatorArity(none), none).toBe("none");
    }
  });

  it("takes a value for `type`, which names one rather than standing alone", () => {
    expect(mongoOperatorArity("type")).toBe("one");
  });
});

describe("mergeDocumentFields", () => {
  it("seeds the list from the first page", () => {
    const fields = mergeDocumentFields([], [{ _id: 1, name: "ann" }, { _id: 2, age: 30 }]);
    expect(fields).toEqual(["_id", "name", "age"]);
  });

  it("puts _id first, whatever the documents say", () => {
    // It is what a lookup is nearly always by, and the one field every document has.
    expect(mergeDocumentFields([], [{ name: "ann", _id: 1 }])[0]).toBe("_id");
    expect(mergeDocumentFields(["name"], [])[0]).toBe("_id");
  });

  it("only ever adds, and keeps the order fields were first met in", () => {
    // A page that happens not to carry a field says nothing about whether the collection has one,
    // and a list that narrowed itself would take away the very field being filtered on.
    const first = mergeDocumentFields([], [{ _id: 1, name: "ann", age: 30 }]);
    const second = mergeDocumentFields(first, [{ _id: 2, city: "Hanoi" }]);
    expect(second).toEqual(["_id", "name", "age", "city"]);
  });

  it("hands the same list back, identity and all, when a page taught it nothing", () => {
    // The select has no reason to rebuild its options for a page that added no field.
    const known = mergeDocumentFields([], [{ _id: 1, name: "ann" }]);
    expect(mergeDocumentFields(known, [{ _id: 2, name: "bob" }])).toBe(known);
    expect(mergeDocumentFields(known, [])).toBe(known);
  });

  it("rebuilds when the list it was given was missing _id", () => {
    // Not the same list — the answer now leads with `_id`, so returning the old one would drop it.
    const known = ["name"];
    const merged = mergeDocumentFields(known, []);
    expect(merged).not.toBe(known);
    expect(merged).toEqual(["_id", "name"]);
  });
});
