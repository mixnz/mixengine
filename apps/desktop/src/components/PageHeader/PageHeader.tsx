import type { ReactNode } from "react";
import styles from "./PageHeader.module.css";

interface Props {
  title: ReactNode;
  /** Pills and badges beside the title — a version, a summary of state. */
  badges?: ReactNode;
  /** One line under the title saying what the screen is for. */
  description?: ReactNode;
  /** Anything under the description that belongs to the title rather than to the page — a path. */
  meta?: ReactNode;
  /** The screen's own actions, aligned to the bottom right. */
  actions?: ReactNode;
  /** A badge or icon before the title, for a detail pane that names one thing. */
  leading?: ReactNode;
}

/** The top of a screen: what it is, what state it is in, and what can be done from it. */
function PageHeader({ title, badges, description, meta, actions, leading }: Props) {
  return (
    <header className={styles.header}>
      <div className={styles.lead}>
        {leading}
        <div className={styles.text}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{title}</h1>
            {badges}
          </div>
          {description !== undefined && <p className={styles.description}>{description}</p>}
          {meta}
        </div>
      </div>
      {actions !== undefined && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}

export default PageHeader;
