/**
 * What the name under the pointer actually is.
 *
 * The editor asks this twice over: once for the tooltip that appears when the pointer rests on a
 * word, and once for `Ctrl+Click`, which needs to know whether the word is a table before it will
 * offer to open one. Both are the same question, so both come through here.
 *
 * The statement is read with the same tokeniser and the same scope reader the checks use — see
 * [lint.ts](./lint.ts). That is the point: an alias resolves to the table the warnings resolve it
 * to, or the two would disagree about the same script.
 *
 * Where the checks stay quiet on anything they cannot model, this is happier to answer. Silence
 * costs a checker its credibility; a tooltip is only ever asked for, so a good guess about a name
 * inside a subquery is worth more than nothing at all.
 */

import { functionSignature } from "./functions";
import { readScope, tokenize, type StatementScope, type Token } from "../sql/lint";
import type { SqlDialect } from "../sql/dialect";
import type { SqlStatement } from "../sql/statements";
import type { SqlOutlineColumn, SqlOutlineTable, SqlSchemaOutline } from "../types";

/** What a name in the script turned out to name, and where it is written. */
export type SqlReference =
  | { kind: "table"; from: number; to: number; table: SqlOutlineTable }
  | {
      kind: "column";
      from: number;
      to: number;
      /** The table the column was found in — the one an alias stood for, when it was written as
       *  one. */
      table: SqlOutlineTable;
      column: SqlOutlineColumn;
    }
  | { kind: "function"; from: number; to: number; name: string; signature: string };

/**
 * The functions MySQL lets you write without brackets.
 *
 * Every other name is only read as a function when a `(` follows it, which is what keeps the `YEAR`
 * of `INTERVAL 1 YEAR` from being described as a date function. These few have no such marker, so
 * they are listed instead.
 */
const PARENLESS = new Set([
  "CURRENT_DATE",
  "CURRENT_TIME",
  "CURRENT_TIMESTAMP",
  "CURRENT_USER",
  "CURRENT_ROLE",
  "LOCALTIME",
  "LOCALTIMESTAMP",
  "SESSION_USER",
  "SYSTEM_USER",
  "UTC_DATE",
  "UTC_TIME",
  "UTC_TIMESTAMP",
]);

/**
 * The words that hold a statement together, and so are never a name.
 *
 * Not the same thing as the reserved-word list the checks use, and deliberately far shorter. Half
 * of what MySQL reserves is also what people call their columns — `date`, `code`, `user`, `value`,
 * `text`, `comment`, `password`, `state`, `size`, `data`, `start`, `count` — and turning all of it
 * away meant `SELECT date FROM logs` said nothing about `date` while `SELECT l.date` said
 * everything. Fifty of the ninety commonest column names are in that list.
 *
 * So only the words that could be *read* as a name in the place they appear are here: `ORDER` in
 * `ORDER BY`, `END` in a `CASE`, `KEY` in an index clause. Every other reserved word is still
 * looked up — but only against the columns of a table this very statement names, which is a narrow
 * enough claim to be worth making. The wider guess, against every table in the database, keeps the
 * full list; see the foot of `referenceAt`.
 */
const STRUCTURE = new Set([
  "SELECT", "FROM", "WHERE", "GROUP", "ORDER", "BY", "HAVING", "LIMIT", "OFFSET",
  "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "OUTER", "CROSS", "NATURAL", "ON", "USING",
  "STRAIGHT_JOIN", "AS", "AND", "OR", "XOR", "NOT", "IN", "IS", "NULL", "LIKE", "RLIKE",
  "REGEXP", "BETWEEN", "ESCAPE", "DIV", "MOD", "CASE", "WHEN", "THEN", "ELSE", "END",
  "DISTINCT", "DISTINCTROW", "ALL", "ANY", "SOME", "EXISTS", "UNION", "INTERSECT", "EXCEPT",
  "WITH", "RECURSIVE", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "REPLACE",
  "DUPLICATE", "IGNORE", "DEFAULT", "CREATE", "ALTER", "DROP", "TRUNCATE", "RENAME", "TABLE",
  "DATABASE", "SCHEMA", "VIEW", "INDEX", "KEY", "ASC", "DESC", "INTERVAL", "COLLATE", "BINARY",
  "PARTITION", "OVER", "WINDOW", "PRECEDING", "FOLLOWING", "UNBOUNDED", "FOR", "LOCK", "NOWAIT",
  "SKIP", "LOCKED", "FORCE", "USE", "EXPLAIN", "DESCRIBE", "SHOW", "CALL", "SEPARATOR",
  "OUTFILE", "DUMPFILE", "INFILE", "LOAD", "LOW_PRIORITY", "HIGH_PRIORITY", "QUICK", "DELAYED",
]);

/** The outline by lower-cased table name, remembered for the outline it was built from.
 *
 * One entry is enough: the pointer is over one editor at a time, and an outline is immutable — a
 * database whose shape changed is a new object, never an edited one. Without this, holding `Ctrl`
 * and moving the pointer would rebuild a map of every table in the database on every mouse event. */
let indexedOutline: SqlSchemaOutline | null = null;
let indexedTables = new Map<string, SqlOutlineTable>();

function tablesByName(outline: SqlSchemaOutline): Map<string, SqlOutlineTable> {
  if (outline !== indexedOutline) {
    indexedTables = new Map(outline.tables.map((table) => [table.name.toLowerCase(), table]));
    indexedOutline = outline;
  }
  return indexedTables;
}

/** The table a name stands for: an alias the statement introduced, or a table of the database. */
function tableFor(
  name: string,
  scope: StatementScope,
  byName: Map<string, SqlOutlineTable>
): SqlOutlineTable | null {
  const key = name.toLowerCase();
  const aliased = scope.aliases.get(key);
  if (aliased) {
    const table = byName.get(aliased);
    if (table) return table;
  }
  return byName.get(key) ?? null;
}

function columnOf(table: SqlOutlineTable, name: string): SqlOutlineColumn | null {
  const key = name.toLowerCase();
  return table.columns.find((column) => column.name.toLowerCase() === key) ?? null;
}

/** The tables the statement reads from, as the outline knows them. A name the outline has never
 *  heard of drops out, as does one qualified with another database entirely. */
function scopeTables(
  scope: StatementScope,
  outline: SqlSchemaOutline,
  byName: Map<string, SqlOutlineTable>
): SqlOutlineTable[] {
  const found: SqlOutlineTable[] = [];
  for (const ref of scope.tables) {
    if (ref.database !== "" && ref.database.toLowerCase() !== outline.database.toLowerCase()) {
      continue;
    }
    const table = byName.get(ref.token.value.toLowerCase());
    if (table && !found.includes(table)) found.push(table);
  }
  return found;
}

/** The name token covering `pos`, and where it sits in `code`. Punctuation and literals are passed
 *  over: the pointer resting between two words should find the word, not the dot between them. */
function nameAt(code: readonly Token[], pos: number): number {
  for (let i = 0; i < code.length; i += 1) {
    const token = code[i];
    if (token.kind !== "word" && token.kind !== "quoted") continue;
    if (pos >= token.from && pos <= token.to) return i;
  }
  return -1;
}

function asFunction(token: Token): SqlReference | null {
  const signature = functionSignature(token.value);
  if (!signature) return null;
  return {
    kind: "function",
    from: token.from,
    to: token.to,
    name: token.value.toUpperCase(),
    signature,
  };
}

/**
 * What the script names at `pos`, or null when there is nothing there worth saying anything about.
 *
 * `statements` is the split the editor already has, so nothing is split twice.
 */
export function referenceAt(
  statements: readonly SqlStatement[],
  pos: number,
  outline: SqlSchemaOutline | null,
  dialect: SqlDialect
): SqlReference | null {
  const statement = statements.find((one) => pos >= one.from && pos <= one.to);
  if (!statement) return null;

  const code = tokenize(statement.text, dialect.syntax, statement.from).filter(
    (token) => token.kind !== "comment"
  );
  const i = nameAt(code, pos);
  if (i < 0) return null;
  const token = code[i];

  const table = (found: SqlOutlineTable | null): SqlReference | null =>
    found ? { kind: "table", from: token.from, to: token.to, table: found } : null;

  // Without an outline the only thing that can be recognised is a function — everything else here
  // is a name compared against the database. A backtick-quoted word is never one: the quoting is
  // there to say a name was meant.
  if (!outline) {
    const callable =
      code[i + 1]?.raw === "(" ||
      (token.kind === "word" && PARENLESS.has(token.value.toUpperCase()));
    return callable ? asFunction(token) : null;
  }

  const byName = tablesByName(outline);
  const scope = readScope(code, statement.verb, dialect);
  const qualified = code[i + 1]?.raw === "." && code[i + 2] !== undefined;
  const isDatabase = token.value.toLowerCase() === outline.database.toLowerCase();

  // `u.` — the half in front of the dot. An alias or a table, and the database's own name when the
  // script spells it out, which names nothing worth a tooltip of its own.
  if (qualified) return isDatabase ? null : table(tableFor(token.value, scope, byName));

  // `.id` — the half after it. What sits in front says what this is: a database qualifier makes it
  // a table, anything else makes it a column of whatever that anything else stands for.
  if (code[i - 1]?.raw === ".") {
    const owner = code[i - 2];
    if (!owner || (owner.kind !== "word" && owner.kind !== "quoted")) return null;
    if (owner.value.toLowerCase() === outline.database.toLowerCase()) {
      return table(byName.get(token.value.toLowerCase()) ?? null);
    }
    const owning = tableFor(owner.value, scope, byName);
    if (!owning) return null;
    const column = columnOf(owning, token.value);
    return column
      ? { kind: "column", from: token.from, to: token.to, table: owning, column }
      : null;
  }

  // A name the table list itself accounted for. Read before the bracket rule below, or the `users`
  // of `INSERT INTO users (id) ...` would be taken for a function call.
  if (scope.tables.some((ref) => ref.from === token.from)) {
    return table(byName.get(token.value.toLowerCase()) ?? null);
  }
  if (scope.aliases.has(token.value.toLowerCase())) {
    return table(tableFor(token.value, scope, byName));
  }

  if (code[i + 1]?.raw === "(") return asFunction(token);
  // The handful MySQL lets you write without brackets. Ahead of the reserved-word rule below,
  // because every one of them *is* a reserved word — that is exactly why they parse bare.
  if (token.kind === "word" && PARENLESS.has(token.value.toUpperCase())) return asFunction(token);

  // Past here nothing about the statement says what this name is, and it is being matched on its
  // spelling alone. Backticks say the writer meant a name, so a quoted one is never turned away.
  const bare = token.kind === "word";

  // Against the columns of the tables this statement names — a small enough set that a word MySQL
  // reserves is still worth trying, since a schema is full of columns called `date` and `user`.
  if (!bare || !STRUCTURE.has(token.value.toUpperCase())) {
    for (const candidate of scopeTables(scope, outline, byName)) {
      const column = columnOf(candidate, token.value);
      if (column) {
        return { kind: "column", from: token.from, to: token.to, table: candidate, column };
      }
    }
  }

  // And finally against every table in the database, which is a guess with nothing behind it but
  // the spelling. Here the full reserved list applies: a database with a table called `order` would
  // otherwise have the `ORDER` of every `ORDER BY` described as that table, and `Ctrl+Click` would
  // offer to open it.
  if (bare && dialect.reserved.has(token.value.toLowerCase())) return null;
  return table(byName.get(token.value.toLowerCase()) ?? null);
}
