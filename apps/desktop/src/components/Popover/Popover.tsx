import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { isUnhandledEscape } from "../dialogMotion";
import styles from "./Popover.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The control that opened it. A press on it is not an outside press — it is the toggle — and
   *  focus goes back to it when the popover closes by Escape. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Read aloud as the panel's name. */
  label: string;
  /** Which edge of the anchor's wrapper the panel lines up with. */
  align?: "start" | "end";
  /** Width and any padding of the caller's own; the panel only supplies the surface. */
  className?: string;
  children: ReactNode;
}

/**
 * A panel anchored under a control — the surface a `Select` menu and a `ContextMenu` are drawn on,
 * for content that is neither a list of options nor a menu of actions: the database engine picker,
 * a short confirmation beside the button that asked for it.
 *
 * Positioned against the nearest positioned ancestor, so the caller wraps the anchor and the popover
 * in one `position: relative` box. Escape and a press anywhere outside close it.
 */
function Popover({ open, onClose, anchorRef, label, align = "start", className, children }: Props) {
  const panel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (!isUnhandledEscape(e)) return;
      e.preventDefault();
      onClose();
      anchorRef.current?.focus();
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (panel.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label={label}
      className={`${styles.popover} ${align === "end" ? styles.end : styles.start}${className ? ` ${className}` : ""}`}
    >
      {children}
    </div>
  );
}

export default Popover;
