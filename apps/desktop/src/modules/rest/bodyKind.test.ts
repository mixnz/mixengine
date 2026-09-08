import { describe, expect, it } from "vitest";
import { BODY_CHOICES, bodyChoice, convertBody } from "./bodyKind";
import type { Body } from "./types";

const raw: Body = { kind: "raw", language: "json", text: '{"a":1}' };
const form: Body = {
  kind: "form",
  fields: [{ id: "f1", enabled: true, key: "user", value: "ann" }],
};
const multipart: Body = {
  kind: "multipart",
  fields: [
    { id: "f1", enabled: true, key: "user", value: "ann" },
    { id: "f2", enabled: false, key: "avatar", value: "", file: "/tmp/a.png" },
  ],
};

describe("bodyChoice", () => {
  it("reads a text body as the notation it is written in", () => {
    expect(bodyChoice(raw)).toBe("json");
  });

  it("reads every other body as its kind", () => {
    expect(bodyChoice({ kind: "none" })).toBe("none");
    expect(bodyChoice(multipart)).toBe("multipart");
    expect(bodyChoice({ kind: "binary", filePath: "/tmp/a.bin" })).toBe("binary");
  });

  // `rest-requests.json` may have been written when `html` was an option.
  it("reads a language this version does not know as plain text", () => {
    const stale = { kind: "raw", language: "html", text: "<p>" } as unknown as Body;
    expect(bodyChoice(stale)).toBe("text");
  });
});

describe("convertBody", () => {
  it("offers every kind the editor can make", () => {
    expect(BODY_CHOICES).toEqual([
      "none",
      "json",
      "xml",
      "yaml",
      "text",
      "form",
      "multipart",
      "binary",
    ]);
  });

  it("keeps the text when only the notation changes", () => {
    expect(convertBody(raw, "xml")).toEqual({ kind: "raw", language: "xml", text: '{"a":1}' });
  });

  it("drops the text on the way to None, and comes back empty", () => {
    expect(convertBody(raw, "none")).toEqual({ kind: "none" });
    expect(convertBody({ kind: "none" }, "json")).toEqual({
      kind: "raw",
      language: "json",
      text: "",
    });
  });

  it("carries a form's rows into a multipart body, ticks and all", () => {
    expect(convertBody(form, "multipart")).toEqual({
      kind: "multipart",
      fields: [{ id: "f1", enabled: true, key: "user", value: "ann" }],
    });
  });

  // A form has nowhere to put a file, and losing the row as well as the file would lose the name
  // that was typed. The row stays; only the file goes.
  it("keeps a multipart file row as a plain form row", () => {
    expect(convertBody(multipart, "form")).toEqual({
      kind: "form",
      fields: [
        { id: "f1", enabled: true, key: "user", value: "ann" },
        { id: "f2", enabled: false, key: "avatar", value: "" },
      ],
    });
  });

  it("starts a form empty when there were no rows to carry", () => {
    expect(convertBody(raw, "form")).toEqual({ kind: "form", fields: [] });
  });

  it("keeps a chosen file only while the body stays binary", () => {
    const binary: Body = { kind: "binary", filePath: "/tmp/a.bin" };
    expect(convertBody(binary, "binary")).toEqual(binary);
    expect(convertBody(form, "binary")).toEqual({ kind: "binary", filePath: "" });
  });
});
