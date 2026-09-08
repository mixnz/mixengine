import { describe, expect, it } from "vitest";
import { tokenize, type Token } from "./tokens";

/** The tokens, as `kind:text` pairs, which is short enough to read a whole line of. */
const kinds = (json: string) => tokenize(json).map((token: Token) => `${token.kind}:${token.text}`);

/** What was tokenized has to be exactly what was given — nothing dropped, nothing reordered. */
function covers(json: string) {
  expect(tokenize(json).map((token) => token.text).join("")).toBe(json);
}

describe("tokenize", () => {
  it("covers the whole input, in order", () => {
    // The runs are painted one after another, so anything not claimed by the pattern has to come
    // back as punctuation rather than vanish.
    for (const json of ['{"a": 1}', "[]", "   ", "", '{\n  "a": [1, 2]\n}']) {
      covers(json);
    }
  });

  it("tells a key from a string by the colon after it", () => {
    expect(kinds('{"a": "b"}')).toEqual([
      "punctuation:{",
      'key:"a":',
      "punctuation: ",
      'string:"b"',
      "punctuation:}",
    ]);
  });

  it("does not read a value ending in a colon as a key", () => {
    // The colon is outside the quotes, so a string that merely ends in one is unaffected.
    expect(tokenize('{"a": "b:"}').filter((token) => token.kind === "key")).toHaveLength(1);
  });

  it("claims a string before a number or a keyword can be", () => {
    // Otherwise `"123"` and `"true"` are painted as the values they spell.
    expect(kinds('["123", "true", "null"]')).toEqual([
      "punctuation:[",
      'string:"123"',
      "punctuation:, ",
      'string:"true"',
      "punctuation:, ",
      'string:"null"',
      "punctuation:]",
    ]);
  });

  it("is not fooled by structure inside a string", () => {
    // Safe as a regex only because it runs over `JSON.stringify` output: every string is escaped
    // the one way JSON escapes things, so a `{` inside one can never be read as structure.
    const json = JSON.stringify({ a: '{"b": 1}' });
    covers(json);
    expect(tokenize(json).filter((token) => token.kind === "string")).toHaveLength(1);
  });

  it("reads an escaped quote as part of the string it is in", () => {
    const json = JSON.stringify({ a: 'say "hi"' });
    covers(json);
    const strings = tokenize(json).filter((token) => token.kind === "string");
    expect(strings).toHaveLength(1);
    expect(strings[0].text).toBe('"say \\"hi\\""');
  });

  it("reads a trailing backslash as part of the string too", () => {
    const json = JSON.stringify({ a: "back\\" });
    covers(json);
    expect(tokenize(json).filter((token) => token.kind === "string")).toHaveLength(1);
  });

  it("names the three keywords", () => {
    expect(kinds("[true, false, null]")).toEqual([
      "punctuation:[",
      "keyword:true",
      "punctuation:, ",
      "keyword:false",
      "punctuation:, ",
      "keyword:null",
      "punctuation:]",
    ]);
  });

  it("takes a number in every shape JSON writes one", () => {
    for (const number of ["0", "-1", "1.5", "-1.5", "1e10", "1E-10", "1.5e+3"]) {
      const [token] = tokenize(number);
      expect(token, number).toEqual({ text: number, kind: "number" });
    }
  });

  it("keeps the indentation, which is what makes the output pretty-printed", () => {
    const json = JSON.stringify({ a: 1 }, null, 2);
    covers(json);
    expect(tokenize(json).some((token) => token.kind === "punctuation" && token.text.includes("\n")))
      .toBe(true);
  });

  it("has nothing to say about nothing", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("starts afresh each time", () => {
    // The pattern is a module-level `/g` regex, whose `lastIndex` would otherwise carry over from
    // the call before and cut the front off every document after the first.
    const json = '{"a": 1}';
    expect(tokenize(json)).toEqual(tokenize(json));
  });
});
