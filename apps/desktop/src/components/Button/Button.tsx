import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

export type ButtonSize = "small" | "normal" | "large";

/** `primary` fills with the accent — the one action a screen is asking for, at most one per view.
 *
 * `link` drops the surface entirely and draws as the text it wraps: for a value in a table that is
 * also an action — a domain that opens the site — where a button's chrome on every row would read
 * as a toolbar rather than as a column. It is still a `<button>`, so it is reached by Tab and
 * fires on Space, which an `<a>` styled to look the same would not be without help. */
export type ButtonVariant = "default" | "primary" | "link";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: ButtonSize;
  variant?: ButtonVariant;
}

function Button({ size = "normal", variant = "default", type = "button", className, ...rest }: ButtonProps) {
  const variantClass = variant === "default" ? "" : ` ${styles[variant]}`;
  return (
    <button
      type={type}
      className={`${styles.button} ${styles[size]}${variantClass}${className ? ` ${className}` : ""}`}
      {...rest}
    />
  );
}

export default Button;
