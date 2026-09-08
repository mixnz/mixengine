import styles from "./ServerInfoLabel.module.css";

interface Props {
  /** Already-translated "os · engine version" text. */
  text: string;
}

/**
 * The OS/engine/version line shown beside the database selector, truncated with an ellipsis.
 *
 * Rendered twice: `truncated` is what normally shows and is what sizes this component, so hovering
 * never changes the space it takes up next to the selector. `full` is the same text, absolutely
 * positioned over it and hidden until hover — being absolute, it can grow to its own full width
 * without affecting that size, and its z-index lets it paint over the selector rather than being
 * pushed by it.
 */
function ServerInfoLabel({ text }: Props) {
  return (
    <span className={styles.label}>
      <span className={styles.truncated}>{text}</span>
      <span className={styles.full}>{text}</span>
    </span>
  );
}

export default ServerInfoLabel;
