import { useEffect, useRef, useState, type ReactNode } from "react";
import Input from "../Input";
import { useTranslation } from "../../i18n";
import { errorMessage } from "../../core/errors";
import styles from "./NameDialog.module.css";
import Modal, { ModalBody, ModalErrors } from "../Modal";

interface Props {
  title: string;
  /** What the dialog is about, for readers who hear it rather than see it. */
  ariaLabel: string;
  /** The label over the name box — "Name", or whatever the thing being named calls it. */
  label: string;
  /** What the box starts at. Given, it starts selected too: renaming usually means replacing the
   *  name rather than editing it. */
  initialName?: string;
  /** Shown when the box is left empty; the only thing checked here, since everything else about a
   *  name is the server's to judge. */
  emptyError: string;
  submitLabel: string;
  savingLabel: string;
  /** A note under the fields: what the caller is about to create beyond the name itself. */
  hint?: string;
  /** Fields the caller adds under the name, given whether the submit is in flight so they can
   *  close themselves while it is. */
  extraFields?: (saving: boolean) => ReactNode;
  onCancel: () => void;
  /** Rejects with the reason it failed: the dialog then shows that and stays open with the typed
   *  name still in it. The caller is what closes the dialog, once this resolves. */
  onSubmit: (name: string) => Promise<void>;
}

/**
 * The dialog behind "create one of these": a name, whatever else the caller needs beside it, and
 * one button. Shared rather than written per thing created, so that a table, a collection and
 * anything after them ask for a name the same way.
 */
function NameDialog({
  title,
  ariaLabel,
  label,
  initialName = "",
  emptyError,
  submitLabel,
  savingLabel,
  hint,
  extraFields,
  onCancel,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  async function submit() {
    const trimmed = name.trim();
    if (trimmed === "") {
      setErrors([emptyError]);
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      await onSubmit(trimmed);
    } catch (e) {
      setErrors([errorMessage(t, e)]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={title}
      label={ariaLabel}
      size="small"
      onClose={onCancel}
      locked={saving}
      actions={[
        { kind: "cancel", label: t("common.cancel"), disabled: saving },
        {
          kind: "confirm",
          label: submitLabel,
          onClick: () => void submit(),
          busy: saving ? savingLabel : undefined,
        },
      ]}
    >
      {() => (
        <>
          <ModalBody>
            <label className={styles.field}>
              {label}
              <Input
                ref={nameRef}
                size="normal"
                value={name}
                disabled={saving}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !saving) void submit();
                }}
              />
            </label>
            {extraFields?.(saving)}
            {hint !== undefined && <p className={styles.hint}>{hint}</p>}
          </ModalBody>
          <ModalErrors messages={errors} />
        </>
      )}
    </Modal>
  );
}

export default NameDialog;

/** The class the caller's own fields wear, so they line up with the name box above them. */
export const fieldClassName = styles.field;
