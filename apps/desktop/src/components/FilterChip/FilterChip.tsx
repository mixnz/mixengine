import type { ReactNode } from "react";
import Tooltip from "../Tooltip";
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
  /** Draw only `leading` and `count`, for a row of chips that has to fit on one line. The label
   *  stays in the DOM as the button's accessible name, and `title` — required here, since the
   *  mark alone has to be explained to someone who does not recognise it — becomes a tooltip. */
  compact?: boolean;
}

/** One of several independent filters that narrow a list. Unlike a segmented control, any number
 *  of chips may be on at once, and each is its own toggle button. */
function FilterChip({ pressed, onClick, children, count, leading, disabled, title, compact }: Props) {
  const chip = (
    <button
      type="button"
      className={`${styles.chip}${compact ? ` ${styles.compact}` : ""}${pressed ? ` ${styles.pressed}` : ""}`}
      aria-pressed={pressed}
      disabled={disabled}
      title={compact ? undefined : title}
      onClick={onClick}
    >
      {leading}
      {compact ? <span className="visually-hidden">{children}</span> : children}
      {count !== undefined && <span className={styles.count}>{count}</span>}
    </button>
  );
  return compact && title ? <Tooltip text={title}>{chip}</Tooltip> : chip;
}

export default FilterChip;
