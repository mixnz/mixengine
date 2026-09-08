import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { isUnhandledEscape, useDialogExit } from "../dialogMotion";
import { FOCUSABLE, nextFocusIndex } from "./focus";

interface ModalProps {
  /** Read aloud in place of the dialog's own text. */
  label: string;
  /** What the dialog closing means. Called after the exit animation, not at the key press. */
  onClose: () => void;
  /**
   * Nothing may close it for now — a request is in flight, and closing would leave the user with
   * no way to see how it went. Escape and the overlay go quiet; the dialog's own buttons are the
   * caller's to disable.
   */
  locked?: boolean;
  /** The two classes the dialog is drawn with. Each caller keeps its own geometry; what is shared
   *  here is the behaviour, which is why these are passed rather than fixed. */
  overlayClassName: string;
  className: string;
  /** The dialog's contents. Given `close`, which is how a Cancel button sees the dialog out with
   *  the same animation Escape does. */
  children: (close: (reply: () => void) => void) => ReactNode;
}

/**
 * A dialog: the overlay, the portal, Escape, and the keyboard staying inside it.
 *
 * Thirteen dialogs had their own copy of the first three. None of them had the fourth — focus was
 * left wherever it happened to be, Tab walked straight out into the page behind, and closing the
 * dialog left the user with no focus at all, which for anyone on a keyboard means starting again
 * from the top of the document.
 *
 * Rendered into `document.body` rather than in place: the dialog is fixed to the viewport, and a
 * caller deep inside a scrolling panel shouldn't have to care whether some ancestor of theirs
 * establishes a containing block for it.
 */
function Modal({ label, onClose, locked, overlayClassName, className, children }: ModalProps) {
  const { close, cls, onEntered } = useDialogExit();
  const dialog = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isUnhandledEscape(e) && !locked) close(onClose);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, onClose, locked]);

  /**
   * Focus in on the way up, and back where it was on the way out.
   *
   * A caller's own `autoFocus` wins, and the check for that is the whole trick: React applies it
   * while it commits, which is before this effect runs, so a dialog that asked for a particular
   * field already has focus in it by now. Stepping in only when nothing inside took focus is what
   * lets both rules hold at once — the caller decides when it has an opinion, and a dialog with
   * none still opens with its first control ready rather than with focus on the page behind.
   *
   * Restoring is the half that is easy to leave out and the half a keyboard user feels: without
   * it, closing a dialog drops focus onto `<body>` and the next Tab starts at the top of the app.
   */
  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    const box = dialog.current;
    if (box && !box.contains(document.activeElement)) {
      (box.querySelector<HTMLElement>(FOCUSABLE) ?? box).focus();
    }
    return () => {
      // Only if it is still there to go back to — the control that opened the dialog may have been
      // a row the dialog itself has just deleted.
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, []);

  /** Tab, kept inside. On the dialog rather than on the window, so a press that reaches here is
   *  one nothing inside the dialog wanted for itself. */
  function trapTab(e: React.KeyboardEvent) {
    if (e.key !== "Tab") return;
    const box = dialog.current;
    if (!box) return;
    const stops = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const next = nextFocusIndex(stops.length, stops.indexOf(document.activeElement as HTMLElement), e.shiftKey);
    if (next < 0) return;
    e.preventDefault();
    stops[next].focus();
  }

  return createPortal(
    <>
      <div className={cls(overlayClassName)} onClick={locked ? undefined : () => close(onClose)} />
      <div
        ref={dialog}
        className={cls(className)}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        /* So focus has somewhere to land in a dialog with no controls of its own, and so the
           restore above has something to take it from. Not a Tab stop — see `FOCUSABLE`. */
        tabIndex={-1}
        onKeyDown={trapTab}
        onAnimationEnd={onEntered}
      >
        {children(close)}
      </div>
    </>,
    document.body,
  );
}

export default Modal;
