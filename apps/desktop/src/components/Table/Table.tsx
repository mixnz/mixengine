import type { ReactNode } from "react";
import styles from "./Table.module.css";

interface Props {
  /** `<thead>` and `<tbody>` as usual. A cell that should hug the right edge — a column of
   *  actions, a number — takes `data-align="end"`; a cell whose content should not wrap takes
   *  `data-nowrap`. */
  children: ReactNode;
  "aria-label"?: string;
  /** The header row stays in view while the rows scroll under it. */
  stickyHeader?: boolean;
  className?: string;
}

/**
 * A table of things a screen manages — services, sites, runtimes — at the row height the density
 * tokens give it. Semantic `<table>` markup rather than a grid of divs: a screen reader walks it by
 * row and column, which is the point of it being a table.
 *
 * Not the `db` result grid, which is virtualised and has needs of its own; that one takes the
 * tokens only.
 */
function Table({ children, stickyHeader, className, "aria-label": ariaLabel }: Props) {
  return (
    <div className={`${styles.wrap}${className ? ` ${className}` : ""}`}>
      <table className={`${styles.table}${stickyHeader ? ` ${styles.sticky}` : ""}`} aria-label={ariaLabel}>
        {children}
      </table>
    </div>
  );
}

export default Table;
