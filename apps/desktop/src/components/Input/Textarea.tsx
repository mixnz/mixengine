import { useCallback, useLayoutEffect, useRef, type Ref, type TextareaHTMLAttributes } from "react";
import type { InputSize } from "./Input";
import styles from "./Input.module.css";

interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> {
  size?: InputSize;
  /** Whether the box grows to fit its text (the default). Off, it is as tall as its CSS makes it
   *  and nothing is measured. */
  autoHeight?: boolean;
  /** How tall the box may grow before it starts scrolling instead. */
  maxRows?: number;
  /** Set in the mono face, as `Input`'s `mono`. */
  mono?: boolean;
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
  autoHeight = true,
  maxRows = 10,
  mono = false,
  className,
  value,
  ref,
  ...rest
}: TextareaProps) {
  const innerRef = useRef<HTMLTextAreaElement>(null);

  const fit = useCallback(() => {
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
  }, [maxRows]);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    if (!autoHeight) {
      // Whatever an earlier render with autoHeight on wrote, so the CSS height applies again.
      el.style.height = "";
      el.style.overflowY = "";
      return;
    }
    fit();
  }, [value, autoHeight, fit]);

  /* How many lines the text wraps to depends on the width too: a box measured before its dialog
     settled, or one whose window was narrowed, is fitted again. Width only — `fit` sets the height,
     and reacting to that would be a loop. */
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el || !autoHeight) return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [autoHeight, fit]);

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
      className={`${styles.input} ${styles[size]} ${styles.textarea}${mono ? ` ${styles.mono}` : ""}${className ? ` ${className}` : ""}`}
      {...rest}
    />
  );
}

export default Textarea;
