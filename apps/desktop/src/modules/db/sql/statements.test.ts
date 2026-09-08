/**
 * The client's statement splitter, held against the server's.
 *
 * Every case in the first half of this file is one of the cases
 * [`mysql_script.rs`](../../src-tauri/src/db/mysql_script.rs) tests its own splitter with, written
 * out again here in the same order. That is the point: the two are ports of each other, and the
 * whole contract between them is that a script carves up the same way on both sides. A statement
 * the editor marks in the margin has to be the statement the server ends up running as one, or the
 * highlight, the error underlines and the write guard are all drawn around the wrong text.
 *
 * The second half covers what this port adds and the Rust one has no need of: where each statement
 * sits in the script, and which one the caret is in.
 */

import { describe, expect, it } from "vitest";
import { splitStatements as split, statementAt } from "./statements";
import { MSSQL_SYNTAX, MYSQL_SYNTAX, POSTGRES_SYNTAX } from "./syntax";

/** The MySQL splitter, which is what the first half of this file holds the port against. */
const splitStatements = (sql: string) => split(sql, MYSQL_SYNTAX);

/** The MSSQL splitter — bracketed identifiers, and (further down) the `GO` batch separator. */
const splitMssql = (sql: string) => split(sql, MSSQL_SYNTAX);

const texts = (sql: string) => splitStatements(sql).map((statement) => statement.text);
const verbs = (sql: string) => splitStatements(sql).map((statement) => statement.verb);

describe("splitStatements", () => {
  it("splits on semicolons and trims each statement", () => {
    expect(texts("SELECT 1;\n  SELECT 2 ;")).toEqual(["SELECT 1", "SELECT 2"]);
    // A script needs no trailing semicolon, and an empty one adds no statement.
    expect(texts("SELECT 1")).toEqual(["SELECT 1"]);
    expect(texts(";;\n;")).toEqual([]);
  });

  it("takes the verb from the opening keyword, upper-cased", () => {
    expect(verbs("select 1; delete from t")).toEqual(["SELECT", "DELETE"]);
    // Leading whitespace and a comment before the keyword don't become part of it.
    expect(verbs("  -- a note\n  insert into t values ()")).toEqual(["INSERT"]);
  });

  it("does not split on a semicolon inside a string or a quoted name", () => {
    expect(texts("INSERT INTO t VALUES ('a;b'); SELECT 1")).toEqual([
      "INSERT INTO t VALUES ('a;b')",
      "SELECT 1",
    ]);
    expect(texts(`SELECT "a;b"`)).toEqual([`SELECT "a;b"`]);
    expect(texts("SELECT `we;ird`")).toEqual(["SELECT `we;ird`"]);
  });

  /** Both of MySQL's escapes inside a string literal: a backslash, and the quote doubled. */
  it("does not end a string on an escaped quote", () => {
    expect(texts(String.raw`SELECT 'a\'; b'`)).toEqual([String.raw`SELECT 'a\'; b'`]);
    expect(texts("SELECT 'a''; b'")).toEqual(["SELECT 'a''; b'"]);
  });

  /**
   * Comments are carried along — a `/*! ... *\/` version comment or a `/*+ hint *\/` is part of what
   * MySQL is being asked to run — but a semicolon inside one separates nothing.
   */
  it("carries comments along and hides their semicolons", () => {
    expect(texts("SELECT 1 -- one; two\n; SELECT 2")).toEqual(["SELECT 1 -- one; two", "SELECT 2"]);
    expect(texts("SELECT 1 # one; two")).toEqual(["SELECT 1 # one; two"]);
    expect(texts("/*!40101 SET x=1; */ SELECT 1")).toEqual(["/*!40101 SET x=1; */ SELECT 1"]);
    // Nothing but a comment is not a statement at all.
    expect(texts("-- just a note\n")).toEqual([]);
  });

  /** `--` opens a comment only when whitespace follows it; `5--3` is arithmetic. */
  it("reads two dashes without whitespace as an operator", () => {
    expect(texts("SELECT 5--3; SELECT 2")).toEqual(["SELECT 5--3", "SELECT 2"]);
  });

  /** What this port adds: the range is the trimmed statement, so a finding drawn against it lands
   *  on the text rather than on the whitespace in front of it. */
  it("points each statement at where its trimmed text sits", () => {
    const sql = "  SELECT 1;\n\nSELECT 2";
    const [first, second] = splitStatements(sql);
    expect(sql.slice(first.from, first.to)).toBe("SELECT 1");
    expect(sql.slice(second.from, second.to)).toBe("SELECT 2");
    // The terminating semicolon belongs to neither.
    expect(sql[first.to]).toBe(";");
  });
});

describe("statementAt", () => {
  it("finds the statement the caret is inside", () => {
    const sql = "SELECT 1;\nSELECT 2";
    const statements = splitStatements(sql);
    expect(statementAt(sql, statements, 3)?.text).toBe("SELECT 1");
    expect(statementAt(sql, statements, 12)?.text).toBe("SELECT 2");
  });

  it("stays with the statement just ended until a blank line says otherwise", () => {
    // The caret left sitting after the semicolon it has just typed is still working on that
    // statement — running it is the commonest thing to do next.
    const near = "SELECT 1;\nSELECT 2";
    expect(statementAt(near, splitStatements(near), 9)?.text).toBe("SELECT 1");

    // Past a blank line it has moved on to what comes next.
    const apart = "SELECT 1;\n\n\n   SELECT 2";
    expect(statementAt(apart, splitStatements(apart), 12)?.text).toBe("SELECT 2");
  });

  it("answers with nothing for a script that holds no statements", () => {
    expect(statementAt("", [], 0)).toBeNull();
    expect(statementAt("-- a note", splitStatements("-- a note"), 4)).toBeNull();
  });
});

/**
 * The second engine, held against `postgres_script.rs` the same way — case for case, in the same
 * order. Only the cases where PostgreSQL reads the text differently from MySQL are here; the rest
 * are covered above and go through the identical code.
 */
describe("splitStatements on PostgreSQL", () => {
  const pg = (sql: string) => split(sql, POSTGRES_SYNTAX).map((statement) => statement.verb);
  const pgTexts = (sql: string) => split(sql, POSTGRES_SYNTAX).map((statement) => statement.text);

  /** The one MySQL's splitter would get wrong: a function body is held together by its dollar
   *  quotes however many semicolons are inside it. */
  it("keeps a dollar-quoted body in one statement", () => {
    const sql =
      "CREATE FUNCTION f() RETURNS int AS $$ BEGIN a := 1; RETURN a; END $$ LANGUAGE plpgsql; SELECT 2";
    expect(pg(sql)).toEqual(["CREATE", "SELECT"]);
    expect(pgTexts(sql)[0]).toContain("RETURN a;");
  });

  it("closes a tagged body only on its own tag", () => {
    const sql = "CREATE FUNCTION f() RETURNS text AS $body$ SELECT '$$'; $body$ LANGUAGE sql; SELECT 1";
    expect(pg(sql)).toEqual(["CREATE", "SELECT"]);
  });

  /** `$1` is a placeholder. Read as an opening quote it would swallow the rest of the script. */
  it("does not read a placeholder as a dollar quote", () => {
    expect(pg("SELECT $1; SELECT $2")).toEqual(["SELECT", "SELECT"]);
  });

  /** A backslash is an ordinary character in PostgreSQL, so the string ends at the quote after it
   *  — where MySQL would read that quote as escaped. */
  it("does not treat a backslash as an escape", () => {
    expect(pg(String.raw`SELECT 'a\'; SELECT 2`)).toEqual(["SELECT", "SELECT"]);
    // Doubling is still the escape it is everywhere.
    expect(pg("SELECT 'it''s; here'; SELECT 2")).toEqual(["SELECT", "SELECT"]);
  });

  /** The exception to the rule above: an `E''` string does escape with backslashes, so the quote
   *  after one is not the end of it. Confirmed on the server — `SELECT E'it\'s; here'` comes back
   *  as `it's; here`, one statement holding a semicolon. */
  it("reads an E-string as the escaping literal it is", () => {
    expect(pg(String.raw`SELECT E'it\'s; here'; SELECT 2`)).toEqual(["SELECT", "SELECT"]);
    expect(pgTexts(String.raw`SELECT E'it\'s; here'; SELECT 2`)[0]).toBe(
      String.raw`SELECT E'it\'s; here'`
    );
    // Lowercase is the same prefix.
    expect(pg(String.raw`SELECT e'it\'s; here'; SELECT 2`)).toEqual(["SELECT", "SELECT"]);
    // A name that merely ends in `e` is not a prefix, and neither is one held off by a space.
    expect(pg(String.raw`SELECT type'a\'; SELECT 2`)).toEqual(["SELECT", "SELECT"]);
  });

  /** `$` is legal inside a PostgreSQL identifier, so `a$b$c` is one column name and not a body
   *  opening at `$b$` — the server names the column `a$b$c`. Read the wrong way it eats the rest
   *  of the script. */
  it("does not read a dollar inside a name as a quote", () => {
    expect(pg("SELECT 1 AS a$b$c; SELECT 2")).toEqual(["SELECT", "SELECT"]);
    expect(pg("SELECT x$$y$$; SELECT 2")).toEqual(["SELECT", "SELECT"]);
    // A real body is still one, wherever it opens.
    expect(pg("SELECT $tag$a; b$tag$; SELECT 2")).toEqual(["SELECT", "SELECT"]);
  });

  it("nests block comments", () => {
    expect(pg("/* a /* b */ ; c */ SELECT 1")).toEqual(["SELECT"]);
  });

  /** `#` is an operator in PostgreSQL, not the start of a comment. */
  it("does not read a hash as a comment", () => {
    expect(pg("SELECT 1 # 2; SELECT 3")).toEqual(["SELECT", "SELECT"]);
  });

  /** PostgreSQL needs no whitespace after `--`, unlike MySQL. */
  it("opens a comment on two dashes alone", () => {
    expect(pg("SELECT 1 --2; SELECT 3")).toEqual(["SELECT"]);
  });
});

describe("splitStatements against MSSQL_SYNTAX", () => {
  it("does not split on a semicolon inside a bracketed identifier", () => {
    expect(splitMssql("SELECT * FROM [Order;Details]; SELECT 1").map((s) => s.text)).toEqual([
      "SELECT * FROM [Order;Details]",
      "SELECT 1",
    ]);
  });

  it("does not end a bracketed name on a doubled close bracket", () => {
    // `]]` inside `[...]` is one literal `]`, the same way MySQL doubles a backtick — but SQL
    // Server's pair means the character that gets doubled is the *close*, never the open.
    expect(splitMssql("SELECT * FROM [a]]b]").map((s) => s.text)).toEqual([
      "SELECT * FROM [a]]b]",
    ]);
  });

  it("still reads the standard double-quoted identifier, on top of the bracket form", () => {
    expect(splitMssql(`SELECT * FROM "Order;Details"`).map((s) => s.text)).toEqual([
      `SELECT * FROM "Order;Details"`,
    ]);
  });
});

describe("splitStatements' batch separator (SQL Server's GO)", () => {
  it("ends the previous statement and starts a new one, without becoming one itself", () => {
    expect(splitMssql("SELECT 1\nGO\nSELECT 2").map((s) => s.text)).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
  });

  it("still splits on `;` inside each batch", () => {
    expect(splitMssql("SELECT 1; SELECT 2\nGO\nSELECT 3").map((s) => s.text)).toEqual([
      "SELECT 1",
      "SELECT 2",
      "SELECT 3",
    ]);
  });

  it("accepts a repeat count", () => {
    expect(splitMssql("SELECT 1\nGO 3\nSELECT 2").map((s) => s.text)).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
  });

  it("is case-insensitive", () => {
    expect(splitMssql("SELECT 1\ngo\nSELECT 2").map((s) => s.text)).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
  });

  it("opens at the very start of the script too", () => {
    expect(splitMssql("GO\nSELECT 1").map((s) => s.text)).toEqual(["SELECT 1"]);
  });

  it("two GOs in a row add no empty statement between them", () => {
    expect(splitMssql("SELECT 1\nGO\nGO\nSELECT 2").map((s) => s.text)).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
  });

  it("is not fooled by a comment that merely contains the word", () => {
    expect(splitMssql("SELECT 1 -- go\nSELECT 2").map((s) => s.text)).toEqual([
      "SELECT 1 -- go\nSELECT 2",
    ]);
  });

  it("is not fooled by a name that merely starts with the word", () => {
    expect(splitMssql("SELECT good_column FROM t").map((s) => s.text)).toEqual([
      "SELECT good_column FROM t",
    ]);
  });

  it("requires GO to have the line to itself", () => {
    expect(splitMssql("SELECT 1 GO\nSELECT 2").map((s) => s.text)).toEqual([
      "SELECT 1 GO\nSELECT 2",
    ]);
  });

  it("does not fire when the dialect has no batch separator", () => {
    expect(texts("SELECT 1\nGO\nSELECT 2")).toEqual(["SELECT 1\nGO\nSELECT 2"]);
  });
});
