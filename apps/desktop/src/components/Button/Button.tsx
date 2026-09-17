import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

export type ButtonSize = "small" | "normal" | "large";

/**
 * - `default` — the secondary button: a surface of its own and a hairline.
 * - `primary` — filled with the accent. The one action a screen is asking for, at most one per view.
 * - `soft` — an accent wash with accent text: an action that belongs to the accent without being
 *   the one action (Install, Apply, Share).
 * - `ghost` — no surface until hovered: icon buttons and quiet row actions.
 * - `danger` — outlined, red text, red wash on hover. For actions that lose something.
 * - `positive` — a success wash: starting something that is stopped.
 * - `link` — drops the surface entirely and draws as the text it wraps: a value in a table that is
 *   also an action. Still a `<button>`, so Tab reaches it and Space fires it.
 */
export type ButtonVariant = "default" | "primary" | "soft" | "ghost" | "danger" | "positive" | "link";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: ButtonSize;
  variant?: ButtonVariant;
  /** Work in flight. The label replaces the children beside three pulsing dots, and the button is
   *  disabled until the caller clears it — a second press cannot start the same thing twice. */
  busy?: string;
}

function Button({
  size = "normal",
  variant = "default",
  type = "button",
  className,
  busy,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const classes = [styles.button, styles[size]];
  if (variant !== "default") classes.push(styles[variant]);
  if (busy !== undefined) classes.push(styles.busy);
  if (className) classes.push(className);
  return (
    <button
      type={type}
      className={classes.join(" ")}
      disabled={disabled || busy !== undefined}
      aria-busy={busy !== undefined || undefined}
      {...rest}
    >
      {busy === undefined ? (
        children
      ) : (
        <>
          <span className={styles.dots} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {busy}
        </>
      )}
    </button>
  );
}

export default Button;
