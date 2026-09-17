import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

interface Props {
  title: ReactNode;
  description?: ReactNode;
  /** What would put something here, or undo the filter that emptied it. */
  action?: ReactNode;
  /** Drawn on its own dashed outline, for an empty state that stands on the page rather than
   *  inside a card. */
  outlined?: boolean;
}

/** Nothing to show, said as a sentence with a way forward — never a blank area. */
function EmptyState({ title, description, action, outlined }: Props) {
  return (
    <div className={`${styles.empty}${outlined ? ` ${styles.outlined}` : ""}`}>
      <p className={styles.title}>{title}</p>
      {description !== undefined && <p className={styles.description}>{description}</p>}
      {action !== undefined && <div className={styles.action}>{action}</div>}
    </div>
  );
}

export default EmptyState;
