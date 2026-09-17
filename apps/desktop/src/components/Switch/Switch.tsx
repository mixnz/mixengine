import styles from "./Switch.module.css";

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** The table-row size, 38×22. A matter of where it sits, not of density. */
  small?: boolean;
  id?: string;
  "aria-label"?: string;
  /** The id of the row's own label, which is usually what names a switch. */
  "aria-labelledby"?: string;
  title?: string;
}

/** An on/off setting that takes effect as it is flipped. A real `<button aria-pressed>`, so Tab
 *  reaches it and Space flips it without any help. */
function Switch({ checked, onChange, disabled, small, id, title, ...aria }: Props) {
  return (
    <button
      type="button"
      id={id}
      title={title}
      className={`${styles.switch}${small ? ` ${styles.small}` : ""}${checked ? ` ${styles.on}` : ""}`}
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      {...aria}
    >
      <span className={styles.knob} />
    </button>
  );
}

export default Switch;
