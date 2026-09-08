import type { SQLNamespace } from "@codemirror/lang-sql";
import type { SqlDialect } from "./dialect";
import type { SqlOutlineColumn, SqlSchemaOutline } from "../types";

/** A name safe to write with no quoting at all in every dialect this app speaks: starts with a
 *  letter or underscore, and holds nothing but letters, digits and underscores after that. */
const BARE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The text a completion actually inserts for one table or column name — quoted when the bare name
 * would not parse on its own: a space or other punctuation in it (SQL Server's own `Order Details`
 * is exactly this), a leading digit, or a collision with a word the dialect reserves (`group`,
 * `order`). Left alone otherwise, so the common case still inserts a plain, unadorned name.
 *
 * The quoting itself is the same formula `lint.ts`'s `asWritten` uses for a fix suggestion: the
 * dialect's own open/close pair, with a literal close character inside the name doubled to escape
 * it. Unlike `asWritten`, there is no already-written form to preserve here — a name read off the
 * schema outline was never typed by anyone, so this always decides fresh rather than only quoting
 * what was already quoted.
 */
function applyName(name: string, dialect: SqlDialect): string {
  if (BARE_IDENTIFIER.test(name) && !dialect.reserved.has(name.toLowerCase())) return name;
  // PostgreSQL's own `identifierQuote` is null — it reads `"` through `doubleQuoteIsIdentifier`
  // instead — so a symmetric `"` pair stands in here too, the same fallback `asWritten` uses.
  const { open, close } = dialect.syntax.identifierQuote ?? { open: '"', close: '"' };
  return `${open}${name.split(close).join(close + close)}${close}`;
}

/**
 * The schema outline, in the shape CodeMirror completes from.
 *
 * Everything is nested under the database's own name, and the editor is told that name is the
 * default one. That is what makes both spellings complete: `users` on its own, as an unqualified
 * script writes it, and `shop.users` where a script reaches across databases.
 */
export function completionSchema(
  outline: SqlSchemaOutline | null,
  dialect: SqlDialect
): SQLNamespace | null {
  if (!outline) return null;
  const tables: Record<string, SQLNamespace> = {};
  for (const table of outline.tables) {
    // The key is split on its dots into one level per part — `sales.orders` becomes `orders`
    // inside `sales` — and `self` is the entry offered at the level *above* the last part. So it
    // is named after that part alone: the whole dotted name there would complete `sales.` to
    // `sales.sales.orders`.
    const last = table.name.split(".").pop() ?? table.name;
    tables[table.name] = {
      self: { label: last, apply: applyName(last, dialect), type: "type" },
      children: table.columns.map((column) => ({
        label: column.name,
        apply: applyName(column.name, dialect),
        type: "property",
        detail: columnDetail(column),
      })),
    };
  }
  return { [outline.database]: tables };
}

/** What is written beside a column in the list. Two columns of the same name in different tables
 *  are told apart by this line, so it carries what actually distinguishes them: the type, whether
 *  it is the key, and where a foreign key points.
 *
 *  Exported because the hover tooltip lists a table's columns the same way. One description of a
 *  column, wherever it is shown. */
export function columnDetail(column: SqlOutlineColumn): string {
  const parts = [column.key === "PRI" ? "PK" : null, column.dataType];
  // `->` rather than a real arrow, and drawn as one either way: the app ships Fira Code itself, and
  // its ligature turns the two characters into a single long arrow. An actual `→` would come out
  // worse — U+2192 is in none of the subsets `@fontsource/fira-code` serves, whose latin range
  // carries U+2191 and U+2193 and stops there, so it would be borrowed from whatever the OS has and
  // sit at the wrong width in a column of monospace.
  if (column.references) parts.push(`-> ${column.references}`);
  return parts.filter((part) => part !== null).join(" ");
}
