import { describe, expect, it } from "vitest";
import {
  CLICKHOUSE_SYNTAX,
  dollarTag,
  MSSQL_SYNTAX,
  MYSQL_SYNTAX,
  opensEscapeString,
  POSTGRES_SYNTAX,
  SQLITE_SYNTAX,
} from "./syntax";

describe("the two syntax tables", () => {
  it("disagree on every rule but batchSeparator, which is what they are for", () => {
    // Each field is a lexical rule the two engines answer differently. One they agreed on would
    // belong in the splitter rather than here — and one that had drifted into agreement by
    // accident is the failure this catches. `batchSeparator` is the one deliberate exception:
    // neither engine has SQL Server's `GO`, so both leave it `false` — agreeing by having nothing
    // to disagree about, not by drift.
    const keys = (Object.keys(MYSQL_SYNTAX) as (keyof typeof MYSQL_SYNTAX)[]).filter(
      (key) => key !== "batchSeparator"
    );
    for (const key of keys) {
      expect(MYSQL_SYNTAX[key], key).not.toBe(POSTGRES_SYNTAX[key]);
    }
    expect(MYSQL_SYNTAX.batchSeparator).toBe(POSTGRES_SYNTAX.batchSeparator);
  });

  it("reads a double-quoted run the way its engine does", () => {
    // Nothing else in the tokenizer decides as much: the wrong way round, every quoted column
    // name becomes a string literal, or every string becomes a name the schema check has never
    // heard of.
    expect(POSTGRES_SYNTAX.doubleQuoteIsIdentifier).toBe(true);
    expect(MYSQL_SYNTAX.doubleQuoteIsIdentifier).toBe(false);
    // And only MySQL has a quote of its own beside the standard one — symmetric, so its pair
    // opens and closes with the same character.
    expect(MYSQL_SYNTAX.identifierQuote).toEqual({ open: "`", close: "`" });
    expect(POSTGRES_SYNTAX.identifierQuote).toBeNull();
  });

  it("puts backslash escaping where each engine puts it", () => {
    // On MySQL it belongs to the engine; on PostgreSQL to the literal, through `E'...'`.
    expect(MYSQL_SYNTAX.backslashEscapes).toBe(true);
    expect(MYSQL_SYNTAX.escapeStringPrefix).toBe(false);
    expect(POSTGRES_SYNTAX.backslashEscapes).toBe(false);
    expect(POSTGRES_SYNTAX.escapeStringPrefix).toBe(true);
  });
});

describe("opensEscapeString", () => {
  /** The index of the `'` in the text, which is what the function is asked about. */
  const at = (sql: string) => sql.indexOf("'");

  it("is true for a prefix touching the quote, in either case", () => {
    // Checked against the server: `SELECT E'it\'s; here'` returns `it's; here`, while
    // `SELECT 'a\b'` returns `a\b` unchanged.
    expect(opensEscapeString("E'x'", at("E'x'"))).toBe(true);
    expect(opensEscapeString("e'x'", at("e'x'"))).toBe(true);
    expect(opensEscapeString("SELECT E'x'", at("SELECT E'x'"))).toBe(true);
  });

  it("is false for a plain literal", () => {
    expect(opensEscapeString("'x'", 0)).toBe(false);
  });

  it("is false for an `e` that is a word of its own", () => {
    // `SELECT e 'x'` is a column aliased `e` beside a plain string.
    expect(opensEscapeString("SELECT e 'x'", at("SELECT e 'x'"))).toBe(false);
  });

  it("is false for a name that merely ends in e", () => {
    // `type'x'` is neither — the prefix has to be the whole word.
    expect(opensEscapeString("type'x'", at("type'x'"))).toBe(false);
    expect(opensEscapeString("SELECT date'2024-01-01'", at("SELECT date'2024-01-01'"))).toBe(false);
  });

  it("handles a prefix at the very start of the text", () => {
    // Nothing two characters back, which must read as "no name before it" rather than throw.
    expect(opensEscapeString("E'x'", 1)).toBe(true);
  });
});

describe("dollarTag", () => {
  it("reads the tag of a quote that opens here", () => {
    expect(dollarTag("$$hi$$", 0)).toBe("");
    expect(dollarTag("$body$hi$body$", 0)).toBe("body");
    expect(dollarTag("$_1$hi$_1$", 0)).toBe("_1");
  });

  it("answers nothing where there is no `$` at all", () => {
    expect(dollarTag("select 1", 0)).toBeNull();
  });

  it("refuses a placeholder, which is what `$1` is", () => {
    // Read as an opening quote, `$1` would never close and would swallow the rest of the script.
    expect(dollarTag("WHERE id = $1", "WHERE id = $1".indexOf("$"))).toBeNull();
    expect(dollarTag("$2, $3", 0)).toBeNull();
  });

  it("refuses a `$` glued to the end of a name", () => {
    // `$` is legal inside a PostgreSQL identifier and the server reads the longest name it can
    // before looking for a quote: `SELECT 1 AS a$b$c` names the column `a$b$c`, and
    // `SELECT$$hi$$` is a syntax error naming the whole of `SELECT$$hi$$` — both checked against
    // the server. Read as a quote instead, `a$b$c` swallows everything up to the next `$b$`.
    expect(dollarTag("a$b$c", 1)).toBeNull();
    expect(dollarTag("SELECT$$hi$$", 6)).toBeNull();
    expect(dollarTag("x1$$", 2)).toBeNull();
  });

  it("still opens after something that cannot be part of a name", () => {
    expect(dollarTag("AS $$hi$$", 3)).toBe("");
    expect(dollarTag("($$hi$$)", 1)).toBe("");
  });

  it("refuses a tag holding something an identifier cannot", () => {
    expect(dollarTag("$a-b$", 0)).toBeNull();
    expect(dollarTag("$a b$", 0)).toBeNull();
  });

  it("refuses a run that never closes its tag", () => {
    expect(dollarTag("$body", 0)).toBeNull();
    expect(dollarTag("$", 0)).toBeNull();
  });
});

describe("MSSQL_SYNTAX", () => {
  it("quotes an identifier with an unlike pair, unlike every other engine here", () => {
    expect(MSSQL_SYNTAX.identifierQuote).toEqual({ open: "[", close: "]" });
  });

  it("is the only syntax table with a batch separator", () => {
    expect(MSSQL_SYNTAX.batchSeparator).toBe(true);
    expect(MYSQL_SYNTAX.batchSeparator).toBe(false);
    expect(POSTGRES_SYNTAX.batchSeparator).toBe(false);
    expect(SQLITE_SYNTAX.batchSeparator).toBe(false);
    expect(CLICKHOUSE_SYNTAX.batchSeparator).toBe(false);
  });
});
