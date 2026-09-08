import { useRef, type ComponentPropsWithRef } from "react";
import { CloseIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import styles from "./Input.module.css";

export type InputSize = "small" | "normal" | "large";

/** Includes `ref`, which rides along in the rest props onto the underlying input — a caller that
 * needs to move focus here (the filter bar does) has no other way to reach the element. */
interface InputProps extends Omit<ComponentPropsWithRef<"input">, "size"> {
  size?: InputSize;
  /** Shows a × at the end of the field once there is a value, clearing it on click. Only makes
   *  sense on a controlled field — the caller's own `onChange` is what actually empties `value`. */
  allowClear?: boolean;
}

function Input({
  size = "normal",
  type = "text",
  autoComplete = "off",
  autoCorrect = "off",
  autoCapitalize = "off",
  spellCheck = false,
  className,
  allowClear = false,
  value,
  ref,
  ...rest
}: InputProps) {
  const { t } = useTranslation();
  const innerRef = useRef<HTMLInputElement>(null);

  // `allowClear` needs the actual DOM node — to clear it the same way a keystroke would, not just
  // to hide the field from the caller's own `ref`. React 19 passes `ref` through as a plain prop,
  // so it is taken out of `rest` above and forwarded here by hand.
  function setRef(node: HTMLInputElement | null) {
    innerRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }

  const input = (
    <input
      ref={allowClear ? setRef : ref}
      type={type}
      autoComplete={autoComplete}
      autoCorrect={autoCorrect}
      autoCapitalize={autoCapitalize}
      spellCheck={spellCheck}
      value={value}
      className={`${styles.input} ${styles[size]}${allowClear ? ` ${styles.clearable}` : ""}${
        !allowClear && className ? ` ${className}` : ""
      }`}
      {...rest}
    />
  );

  if (!allowClear) return input;

  function clear() {
    const el = innerRef.current;
    if (!el) return;
    // Set the value through the native setter and dispatch a real `input` event, so the caller's
    // `onChange` fires exactly as it would from typing — not a hand-built event React would not
    // otherwise have produced.
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setValue?.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
  }

  return (
    <span className={`${styles.clearWrap}${className ? ` ${className}` : ""}`}>
      {input}
      {typeof value === "string" && value.length > 0 && (
        <button type="button" className={styles.clearButton} aria-label={t("input.clear")} onClick={clear}>
          <CloseIcon size="0.9em" />
        </button>
      )}
    </span>
  );
}

export default Input;
