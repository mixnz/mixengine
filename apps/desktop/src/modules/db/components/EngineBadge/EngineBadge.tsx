import { DatabaseIcon } from "../../icons";
import type { DbKind } from "../../types";
import styles from "./EngineBadge.module.css";

interface Props {
  kind: DbKind;
  size?: 28 | 30 | 38 | 52;
  className?: string;
}

/**
 * An engine's logo in a tinted square — the database module's counterpart of `MonogramBadge`.
 *
 * The logo rather than two letters: every engine here has a mark people already know, and a shape
 * recognised from everywhere else beats an abbreviation this app would make up. The tint and the
 * mark's colour come from the `.kind-*` class in `db.css`. Decorative: the engine's name is always
 * written beside it.
 */
function EngineBadge({ kind, size = 30, className }: Props) {
  return (
    <span
      aria-hidden="true"
      className={`${styles.badge} ${styles[`size${size}`]} kind-${kind}${className ? ` ${className}` : ""}`}
    >
      <DatabaseIcon kind={kind} size="55%" />
    </span>
  );
}

export default EngineBadge;
