import type { ComponentType } from "react";
import type { IconProps } from "../../icons";
import styles from "./ActionBar.module.css";

export interface ActionBarAction {
  /** Distinguishes this action from the others in the bar. */
  key: string;
  /** One of the icons from `src/icons` — the button shows nothing but this. */
  icon: ComponentType<IconProps>;
  /** Tooltip and accessible name, since the icon alone carries no text. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Why it is greyed out, replacing the label as the tooltip. An icon-only button with no text
   *  and no reason is a dead end — the same rule the item menus follow. */
  disabledHint?: string;
  /** Spins the icon while the action is running. */
  busy?: boolean;
  /** Paints the button as destructive. For actions that lose data, not merely risky ones. */
  danger?: boolean;
}

interface Props {
  actions: ActionBarAction[];
  className?: string;
}

/** A row of icon-only buttons, the same shape the table and collection sidebars use for their
 * own actions. Kept generic so a bar can grow past the single reload it starts with. */
function ActionBar({ actions, className }: Props) {
  return (
    <div className={`${styles.bar}${className ? ` ${className}` : ""}`}>
      {actions.map(({ key, icon: ActionIcon, label, onClick, disabled, disabledHint, busy, danger }) => (
        <button
          key={key}
          type="button"
          className={danger ? `${styles.action} ${styles.danger}` : styles.action}
          // The label stays the accessible name whatever the state: it is what the button *is*,
          // while the hint is only why it cannot be pressed right now.
          aria-label={label}
          title={disabled && disabledHint ? disabledHint : label}
          disabled={disabled}
          onClick={onClick}
        >
          <ActionIcon size={14} className={busy ? styles.spinning : undefined} />
        </button>
      ))}
    </div>
  );
}

export default ActionBar;
