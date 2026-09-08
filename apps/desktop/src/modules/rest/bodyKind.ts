import { RAW_LANGUAGES, rawLanguage } from "./types";
import type { Body, KeyValue, MultipartField, RawLanguage } from "./types";

/**
 * What the body picker is set to, and what changing it means.
 *
 * One picker, not two: a body is either absent, or a string in some notation, or one of the three
 * shapes that are not a string at all. Asking "which kind?" and then "which language?" made the
 * user answer a question whose only real answer was the second one.
 *
 * Pure, and tested, because "what happens to what I typed when I change this" is the part of a
 * picker people find out about by losing something.
 */

export type BodyChoice = "none" | RawLanguage | "form" | "multipart" | "binary";

/** In the order the picker offers them. */
export const BODY_CHOICES: BodyChoice[] = [
  "none",
  ...RAW_LANGUAGES,
  "form",
  "multipart",
  "binary",
];

/** Which choice a body already is. A text body is its notation; everything else is its kind. */
export function bodyChoice(body: Body): BodyChoice {
  return body.kind === "raw" ? rawLanguage(body.language) : body.kind;
}

/** The rows a body has to carry into a table, which is none unless it is already a table. */
function rows(body: Body): MultipartField[] {
  return body.kind === "form" || body.kind === "multipart" ? body.fields : [];
}

/** A row with its file taken off — a form has nowhere to send one. The row itself stays, because
 *  the name typed into it is worth as much as the file was. */
function withoutFile(field: MultipartField): KeyValue {
  return { id: field.id, enabled: field.enabled, key: field.key, value: field.value };
}

/**
 * The body the picker's new setting means, keeping whatever carries across.
 *
 * A change of notation keeps the text: it is the same body, described differently. A form and a
 * multipart body keep each other's rows, since a form field is a part without a file. Nothing else
 * carries — a token is not a filename — so the rest start empty.
 */
export function convertBody(body: Body, choice: BodyChoice): Body {
  switch (choice) {
    case "none":
      return { kind: "none" };
    case "form":
      return { kind: "form", fields: rows(body).map(withoutFile) };
    case "multipart":
      return { kind: "multipart", fields: rows(body) };
    case "binary":
      return { kind: "binary", filePath: body.kind === "binary" ? body.filePath : "" };
    default:
      return { kind: "raw", language: choice, text: body.kind === "raw" ? body.text : "" };
  }
}
