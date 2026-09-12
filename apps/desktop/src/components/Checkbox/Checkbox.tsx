import { useEffect, useRef, type ComponentPropsWithRef, type ReactNode } from "react";
import styles from "./Checkbox.module.css";

export type CheckboxSize = "small" | "normal";

/** Includes `ref`, which rides along onto the underlying input — a caller that needs the element
 * itself (to move focus to a row's box) has no other way to reach it. */
interface CheckboxProps extends Omit<ComponentPropsWithRef<"input">, "type" | "size"> {
  /** Text beside the box. With it the component draws its own `<label>`, so the caption toggles
   *  the box too; without it the box stands alone — a table's select column — and the caller owns
   *  the accessible name through `aria-label`. */
  label?: ReactNode;
  size?: CheckboxSize;
  /** Neither checked nor unchecked, drawn as a dash. It is a DOM property with no attribute
   *  behind it, so it can only be set on the node once it exists. */
  indeterminate?: boolean;
}

function Checkbox({ size = "normal", label, indeterminate = false, className, ref, ...rest }: CheckboxProps) {
  const innerRef = useRef<HTMLInputElement>(null);

  // Every render, not just when `indeterminate` changes: clicking the box clears the property in
  // the DOM without the prop moving, so a dependency list would leave the dash gone for good.
  useEffect(() => {
    if (innerRef.current) innerRef.current.indeterminate = indeterminate;
  });

  // React 19 passes `ref` through as a plain prop, so it is taken out of `rest` above and
  // forwarded by hand — the component keeps one of its own for the tri-state property.
  function setRef(node: HTMLInputElement | null) {
    innerRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }

  const input = (
    <input
      ref={setRef}
      type="checkbox"
      className={`${styles.input}${label === undefined ? ` ${styles[size]}${className ? ` ${className}` : ""}` : ""}`}
      {...rest}
    />
  );

  // The box alone: no caption to wrap, and no `<label>` to swallow a click meant for the row.
  if (label === undefined) return input;

  return (
    <label
      // Also on the row, not only on the box: a tooltip explaining why the row is the way it is
      // is read by hovering the caption, which is most of what there is to hover.
      title={rest.title}
      className={`${styles.label} ${styles[size]}${className ? ` ${className}` : ""}`}
    >
      {input}
      <span className={styles.text}>{label}</span>
    </label>
  );
}

export default Checkbox;
