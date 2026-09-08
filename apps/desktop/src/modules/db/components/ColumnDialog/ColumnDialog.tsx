import { useEffect, useRef, useState } from "react";
import Button from "../../../../components/Button";
import CollationSelect from "../CollationSelect";
import Input from "../../../../components/Input";
import Select from "../../../../components/Select";
import type { SelectOption } from "../../../../components/Select";
import { useTranslation } from "../../../../i18n";
import { errorMessage } from "../../../../core/errors";
import type { SqlCollation, SqlColumnSpec, SqlStructureColumn } from "../../types";
import type { SqlDialect, SqlTypeSpec } from "../../sql/dialect";
import { useSqlDialect } from "../../sql/context";
import styles from "./ColumnDialog.module.css";
import Modal from "../../../../components/Modal";

/** What is known about a type name, or undefined for one the engine's list doesn't carry — a column
 * declared as something older, newer or more exotic than the app knows still has to be editable. */
function typeSpec(types: readonly SqlTypeSpec[], name: string): SqlTypeSpec | undefined {
  const wanted = name.trim().toLowerCase();
  return types.find((type) => type.name.toLowerCase() === wanted);
}

/** Only a number, or a number and a scale: what every type but `enum`/`set` takes. */
const NUMERIC_ARGUMENT = /^\d+(\s*,\s*\d+)?$/;

/**
 * The argument a type is actually declared with. For a type that cannot be written without one, the
 * suggestion in the box's placeholder is what an empty box means: leaving `varchar` blank gets the
 * `255` shown there rather than an error.
 *
 * `enum` and `set` are the exception. Their suggestion is a sample of the shape — `'a','b'` — and
 * storing it would be storing values nobody asked for, so those still have to be filled in.
 */
function typeArgOrDefault(spec: SqlTypeSpec | undefined, arg: string): string {
  if (arg !== "") return arg;
  return spec?.required === true && spec.list !== true ? (spec.arg ?? "") : "";
}

/**
 * Splits a declared type into the parts the form edits. `varchar(255)` is a name and an argument,
 * `int unsigned` a name and a flag, and anything else trailing (`zerofill`, a character set) is
 * kept verbatim so that editing a column cannot quietly drop it.
 *
 * The name is not simply the first word, because on PostgreSQL it often is not one: `double
 * precision` and `timestamp with time zone` are single types whose names have spaces in them. So
 * the longest run of leading words that names a type the engine's list carries is taken as the
 * name, and only failing that the first word — which is what leaves MySQL's `int unsigned` reading
 * as `int` with an attribute after it.
 */
export function parseType(
  types: readonly SqlTypeSpec[],
  dataType: string,
): Pick<Draft, "typeName" | "typeArg" | "unsigned" | "typeTail"> {
  const text = dataType.trim();
  const open = text.indexOf("(");
  // The last `)`, not the first: an enum's values may have parentheses of their own inside quotes.
  const close = text.lastIndexOf(")");
  const parenthesised = open !== -1 && close > open;
  const head = (parenthesised ? text.slice(0, open) : text).trim();

  const headWords = head.split(/\s+/).filter((word) => word !== "");
  let taken = 1;
  for (let n = headWords.length; n > 1; n -= 1) {
    if (typeSpec(types, headWords.slice(0, n).join(" "))) {
      taken = n;
      break;
    }
  }
  const words = [
    ...headWords.slice(taken),
    ...(parenthesised ? text.slice(close + 1) : "").split(/\s+/),
  ].filter((word) => word !== "");

  // Spelled the way the engine's own list spells it, so the picker can match it and so the
  // declaration that goes back out is the one the engine accepts. Lower-casing it unconditionally
  // was safe only while every list held lower-case names: ClickHouse's are mixed case and its type
  // names are case-sensitive — `uint64` is refused outright, `Code: 50 UNKNOWN_TYPE`. A type the
  // list has no entry for keeps whatever spelling it arrived with, for the same reason.
  const rawName = headWords.slice(0, taken).join(" ");
  return {
    typeName: typeSpec(types, rawName)?.name ?? rawName,
    typeArg: parenthesised ? text.slice(open + 1, close).trim() : "",
    unsigned: words.some((word) => word.toLowerCase() === "unsigned"),
    typeTail: words.filter((word) => word.toLowerCase() !== "unsigned").join(" "),
  };
}

/** The declared type the parts add back up to — what actually reaches the server. */
export function composeType(types: readonly SqlTypeSpec[], draft: Draft): string {
  const name = draft.typeName.trim();
  if (name === "") return "";
  const spec = typeSpec(types, name);
  const arg = typeArgOrDefault(spec, draft.typeArg.trim());
  // `[]` binds tight to the type it makes an array of, so it goes back on the name rather than
  // being joined to it with a space. It arrives in the tail as a word of its own — a
  // `character varying(255)[]` is split at the `)`, leaving the brackets on the far side of the
  // join — and PostgreSQL accepts the spaced spelling, which is exactly the trouble: it is not the
  // spelling `format_type` reports, so `postgres_ddl::modify_column` reads the column as having
  // changed type and rewrites the whole table for a saved comment.
  //
  // Only a word that is nothing but brackets moves. Sweeping the finished string would reach inside
  // the argument as well, where MySQL's `enum('a [b]')` has a bracket that is part of a value.
  const tail = draft.typeTail.split(/\s+/).filter((word) => word !== "");
  const brackets = tail.filter((word) => word === "[]").join("");
  const rest = tail.filter((word) => word !== "[]");

  // An argument on a type that takes none is dropped rather than written out: the box is closed
  // for those, so anything left in it is from a type chosen before.
  const base = arg !== "" && spec?.arg !== null ? `${name}(${arg})` : name;
  const parts = [`${base}${brackets}`];
  if (draft.unsigned) parts.push("unsigned");
  if (rest.length > 0) parts.push(rest.join(" "));
  return parts.join(" ");
}

/**
 * The outermost `Nullable(...)` wrapper, taken off.
 *
 * ClickHouse has no nullability separate from the type the way MySQL and PostgreSQL do (`int NULL`
 * vs `int NOT NULL`) — it is part of how the type is spelled. `parseType` splits at the first `(`
 * and assumes one pair of parentheses, so `Nullable(UInt64)` (or worse, `Nullable(Decimal(10, 2))`)
 * parses as a type the list has no entry for and the dropdown shows the raw string. Unwrap before,
 * wrap after; `parseType`/`composeType` are shared by four engines and are left alone.
 *
 * Only a whole wrapper is taken off: the parenthesis opened by `Nullable` has to close at the very
 * last character, not merely somewhere, or `Nullable(a), Nullable(b)` would lose its first layer
 * and mean something else entirely.
 */
export function unwrapNullable(dataType: string): string {
  const text = dataType.trim();
  const prefix = "Nullable(";
  if (!text.startsWith(prefix) || !text.endsWith(")")) return text;
  let depth = 0;
  for (let i = prefix.length - 1; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      // The wrapper's own parenthesis closed before the end of the string: something follows it, so
      // this was never one wrapper around the whole type.
      if (depth === 0) return i === text.length - 1 ? text.slice(prefix.length, i).trim() : text;
    }
  }
  return text;
}

/** The inverse of {@link unwrapNullable}: put the wrapper back on the way out, and never twice.
 *  An empty type stays empty — the dialog refuses it before it reaches here anyway. */
export function wrapNullable(dataType: string, nullable: boolean): string {
  const text = dataType.trim();
  if (!nullable || text === "") return text;
  return unwrapNullable(text) === text ? `Nullable(${text})` : text;
}

/**
 * Whether a SQL Server column being edited is one `ALTER COLUMN` cannot touch: SQL Server refuses
 * that statement outright on a column carrying the IDENTITY property, not merely for turning
 * IDENTITY on or off but for its type, nullability and collation too (D15,
 * `mssql_ddl::modify_column`). Locking those controls here is what keeps this dialog from promising
 * an edit the backend would silently drop rather than apply.
 *
 * `false` on every other engine, and `false` while adding a new column: only an *existing*
 * SQL Server column already carrying IDENTITY is affected — a new column may still ask for one.
 */
export function isIdentityLocked(
  kind: SqlDialect["kind"],
  editingExistingColumn: boolean,
  column: SqlStructureColumn | undefined,
): boolean {
  return kind === "mssql" && editingExistingColumn && column?.autoIncrement === true;
}

/** Where the column is to sit. The two fixed choices carry no colon, so they can never collide
 * with the `AFTER:` of a column that is named after one of them. */
const KEEP = "KEEP";
const FIRST = "FIRST";
const AFTER = "AFTER:";

interface Draft {
  name: string;
  /** The type without its argument or attributes: `varchar`, `int`. */
  typeName: string;
  /** What goes inside the type's parentheses — a length, a precision, or a list of values. */
  typeArg: string;
  unsigned: boolean;
  /** Attributes the form has no control of its own for (`zerofill`), carried through unchanged. */
  typeTail: string;
  nullable: boolean;
  /** Whether a DEFAULT clause is written at all — distinct from a default that is empty text. */
  hasDefault: boolean;
  defaultValue: string;
  defaultIsExpression: boolean;
  autoIncrement: boolean;
  onUpdateCurrentTimestamp: boolean;
  collation: string;
  comment: string;
  position: string;
}

function draftFromColumn(
  types: readonly SqlTypeSpec[],
  kind: SqlDialect["kind"],
  column: SqlStructureColumn | undefined,
): Draft {
  if (!column) {
    return {
      name: "",
      typeName: "",
      typeArg: "",
      unsigned: false,
      typeTail: "",
      nullable: true,
      hasDefault: false,
      defaultValue: "",
      defaultIsExpression: false,
      autoIncrement: false,
      onUpdateCurrentTimestamp: false,
      collation: "",
      comment: "",
      position: KEEP,
    };
  }
  return {
    name: column.name,
    ...parseType(types, kind === "clickhouse" ? unwrapNullable(column.dataType) : column.dataType),
    nullable: column.nullable,
    hasDefault: column.defaultValue !== null,
    defaultValue: column.defaultValue ?? "",
    defaultIsExpression: column.defaultIsExpression,
    autoIncrement: column.autoIncrement,
    onUpdateCurrentTimestamp: column.onUpdateCurrentTimestamp,
    collation: column.collation ?? "",
    comment: column.comment,
    position: KEEP,
  };
}

interface Props {
  table: string;
  /** The table's columns as they stand, for the position picker. */
  columns: SqlStructureColumn[];
  /** What this server supports, for the collation picker. Empty — a server that would not say, or
   *  a list still on its way — leaves the collation a text box, which is what it was before. */
  collations: SqlCollation[];
  /** The column being redefined, or left out to add a new one. */
  column?: SqlStructureColumn;
  onCancel: () => void;
  /** Rejects with the reason the ALTER failed: the dialog then shows it and stays open with the
   *  typed values still in it. The caller is what closes the dialog, once this resolves. */
  onSubmit: (spec: SqlColumnSpec) => Promise<void>;
}

/**
 * The form behind both halves of a column's life: adding one, and redefining one that exists.
 * Editing sends a `CHANGE COLUMN`, which carries the whole definition — so every field starts at
 * what the column currently says, and anything left alone is written back unchanged.
 */
function ColumnDialog({ table, columns, collations, column, onCancel, onSubmit }: Props) {
  const { t } = useTranslation();
  const { kind, editing: offers } = useSqlDialect();
  const editing = column !== undefined;
  const identityLocked = isIdentityLocked(kind, editing, column);
  const [draft, setDraft] = useState<Draft>(() =>
    draftFromColumn(offers.columnTypes, kind, column),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  function patch(changes: Partial<Draft>) {
    setDraft((prev) => ({ ...prev, ...changes }));
    setErrors([]);
  }

  const positionOptions = [
    { value: KEEP, label: t(editing ? "columnDialog.positionKeep" : "columnDialog.positionEnd") },
    { value: FIRST, label: t("columnDialog.positionFirst") },
    // A column cannot be moved after itself, so the one being edited is not on offer.
    ...columns
      .filter((c) => c.name !== column?.name)
      .map((c) => ({
        value: `${AFTER}${c.name}`,
        label: t("columnDialog.positionAfter", { column: c.name }),
      })),
  ];

  const selectedType = typeSpec(offers.columnTypes, draft.typeName);
  const typeOptions: SelectOption<string>[] = [
    // A type the list has no entry for goes on the front of it: without an option of its own the
    // picker would show nothing, and saving would redeclare the column as something else.
    ...(draft.typeName !== "" && selectedType === undefined
      ? [{ value: draft.typeName, label: draft.typeName }]
      : []),
    ...offers.columnTypes.map((type) => ({ value: type.name, label: type.name })),
  ];

  /** Switching type takes the previous type's argument with it when the new one has no
   * parentheses to put it in, and drops UNSIGNED where it means nothing. */
  function chooseType(typeName: string) {
    const spec = typeSpec(offers.columnTypes, typeName);
    patch({
      typeName,
      ...(spec?.arg === null ? { typeArg: "" } : null),
      ...(spec !== undefined && !spec.numeric ? { unsigned: false } : null),
    });
  }

  function toSpec(): SqlColumnSpec {
    const position = draft.position;
    return {
      name: draft.name.trim(),
      dataType:
        kind === "clickhouse"
          ? wrapNullable(composeType(offers.columnTypes, draft), draft.nullable)
          : composeType(offers.columnTypes, draft),
      nullable: draft.nullable,
      defaultValue: draft.hasDefault ? draft.defaultValue : null,
      defaultIsExpression: draft.hasDefault && draft.defaultIsExpression,
      autoIncrement: draft.autoIncrement,
      onUpdateCurrentTimestamp: draft.onUpdateCurrentTimestamp,
      collation: draft.collation.trim() === "" ? null : draft.collation.trim(),
      comment: draft.comment,
      // Left out entirely, the column keeps its place (or a new one is appended); the empty string
      // is what asks for FIRST.
      ...(position === KEEP
        ? null
        : { after: position === FIRST ? "" : position.slice(AFTER.length) }),
    };
  }

  async function submit() {
    const messages: string[] = [];
    if (draft.name.trim() === "") messages.push(t("columnDialog.errorName"));
    const arg = draft.typeArg.trim();
    if (draft.typeName === "") {
      messages.push(t("columnDialog.errorType"));
      // Only a list has nothing to fall back on; a length the box merely suggests is taken as given.
    } else if (selectedType?.required && selectedType.list === true && arg === "") {
      messages.push(t("columnDialog.errorTypeArg", { type: draft.typeName }));
      // Only the numeric arguments are checked. An enum's values are the user's own literals, and
      // a type this list doesn't carry is left alone entirely — MySQL is what judges those.
    } else if (
      arg !== "" &&
      selectedType !== undefined &&
      selectedType.list !== true &&
      !NUMERIC_ARGUMENT.test(arg)
    ) {
      messages.push(t("columnDialog.errorTypeArgNumber"));
    }
    setErrors(messages);
    if (messages.length > 0) return;
    setSaving(true);
    try {
      await onSubmit(toSpec());
    } catch (e) {
      setErrors([errorMessage(t, e)]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      label={table}
      onClose={onCancel}
      locked={saving}
      overlayClassName={styles.overlay}
      className={styles.dialog}
    >
      {(close) => (
        <>
          <h3 className={styles.title}>
            {editing
              ? t("columnDialog.editTitle", { column: column.name })
              : t("columnDialog.addTitle", { table })}
          </h3>

          <div className={styles.form}>
            <label className={styles.field}>
              {t("columnDialog.name")}
              <Input
                ref={nameRef}
                size="normal"
                value={draft.name}
                disabled={saving}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>

            <label className={styles.field}>
              {t("columnDialog.type")}
              <div className={styles.typeRow}>
                <Select
                  value={draft.typeName}
                  size="normal"
                  className={styles.typeSelect}
                  placeholder={t("columnDialog.typePlaceholder")}
                  ariaLabel={t("columnDialog.type")}
                  disabled={saving || identityLocked}
                  searchable
                  options={typeOptions}
                  onChange={chooseType}
                />
                {/* What goes in the type's parentheses, kept beside it rather than typed into the
                    name — the two are edited together, but only one of them is a choice. */}
                <Input
                  size="normal"
                  className={styles.typeArg}
                  value={draft.typeArg}
                  placeholder={selectedType?.arg ?? ""}
                  aria-label={t("columnDialog.typeArg")}
                  // Closed for a type with no parentheses to put anything in, rather than hidden:
                  // the row keeps its shape as the type changes.
                  disabled={saving || identityLocked || selectedType?.arg === null}
                  onChange={(e) => patch({ typeArg: e.target.value })}
                />
              </div>
            </label>

            {/* PostgreSQL appends a column and has no statement that moves one, so there is nothing
                to choose there. */}
            {offers.columnPosition && (
              <label className={styles.field}>
                {t("columnDialog.position")}
                <Select
                  value={draft.position}
                  size="normal"
                  options={positionOptions}
                  ariaLabel={t("columnDialog.position")}
                  disabled={saving}
                  searchable
                  onChange={(position) => patch({ position })}
                />
              </label>
            )}

            <label className={styles.field}>
              {t("columnDialog.collation")}
              <CollationSelect
                value={draft.collation}
                collations={collations}
                placeholder={t("columnDialog.collationPlaceholder")}
                ariaLabel={t("columnDialog.collation")}
                disabled={saving || identityLocked}
                onChange={(collation) => patch({ collation })}
              />
            </label>

            <label className={`${styles.field} ${styles.fieldWide}`}>
              {t("columnDialog.comment")}
              <Input
                size="normal"
                value={draft.comment}
                disabled={saving}
                onChange={(e) => patch({ comment: e.target.value })}
              />
            </label>
          </div>

          <div className={styles.toggles}>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={draft.nullable}
                disabled={saving || identityLocked}
                onChange={(e) => patch({ nullable: e.target.checked })}
              />
              {t("columnDialog.nullable")}
            </label>
            {/* Shown for the types it means something to, and for a type the list doesn't carry that
                already says it — dropping it there would change the column behind the user's back. */}
            {offers.unsigned && (selectedType?.numeric || draft.unsigned) && (
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={draft.unsigned}
                  disabled={saving}
                  onChange={(e) => patch({ unsigned: e.target.checked })}
                />
                {t("columnDialog.unsigned")}
              </label>
            )}
            {/* ClickHouse is the first engine with no counterpart at all — hidden rather than
                disabled, the same way the clause below is. */}
            {offers.autoIncrement && (
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={draft.autoIncrement}
                  disabled={saving || identityLocked}
                  onChange={(e) => patch({ autoIncrement: e.target.checked })}
                />
                {t("columnDialog.autoIncrement")}
              </label>
            )}
            {identityLocked && (
              <p className={styles.hint}>{t("columnDialog.identityLockedMssql")}</p>
            )}
            {/* A MySQL clause. The same effect on PostgreSQL is a trigger, which is not a property of
                the column and so not this dialog's to offer. */}
            {offers.onUpdateCurrentTimestamp && (
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={draft.onUpdateCurrentTimestamp}
                  disabled={saving}
                  onChange={(e) => patch({ onUpdateCurrentTimestamp: e.target.checked })}
                />
                {t("columnDialog.onUpdate")}
              </label>
            )}
          </div>

          <div className={styles.defaultBlock}>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={draft.hasDefault}
                disabled={saving}
                onChange={(e) => patch({ hasDefault: e.target.checked })}
              />
              {t("columnDialog.hasDefault")}
            </label>
            {draft.hasDefault && (
              <>
                <Input
                  size="normal"
                  className={styles.defaultInput}
                  value={draft.defaultValue}
                  aria-label={t("columnDialog.defaultValue")}
                  disabled={saving}
                  onChange={(e) => patch({ defaultValue: e.target.value })}
                />
                <label className={styles.toggle}>
                  <input
                    type="checkbox"
                    checked={draft.defaultIsExpression}
                    disabled={saving}
                    onChange={(e) => patch({ defaultIsExpression: e.target.checked })}
                  />
                  {t("columnDialog.defaultIsExpression")}
                </label>
                <p className={styles.hint}>{t("columnDialog.defaultExpressionHint")}</p>
        </>
          )}
        </div>

        {errors.length > 0 && (
          <div className={styles.errors} role="alert">
            {errors.map((message, i) => (
              <p key={i}>{message}</p>
            ))}
          </div>
        )}

        <div className={styles.actions}>
          <Button size="large" onClick={() => close(onCancel)} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button size="large" variant="primary" onClick={() => void submit()} disabled={saving}>
            {saving
              ? t("columnDialog.saving")
              : t(editing ? "columnDialog.submitEdit" : "columnDialog.submitAdd")}
          </Button>
        </div>
        </>
      )}
    </Modal>
  );
}

export default ColumnDialog;
