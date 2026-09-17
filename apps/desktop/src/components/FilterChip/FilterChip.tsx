import type { ReactNode } from "react";
import styles from "./FilterChip.module.css";

interface Props {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  /** How many items the chip stands for. */
  count?: number;
  /** A small mark before the label — an engine's colour dot, say. */
  leading?: ReactNode;
  disabled?: boolean;
  title?: string;
}

/** One of several independent filters that narrow a list. Unlike a segmented control, any number
 *  of chips may be on at once, and each is its own toggle button. */
function FilterChip({ pressed, onClick, children, count, leading, disabled, title }: Props) {
  return (
    <button
      type="button"
      className={`${styles.chip}${pressed ? ` ${styles.pressed}` : ""}`}
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {leading}
      {children}
      {count !== undefined && <span className={styles.count}>{count}</span>}
    </button>
  );
}

export default FilterChip;
