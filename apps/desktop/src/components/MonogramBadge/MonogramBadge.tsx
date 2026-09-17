import { monogramHue, monogramLetters } from "./monogram";
import styles from "./MonogramBadge.module.css";

export type MonogramSize = 28 | 30 | 34 | 38 | 50;

interface Props {
  /** The name the letters and the hue are taken from — a package, a service, a blueprint. */
  name: string;
  size?: MonogramSize;
  className?: string;
}

/** Two letters in a tinted square: a name made recognisable at a glance in a list or a table.
 *  Decorative — the name it stands for is always written beside it — so it is hidden from
 *  assistive technology. */
function MonogramBadge({ name, size = 30, className }: Props) {
  const hue = monogramHue(name);
  return (
    <span
      aria-hidden="true"
      className={`${styles.badge} ${styles[`size${size}`]} ${hue === null ? styles.neutral : styles[hue]}${
        className ? ` ${className}` : ""
      }`}
    >
      {monogramLetters(name)}
    </span>
  );
}

export default MonogramBadge;
