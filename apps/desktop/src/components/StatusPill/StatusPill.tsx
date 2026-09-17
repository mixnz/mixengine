import type { ReactNode } from "react";
import styles from "./StatusPill.module.css";

export type StatusTone = "success" | "warning" | "danger" | "neutral";

interface Props {
  tone: StatusTone;
  children: ReactNode;
  /** The dot breathes: a state that is on its way somewhere — starting, stopping, issuing. */
  pulse?: boolean;
  title?: string;
  className?: string;
}

/** A state in a word and a dot. The word carries the meaning; the colour only makes it quicker to
 *  find, so a pill is never colour alone. */
function StatusPill({ tone, children, pulse, title, className }: Props) {
  return (
    <span className={`${styles.pill} ${styles[tone]}${className ? ` ${className}` : ""}`} title={title}>
      <span className={`${styles.dot}${pulse ? ` ${styles.pulse}` : ""}`} aria-hidden="true" />
      {children}
    </span>
  );
}

export default StatusPill;
