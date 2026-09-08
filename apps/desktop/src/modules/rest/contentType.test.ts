import { describe, expect, it } from "vitest";
import {
  SOURCE_MAX_BYTES,
  availableModes,
  detectBody,
  headerValue,
  pickMode,
} from "./contentType";

const utf8 = (text: string) => new TextEncoder().encode(text);
const raw = (...bytes: number[]) => new Uint8Array(bytes);
const ct = (value: string): [string, string][] => [["Content-Type", value]];

describe("headerValue", () => {
  it("does not care about the case of the name", () => {
    expect(headerValue([["CONTENT-TYPE", "text/plain"]], "content-type")).toBe("text/plain");
  });

  it("answers null when the header is absent", () => {
    expect(headerValue([], "content-type")).toBeNull();
  });

  it("takes the first of a repeated header", () => {
    expect(headerValue([["x", "a"], ["x", "b"]], "x")).toBe("a");
  });
});

describe("detectBody: the header is believed first", () => {
  it("reads application/json as JSON", () => {
    expect(detectBody(ct("application/json"), utf8("{}")).kind).toBe("json");
  });

  it("reads a +json suffix as JSON", () => {
    expect(detectBody(ct("application/problem+json"), utf8("{}")).kind).toBe("json");
  });

  it("reads text/html as HTML", () => {
    expect(detectBody(ct("text/html; charset=utf-8"), utf8("<p>hi</p>")).kind).toBe("html");
  });

  it("reads application/xml as XML", () => {
    expect(detectBody(ct("application/xml"), utf8("<a/>")).kind).toBe("xml");
  });

  it("reads an image by its type alone", () => {
    expect(detectBody(ct("image/png"), raw(1, 2, 3)).kind).toBe("image");
  });

  it("reads a PDF by its type alone", () => {
    expect(detectBody(ct("application/pdf"), raw(1, 2, 3)).kind).toBe("pdf");
  });

  it("reads an unknown type as binary", () => {
    expect(detectBody(ct("application/x-thing"), raw(1, 2, 3)).kind).toBe("binary");
  });

  it("takes the charset from the header", () => {
    expect(detectBody(ct("text/html; charset=iso-8859-1"), utf8("<p>x</p>")).charset).toBe("iso-8859-1");
  });

  it("defaults the charset to utf-8", () => {
    expect(detectBody(ct("text/html"), utf8("<p>x</p>")).charset).toBe("utf-8");
  });

  // A declared text type whose bytes will not decode is binary whatever the header says —
  // otherwise Raw shows replacement characters and calls them the response.
  it("calls a text type binary when the bytes are not readable", () => {
    expect(detectBody(ct("text/html; charset=utf-8"), raw(0xff, 0xfe, 0xff)).kind).toBe("binary");
  });
});

describe("detectBody: the bytes decide when the header will not", () => {
  it("sniffs JSON out of application/octet-stream", () => {
    expect(detectBody(ct("application/octet-stream"), utf8('{"a":1}')).kind).toBe("json");
  });

  it("sniffs JSON out of text/plain", () => {
    expect(detectBody(ct("text/plain"), utf8("  [1,2]  ")).kind).toBe("json");
  });

  it("leaves text/plain as text when it only looks like JSON", () => {
    expect(detectBody(ct("text/plain"), utf8("{not json")).kind).toBe("text");
  });

  it("sniffs HTML by its doctype", () => {
    expect(detectBody([], utf8("<!DOCTYPE html><html></html>")).kind).toBe("html");
  });

  it("sniffs XML by its declaration", () => {
    expect(detectBody([], utf8('<?xml version="1.0"?><a/>')).kind).toBe("xml");
  });

  it("sniffs a PNG by its magic bytes", () => {
    expect(detectBody([], raw(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)).kind).toBe("image");
  });

  it("sniffs a JPEG by its magic bytes", () => {
    expect(detectBody([], raw(0xff, 0xd8, 0xff, 0xe0)).kind).toBe("image");
  });

  it("sniffs a PDF by its magic bytes", () => {
    expect(detectBody(ct("application/octet-stream"), utf8("%PDF-1.7\n")).kind).toBe("pdf");
  });

  it("falls back to binary when nothing decodes", () => {
    expect(detectBody([], raw(0x00, 0xff, 0xfe, 0x01)).kind).toBe("binary");
  });

  it("carries the decoded text for anything readable", () => {
    expect(detectBody(ct("application/json"), utf8('{"a":1}')).text).toBe('{"a":1}');
  });

  it("carries no text for bytes", () => {
    expect(detectBody(ct("image/png"), raw(1, 2, 3)).text).toBeNull();
  });
});

describe("availableModes", () => {
  it("gives JSON all three", () => {
    expect(availableModes("json", 10)).toEqual(["preview", "source", "raw"]);
  });

  it("gives HTML all three", () => {
    expect(availableModes("html", 10)).toEqual(["preview", "source", "raw"]);
  });

  // The spec's own example of the fallback rule: nothing to render, so Preview is not offered.
  it("gives XML a tree and the raw text, and no preview", () => {
    expect(availableModes("xml", 10)).toEqual(["source", "raw"]);
  });

  it("gives plain text only the raw text", () => {
    expect(availableModes("text", 10)).toEqual(["raw"]);
  });

  it("gives an image a preview and a hex dump", () => {
    expect(availableModes("image", 10)).toEqual(["preview", "raw"]);
  });

  it("gives a PDF a card and a hex dump", () => {
    expect(availableModes("pdf", 10)).toEqual(["preview", "raw"]);
  });

  it("gives binary a card and a hex dump", () => {
    expect(availableModes("binary", 10)).toEqual(["preview", "raw"]);
  });

  // The tree is not virtualised, so a body this size would be hundreds of thousands of DOM nodes.
  it("takes the tree away from a body too big to build one for", () => {
    expect(availableModes("json", SOURCE_MAX_BYTES + 1)).toEqual(["preview", "raw"]);
  });

  it("keeps the tree right up to the limit", () => {
    expect(availableModes("json", SOURCE_MAX_BYTES)).toContain("source");
  });

  it("always offers raw", () => {
    const kinds = ["json", "html", "xml", "text", "image", "pdf", "binary"] as const;
    for (const kind of kinds) expect(availableModes(kind, 10)).toContain("raw");
  });
});

describe("pickMode", () => {
  it("keeps what was chosen when it is still on offer", () => {
    expect(pickMode("source", ["preview", "source", "raw"])).toBe("source");
  });

  it("falls to the best available when it is not", () => {
    expect(pickMode("source", ["preview", "raw"])).toBe("preview");
  });

  it("falls all the way to raw when that is all there is", () => {
    expect(pickMode("preview", ["raw"])).toBe("raw");
  });

  // Choosing Source and then getting an image shows Preview, but Source is still what was chosen
  // — the next JSON response goes straight back to it. Nothing slides down and stays down.
  it("does not decide anything, so the choice can come back", () => {
    expect(pickMode("source", ["preview", "source", "raw"])).toBe("source");
    expect(pickMode("source", ["preview", "raw"])).toBe("preview");
    expect(pickMode("source", ["preview", "source", "raw"])).toBe("source");
  });
});
