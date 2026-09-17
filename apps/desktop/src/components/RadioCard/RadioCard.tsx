import type { ReactNode } from "react";
import styles from "./RadioCard.module.css";

interface Props {
  /** The group the choice belongs to — every card of one question shares it. */
  name: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: ReactNode;
  /** A sentence under the label. */
  description?: ReactNode;
  /** Something that belongs to this choice alone, drawn at the end of the card — a number to type. */
  children?: ReactNode;
}

/** One of a few mutually exclusive choices, drawn as a card with its own radio. A real
 *  `<input type="radio">`, so the arrow keys move between the cards of one group. */
function RadioCard({ name, checked, onChange, disabled, label, description, children }: Props) {
  return (
    <label
      className={`${styles.card}${checked ? ` ${styles.checked}` : ""}${disabled ? ` ${styles.disabled}` : ""}`}
    >
      <input
        type="radio"
        className={styles.radio}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {description !== undefined && <span className={styles.description}>{description}</span>}
      </span>
      {children !== undefined && <span className={styles.extra}>{children}</span>}
    </label>
  );
}

export default RadioCard;
