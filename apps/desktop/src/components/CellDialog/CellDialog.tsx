import { useMemo, useState } from "react";
import { useTranslation } from "../../i18n";
import JsonView from "../JsonView";
import { copyText } from "../../core/clipboard";
import { displayValue } from "../../core/virtualRows";
import { errorMessage } from "../../core/errors";
import styles from "./CellDialog.module.css";
import Modal, { ModalBody, ModalErrors } from "../Modal";

interface Props {
  /** The column the cell is in, for the heading. */
  column: string;
  /** Which row it came from, when the grid behind numbers its rows — the query tab's result shows
   *  that number in its `#` column, so the dialog and the grid agree about where this is. `null`
   *  where there is no such number: the data tab's table is a page of a table somebody may have
   *  sorted and filtered, and "row 3" there would name a different row on every visit. */
  rowNumber: number | null;
  value: unknown;
  onClose: () => void;
}

/**
 * Whatever is in the cell, parsed as JSON when it turns out to be JSON.
 *
 * A driver hands JSON columns over as objects already, so those need no parsing. The case worth
 * catching is the other one: a `TEXT` column holding a document, which arrives as a string and is
 * the very thing somebody opens a cell to read. Only an object or an array counts — `JSON.parse`
 * also swallows `42` and `"hello"`, and rendering a number as a JSON document would put a bare
 * value on a coloured line for no reason.
 */
function asJson(value: unknown): unknown | null {
  if (typeof value === "object" && value !== null) return value;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * One cell of a grid, big enough to read.
 *
 * A grid cuts every cell off at 320px and puts the rest in a tooltip, which is right for scanning a
 * table and useless for a value that is a paragraph, a stack trace or a document. This is where
 * that value is actually read — and copied, since selecting text out of a 320px cell is not a thing
 * anyone manages.
 *
 * Read-only, and it is meant to be: this is opened from the query tab's result, which has no way
 * back to the table it came from, and from the data tab's table, where a cell is edited in place.
 */
function CellDialog({ column, rowNumber, value, onClose }: Props) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState("");
  const json = useMemo(() => asJson(value), [value]);
  /** What the copy button puts on the clipboard: the text on screen, whichever of the two it is. */
  const text = useMemo(
    () => (json === null ? displayValue(value) : JSON.stringify(json, null, 2)),
    [json, value]
  );

  const title = rowNumber === null ? column : t("cellDialog.title", { column, n: rowNumber });

  return (
    <Modal
      title={title}
      /* A layer of its own above every other dialog: this one can be opened from a pane already
         lifted over the window — the query tab's expanded results, at 81. On the shared 80 the
         scrim went behind the very pane it was meant to dim. */
      layer={82}
      onClose={onClose}
      actions={[
        {
          kind: "secondary",
          label: t("cellDialog.copy"),
          onClick: () => {
            void copyText(text)
              .then(() => setFailed(""))
              .catch((e) => setFailed(errorMessage(t, e)));
          },
        },
      ]}
    >
      {() => (
        <>
          <ModalBody fill>
            <div className={styles.box}>
              {json === null ? <pre className={styles.text}>{text}</pre> : <JsonView value={json} />}
            </div>
          </ModalBody>
          <ModalErrors messages={[failed]} />
        </>
      )}
    </Modal>
  );
}

export default CellDialog;
