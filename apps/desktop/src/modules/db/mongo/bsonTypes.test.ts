import { describe, expect, it } from "vitest";
import {
  CREATABLE_TYPES,
  defaultValueForType,
  isContainerKind,
  isEditableKind,
  isWrapper,
  kindOf,
  type TypedValue,
} from "./bsonTypes";

describe("isWrapper", () => {
  it("recognises a tagged value", () => {
    expect(isWrapper({ $type: "ObjectId", $value: "0".repeat(24) })).toBe(true);
  });

  it("takes an ordinary document that happens to hold those keys as a document", () => {
    // Both keys and a string tag are what makes a wrapper — a subdocument with one of them is
    // still a subdocument, and reading it as a tagged value would lose its other fields.
    expect(isWrapper({ $type: "ObjectId" } as unknown as TypedValue)).toBe(false);
    expect(isWrapper({ $value: 1 } as unknown as TypedValue)).toBe(false);
    expect(isWrapper({ $type: 5, $value: 1 } as unknown as TypedValue)).toBe(false);
  });

  it("is not fooled by null or by an array", () => {
    // `typeof null` is "object", which is the trap this has to sidestep.
    expect(isWrapper(null)).toBe(false);
    expect(isWrapper([])).toBe(false);
  });
});

describe("kindOf", () => {
  it("names the five shapes that pass through as native JSON", () => {
    expect(kindOf(null)).toBe("Null");
    expect(kindOf([])).toBe("Array");
    expect(kindOf("x")).toBe("String");
    expect(kindOf(true)).toBe("Boolean");
    expect(kindOf({ a: 1 })).toBe("Object");
  });

  it("reports a tagged value by its tag", () => {
    expect(kindOf({ $type: "Int64", $value: "9" })).toBe("Int64");
    expect(kindOf({ $type: "Date", $value: "2024-01-01T00:00:00Z" })).toBe("Date");
  });

  it("checks null before typeof, and array before object", () => {
    // Written in the wrong order, `null` reads as an Object and `[]` reads as one too — and the
    // tree then offers to add a key to either.
    expect(kindOf(null)).not.toBe("Object");
    expect(kindOf([1, 2])).not.toBe("Object");
  });
});

describe("isContainerKind", () => {
  it("is true for the two kinds that hold other values", () => {
    expect(isContainerKind("Array")).toBe(true);
    expect(isContainerKind("Object")).toBe(true);
    expect(isContainerKind("Binary")).toBe(false);
    expect(isContainerKind("String")).toBe(false);
  });
});

describe("isEditableKind", () => {
  it("refuses the five that cannot be written back", () => {
    // MinKey/MaxKey/Undefined carry no payload to edit, JavaScriptWithScope's nested scope is out
    // of the inline editor's reach, and DbPointer cannot be reconstructed outside the bson crate
    // — the backend rejects a write of one.
    for (const kind of ["MinKey", "MaxKey", "Undefined", "DbPointer", "JavaScriptWithScope"] as const) {
      expect(isEditableKind(kind), kind).toBe(false);
    }
  });

  it("allows everything else, including the legacy types already in a document", () => {
    for (const kind of ["String", "Object", "ObjectId", "JavaScript", "Symbol"] as const) {
      expect(isEditableKind(kind), kind).toBe(true);
    }
  });
});

describe("CREATABLE_TYPES", () => {
  it("offers nothing the editor would then refuse to edit", () => {
    for (const type of CREATABLE_TYPES) {
      expect(isEditableKind(type), type).toBe(true);
    }
  });

  it("leaves out the legacy types, which stay reachable only where a field already has one", () => {
    expect(CREATABLE_TYPES).not.toContain("JavaScript");
    expect(CREATABLE_TYPES).not.toContain("Symbol");
  });

  it("names each type once", () => {
    expect(new Set(CREATABLE_TYPES).size).toBe(CREATABLE_TYPES.length);
  });
});

describe("defaultValueForType", () => {
  it("gives every offered type a value of that type", () => {
    // The round trip is the point: pick a type from the dropdown and the tree must immediately
    // agree that the value it got is of the type that was picked.
    for (const type of CREATABLE_TYPES) {
      expect(kindOf(defaultValueForType(type)), type).toBe(type);
    }
  });

  it("spells the wide numbers as strings", () => {
    // An Int64 or a Decimal128 does not survive a JSON number, so the wire form is text.
    expect(defaultValueForType("Int64")).toEqual({ $type: "Int64", $value: "0" });
    expect(defaultValueForType("Decimal128")).toEqual({ $type: "Decimal128", $value: "0" });
    // The two that do fit stay numbers.
    expect(defaultValueForType("Int32")).toEqual({ $type: "Int32", $value: 0 });
    expect(defaultValueForType("Double")).toEqual({ $type: "Double", $value: 0 });
  });

  it("gives an ObjectId the 24 hex characters one is", () => {
    const value = defaultValueForType("ObjectId");
    expect(value).toEqual({ $type: "ObjectId", $value: "000000000000000000000000" });
  });

  it("gives a Date a timestamp that parses", () => {
    const value = defaultValueForType("Date") as { $value: string };
    expect(Number.isNaN(Date.parse(value.$value))).toBe(false);
  });

  it("hands back a fresh container each time", () => {
    // Shared between two new fields, editing one would edit the other.
    expect(defaultValueForType("Array")).not.toBe(defaultValueForType("Array"));
    expect(defaultValueForType("Object")).not.toBe(defaultValueForType("Object"));
  });
});
