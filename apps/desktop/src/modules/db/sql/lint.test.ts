import { describe, expect, it } from "vitest";
import { tokenize, type Token } from "./lint";
import { MSSQL_SYNTAX, MYSQL_SYNTAX, POSTGRES_SYNTAX } from "./syntax";

/** `kind:value` per token, which is short enough to write a whole statement's worth of. */
const of = (sql: string, syntax = MYSQL_SYNTAX) =>
  tokenize(sql, syntax).map((token: Token) => `${token.kind}:${token.value}`);

/** Only the code, the way a caller that does not care about comments reads it. */
const code = (sql: string, syntax = MYSQL_SYNTAX) =>
  tokenize(sql, syntax).filter((token) => token.kind !== "comment");

describe("tokenize: places", () => {
  it("keeps every token's place in the original text", () => {
    const tokens = tokenize("SELECT  1", MYSQL_SYNTAX);
    expect(tokens.map((t) => [t.raw, t.from, t.to])).toEqual([
      ["SELECT", 0, 6],
      ["1", 8, 9],
    ]);
  });

  it("adds the offset, so a statement can be read on its own text", () => {
    const tokens = tokenize("SELECT 1", MYSQL_SYNTAX, 100);
    expect(tokens.map((t) => t.from)).toEqual([100, 107]);
  });

  it("keeps the raw text and the value apart", () => {
    // The raw text is what a squiggle is drawn over; the value is the name being looked up.
    const [token] = tokenize("`my col`", MYSQL_SYNTAX);
    expect(token).toMatchObject({ kind: "quoted", raw: "`my col`", value: "my col" });
  });
});

describe("tokenize: comments", () => {
  it("opens a MySQL line comment only on `--` with space after it", () => {
    // MySQL insists, so `5--3` there is arithmetic rather than a comment.
    expect(of("SELECT 5--3")).toEqual(["word:SELECT", "number:5", "punct:-", "punct:-", "number:3"]);
    expect(of("SELECT 1 -- note")).toEqual(["word:SELECT", "number:1", "comment:-- note"]);
    // At the very end of the text there is nothing after it to be a space, and it is a comment.
    expect(of("SELECT 1 --")).toEqual(["word:SELECT", "number:1", "comment:--"]);
  });

  it("opens a PostgreSQL line comment on any `--`", () => {
    expect(of("SELECT 5--3", POSTGRES_SYNTAX)).toEqual(["word:SELECT", "number:5", "comment:--3"]);
  });

  it("gives `#` to MySQL alone, PostgreSQL reading it as an operator", () => {
    expect(of("SELECT 1 # note")).toEqual(["word:SELECT", "number:1", "comment:# note"]);
    expect(of("a # b", POSTGRES_SYNTAX)).toEqual(["word:a", "punct:#", "word:b"]);
  });

  it("nests block comments on PostgreSQL and not on MySQL", () => {
    const nested = "/* a /* b */ c */ SELECT 1";
    // PostgreSQL: one comment, and the statement after it.
    expect(of(nested, POSTGRES_SYNTAX)).toEqual([
      "comment:/* a /* b */ c */",
      "word:SELECT",
      "number:1",
    ]);
    // MySQL: the comment stops at the first close, and `c */` is code — which it is, there.
    expect(of(nested)).toEqual([
      "comment:/* a /* b */",
      "word:c",
      "punct:*",
      "punct:/",
      "word:SELECT",
      "number:1",
    ]);
  });

  it("marks a block comment the text ran out inside of", () => {
    // Emitted rather than dropped, so an unterminated one can be pointed at.
    const [token] = tokenize("/* never closed", MYSQL_SYNTAX);
    expect(token).toMatchObject({ kind: "comment", open: true });
    expect(tokenize("/* closed */", MYSQL_SYNTAX)[0].open).toBeUndefined();
  });
});

describe("tokenize: strings and names", () => {
  it("reads a double-quoted run the way its engine does", () => {
    // The single decision that matters most: read the wrong way round, every quoted column name
    // becomes a string literal — or every string becomes a name the schema check complains about.
    expect(of('"x"')).toEqual(["string:x"]);
    expect(of('"x"', POSTGRES_SYNTAX)).toEqual(["quoted:x"]);
  });

  it("gives MySQL its backtick and PostgreSQL none", () => {
    expect(of("`x`")).toEqual(["quoted:x"]);
    expect(of("`x`", POSTGRES_SYNTAX)).toEqual(["punct:`", "word:x", "punct:`"]);
  });

  it("undoubles a quote inside a run of the same quote", () => {
    expect(of("'it''s'")).toEqual(["string:it's"]);
    expect(of("`a``b`")).toEqual(["quoted:a`b"]);
  });

  it("escapes with a backslash on MySQL and not on PostgreSQL", () => {
    // A backslash in an ordinary PostgreSQL string is just a backslash, so the literal ends at the
    // quote and what follows is code.
    expect(of("'a\\'b'")).toEqual(["string:a'b"]);
    expect(of("'a\\'", POSTGRES_SYNTAX)).toEqual(["string:a\\"]);
  });

  it("escapes inside a PostgreSQL E'...' and only there", () => {
    // The one thing that makes backslash escaping a property of the literal rather than of the
    // engine. Checked against the server: `SELECT E'it\'s; here'` returns `it's; here`.
    expect(of("E'it\\'s'", POSTGRES_SYNTAX)).toEqual(["word:E", "string:it's"]);
    // A name merely ending in `e` is not a prefix, so this is a plain literal that ends early.
    expect(of("type'a\\'", POSTGRES_SYNTAX)).toEqual(["word:type", "string:a\\"]);
  });

  it("never escapes inside a quoted name", () => {
    // `\` has no meaning between backticks, so the name runs to the closing one.
    expect(of("`a\\`")).toEqual(["quoted:a\\"]);
  });

  it("marks a literal the text ran out inside of", () => {
    expect(tokenize("'unterminated", MYSQL_SYNTAX)[0]).toMatchObject({
      kind: "string",
      open: true,
    });
    expect(tokenize("'closed'", MYSQL_SYNTAX)[0].open).toBeUndefined();
  });
});

describe("tokenize: dollar quoting", () => {
  it("takes a dollar-quoted body whole, semicolons and all", () => {
    // Which is how a function body is written, and why the splitter cannot simply cut at `;`.
    expect(of("$$ SELECT 1; $$", POSTGRES_SYNTAX)).toEqual(["string: SELECT 1; "]);
    expect(of("$body$ a; b $body$", POSTGRES_SYNTAX)).toEqual(["string: a; b "]);
  });

  it("leaves a placeholder alone", () => {
    // Read as an opening quote, `$1` would never close and would swallow the rest of the script.
    // It comes out as one word, `$` being a character an identifier may open with here.
    expect(of("WHERE id = $1", POSTGRES_SYNTAX)).toEqual([
      "word:WHERE",
      "word:id",
      "punct:=",
      "word:$1",
    ]);
  });

  it("leaves a `$` inside a name alone", () => {
    // `SELECT 1 AS a$b$c` names the column `a$b$c` — checked against the server. Read as a quote,
    // it would swallow everything up to the next `$b$`.
    expect(of("SELECT 1 AS a$b$c", POSTGRES_SYNTAX)).toEqual([
      "word:SELECT",
      "number:1",
      "word:AS",
      "word:a$b$c",
    ]);
  });

  it("marks a body the text ran out inside of", () => {
    const [token] = tokenize("$$ unterminated", POSTGRES_SYNTAX);
    expect(token).toMatchObject({ kind: "string", value: " unterminated", open: true });
  });

  it("does not dollar-quote on MySQL at all", () => {
    // The same text there is a name — MySQL lets an identifier hold `$` — and a statement after it
    // is still a statement rather than the inside of a string.
    expect(of("$$ SELECT 1; $$")).toEqual([
      "word:$$",
      "word:SELECT",
      "number:1",
      "punct:;",
      "word:$$",
    ]);
  });
});

describe("tokenize: the rest", () => {
  it("names variables and parameters apart from columns", () => {
    expect(of("@x, @@session.y, :name")).toEqual([
      "variable:@x",
      "punct:,",
      "variable:@@session.y",
      "punct:,",
      "variable::name",
    ]);
  });

  it("does not take a bare colon for a parameter", () => {
    expect(of("a : b")).toEqual(["word:a", "punct::", "word:b"]);
  });

  it("takes a number in every shape SQL writes one", () => {
    for (const number of ["1", "1.5", ".5", "1e10", "1E+10", "1.5e-3"]) {
      expect(of(number), number).toEqual([`number:${number}`]);
    }
  });

  it("lets an identifier hold what MySQL lets one hold", () => {
    // `$` and anything above ASCII, which is how a column named in Vietnamese or Japanese is
    // written without quoting.
    expect(of("khách_hàng")).toEqual(["word:khách_hàng"]);
    expect(of("_a$b1")).toEqual(["word:_a$b1"]);
    // A digit cannot open one.
    expect(of("1a")).toEqual(["number:1", "word:a"]);
  });

  it("has nothing to say about nothing", () => {
    expect(tokenize("", MYSQL_SYNTAX)).toEqual([]);
    expect(tokenize("   \n\t ", MYSQL_SYNTAX)).toEqual([]);
  });

  it("emits comments for the callers that want them and no others", () => {
    expect(code("SELECT /* c */ 1").map((t) => t.value)).toEqual(["SELECT", "1"]);
  });
});

describe("tokenize against MSSQL_SYNTAX", () => {
  const ofMssql = (sql: string) => of(sql, MSSQL_SYNTAX);

  it("reads a bracketed run as a name, with its brackets stripped from value", () => {
    expect(ofMssql("[my col]")).toEqual(["quoted:my col"]);
  });

  it("undoes a doubled close bracket inside the name", () => {
    expect(ofMssql("[a]]b]")).toEqual(["quoted:a]b"]);
  });

  it("still reads the standard double quote as a name, per doubleQuoteIsIdentifier", () => {
    expect(ofMssql('"my col"')).toEqual(["quoted:my col"]);
  });

  it("marks a bracketed run that never closes", () => {
    const [token] = tokenize("[unterminated", MSSQL_SYNTAX);
    expect(token).toMatchObject({ kind: "quoted", value: "unterminated", open: true });
  });
});
