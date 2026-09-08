export type BsonTypeTag =
  | "ObjectId"
  | "Int32"
  | "Int64"
  | "Double"
  | "Decimal128"
  | "Date"
  | "Binary"
  | "RegExp"
  | "Timestamp"
  | "MinKey"
  | "MaxKey"
  | "JavaScript"
  | "JavaScriptWithScope"
  | "Symbol"
  | "Undefined"
  | "DbPointer";

export interface TypedWrapper {
  $type: BsonTypeTag;
  $value: unknown;
}

export type TypedValue =
  | string
  | number
  | boolean
  | null
  | TypedValue[]
  | { [key: string]: TypedValue }
  | TypedWrapper;

export type TypedDocument = Record<string, TypedValue>;

/** The full set of kinds a value can report via `kindOf` — BSON type tags
 * plus the five shapes that pass through as native JSON untagged. */
export type BsonKind = BsonTypeTag | "String" | "Boolean" | "Null" | "Array" | "Object";

export function isWrapper(v: TypedValue): v is TypedWrapper {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    "$type" in v &&
    "$value" in v &&
    typeof (v as TypedWrapper).$type === "string"
  );
}

export function kindOf(v: TypedValue): BsonKind {
  if (v === null) return "Null";
  if (Array.isArray(v)) return "Array";
  if (typeof v === "string") return "String";
  if (typeof v === "boolean") return "Boolean";
  if (isWrapper(v)) return v.$type;
  return "Object";
}

export function isContainerKind(kind: BsonKind): kind is "Array" | "Object" {
  return kind === "Array" || kind === "Object";
}

// Exotic/deprecated BSON types whose values are shown but never edited in
// place — MinKey/MaxKey/Undefined carry no meaningful payload to edit,
// JavaScriptWithScope's nested scope document is out of scope for the
// inline editor (see plan), and DbPointer can't be reconstructed outside
// the bson crate (its fields are pub(crate)), so the backend rejects writes.
const READ_ONLY_KINDS: ReadonlySet<BsonKind> = new Set([
  "MinKey",
  "MaxKey",
  "Undefined",
  "DbPointer",
  "JavaScriptWithScope",
]);

export function isEditableKind(kind: BsonKind): boolean {
  return !READ_ONLY_KINDS.has(kind);
}

export type CreatableType = "String" | "Boolean" | "Null" | "Array" | "Object" | BsonTypeTag;

/** Types offered by the type-selector dropdown when editing a value or
 * adding a new property/array item. Deliberately excludes the read-only
 * exotic types above, plus JavaScript/Symbol (legacy, rarely authored by
 * hand) — those remain editable only when a field already has that type. */
export const CREATABLE_TYPES: CreatableType[] = [
  "String",
  "Int32",
  "Int64",
  "Double",
  "Decimal128",
  "Boolean",
  "Date",
  "ObjectId",
  "Null",
  "Binary",
  "RegExp",
  "Timestamp",
  "Array",
  "Object",
];

export function defaultValueForType(tag: CreatableType): TypedValue {
  switch (tag) {
    case "String":
      return "";
    case "Boolean":
      return false;
    case "Null":
      return null;
    case "Array":
      return [];
    case "Object":
      return {};
    case "Int32":
      return { $type: "Int32", $value: 0 };
    case "Int64":
      return { $type: "Int64", $value: "0" };
    case "Double":
      return { $type: "Double", $value: 0 };
    case "Decimal128":
      return { $type: "Decimal128", $value: "0" };
    case "Date":
      return { $type: "Date", $value: new Date().toISOString() };
    case "ObjectId":
      return { $type: "ObjectId", $value: "0".repeat(24) };
    case "Binary":
      return { $type: "Binary", $value: { base64: "", subType: 0 } };
    case "RegExp":
      return { $type: "RegExp", $value: { pattern: "", options: "" } };
    case "Timestamp":
      return { $type: "Timestamp", $value: { t: 0, i: 0 } };
    default:
      return null;
  }
}
