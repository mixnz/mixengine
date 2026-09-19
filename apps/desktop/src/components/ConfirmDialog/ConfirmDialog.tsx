import { type ReactNode } from "react";
import { useTranslation } from "../../i18n";
import styles from "./ConfirmDialog.module.css";
import Modal, { ModalBody } from "../Modal";

interface ConfirmDialogProps {
  title: string;
  message: string;
  /** Defaults to the generic "Confirm"; give it a verb when the action has a name of its own. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Paints the confirm button as destructive. For actions that lose data, not merely risky ones. */
  danger?: boolean;
  /** Extra controls shown under the message — options that change what confirming will do. */
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A modal yes/no gate. Rendered into `document.body` rather than in place: the dialog is fixed to
 * the viewport, and a caller deep inside a scrolling panel shouldn't have to care whether some
 * ancestor of theirs establishes a containing block for it.
 *
 * Both answers go through `close`, so the dialog is off the screen before the caller acts on what
 * it said — including the confirm, which is the one place a modal here animates out of a decision
 * rather than out of a dismissal.
 *
 * A caller may keep it mounted through that answer and replace the `message` with what the call
 * was refused with; the dialog comes back to ask again, with `confirmLabel` naming what the second
 * answer would do.
 */
function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger,
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <Modal
      title={title}
      size="small"
      onClose={onCancel}
      /* The message is what changes when a caller keeps this dialog up to ask again with what the
         daemon refused — `service.delete` and `runtime.uninstall` both do — and the dialog has to
         be back on screen to be read. See `Modal`'s `question`. */
      question={message}
      actions={[
        { kind: "cancel", label: cancelLabel ?? t("common.cancel") },
        {
          /* A destructive confirm keeps its own red and stays outlined: filling it with the accent
             would dress the dangerous choice as the recommended one. */
          kind: danger ? "danger" : "confirm",
          label: confirmLabel ?? t("common.confirm"),
          onClick: onConfirm,
          closes: true,
          /* Not on a destructive one. With focus here, Enter — the key someone is already pressing
             their way through a form with — deletes the thing the dialog is asking about. Left
             off, `Modal` focuses the first control: the ✕, the same answer Escape gives. */
          autoFocus: !danger,
        },
      ]}
    >
      {() => (
        <ModalBody>
          <p className={styles.message}>{message}</p>
          {children}
        </ModalBody>
      )}
    </Modal>
  );
}

export default ConfirmDialog;
