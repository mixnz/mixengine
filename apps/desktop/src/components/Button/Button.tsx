import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

export type ButtonSize = "small" | "normal" | "large";

/** `primary` fills with the accent — the one action a screen is asking for, at most one per view. */
export type ButtonVariant = "default" | "primary";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: ButtonSize;
  variant?: ButtonVariant;
}

function Button({ size = "normal", variant = "default", type = "button", className, ...rest }: ButtonProps) {
  const variantClass = variant === "primary" ? ` ${styles.primary}` : "";
  return (
    <button
      type={type}
      className={`${styles.button} ${styles[size]}${variantClass}${className ? ` ${className}` : ""}`}
      {...rest}
    />
  );
}

export default Button;
