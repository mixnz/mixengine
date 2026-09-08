import { useLayoutEffect, useRef, type Ref, type TextareaHTMLAttributes } from "react";
import type { InputSize } from "./Input";
import styles from "./Input.module.css";

interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> {
  size?: InputSize;
  /** How tall the box may grow before it starts scrolling instead. */
  maxRows?: number;
  ref?: Ref<HTMLTextAreaElement>;
}

/** A textarea styled as an Input, sized to its content: it starts one line tall and grows as
 * the text wraps, so a long value is readable without turning every short one into a big box. */
function Textarea({
  size = "normal",
  autoComplete = "off",
  autoCorrect = "off",
  autoCapitalize = "off",
  spellCheck = false,
  maxRows = 10,
  className,
  value,
  ref,
  ...rest
}: TextareaProps) {
  const innerRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    // scrollHeight only ever reports the content as at least as tall as the box already is,
    // so the box has to be collapsed first for the text to be measured on the way back down.
    el.style.height = "auto";
    const cs = getComputedStyle(el);
    const borders = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
    const padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const max = lineHeight * maxRows + padding;
    el.style.height = `${Math.min(el.scrollHeight, max) + borders}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [value, maxRows]);

  return (
    <textarea
      ref={(node) => {
        innerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      rows={1}
      autoComplete={autoComplete}
      autoCorrect={autoCorrect}
      autoCapitalize={autoCapitalize}
      spellCheck={spellCheck}
      value={value}
      className={`${styles.input} ${styles[size]} ${styles.textarea}${className ? ` ${className}` : ""}`}
      {...rest}
    />
  );
}

export default Textarea;
