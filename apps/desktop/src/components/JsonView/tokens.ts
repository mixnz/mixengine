/** What a token is painted as. `punctuation` is everything the pattern below doesn't claim:
 * braces, brackets, commas and the whitespace of the indentation. */
export type TokenKind = "key" | "string" | "number" | "keyword" | "punctuation";

export interface Token {
  text: string;
  kind: TokenKind;
}

/**
 * The pieces worth colouring, in one pass.
 *
 * Safe as a regex only because it is run over `JSON.stringify` output rather than over arbitrary
 * text: that output is well-formed by construction, so a `{` inside a string can never be
 * mistaken for structure and every string is escaped the one way JSON escapes things. A string
 * is claimed before a number or a keyword can be, which is what keeps `"123"` and `"true"` from
 * being read as the values they spell.
 */
const TOKEN =
  /"(?:\\.|[^"\\])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/** A quoted run is a key when the pattern swallowed the `:` that follows it, and a plain string
 * otherwise — the colon is outside the quotes, so a value that merely ends in one is unaffected. */
function classify(text: string): TokenKind {
  if (text.startsWith('"')) return text.trimEnd().endsWith(":") ? "key" : "string";
  if (text === "true" || text === "false" || text === "null") return "keyword";
  return "number";
}

/** Splits pretty-printed JSON into the runs to colour, in order and covering the whole input. */
export function tokenize(json: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of json.matchAll(TOKEN)) {
    const start = match.index;
    if (start > last) tokens.push({ text: json.slice(last, start), kind: "punctuation" });
    tokens.push({ text: match[0], kind: classify(match[0]) });
    last = start + match[0].length;
  }
  if (last < json.length) tokens.push({ text: json.slice(last), kind: "punctuation" });
  return tokens;
}
