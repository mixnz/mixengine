import type { SVGProps } from "react";
import styles from "./Icon.module.css";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "viewBox" | "children"> {
  /** Edge length as any CSS length. Defaults to `1em`, so an icon tracks the font size of
   * whatever it sits in — the existing `font-size` on a button or badge keeps sizing it, the
   * same way it sized the glyph the icon replaced. */
  size?: number | string;
}

interface IconBaseProps extends IconProps {
  children: SVGProps<SVGSVGElement>["children"];
}

/** The frame every icon in `src/icons` is drawn in: a 24×24 grid, stroked in `currentColor`
 * at a uniform weight, with round caps and joins.
 *
 * Icons are inline SVG rather than glyphs because a glyph is drawn by whichever font the OS
 * resolves it to — emoji especially, which macOS renders in full colour and Windows in its own
 * quite different design, at its own size, ignoring `color` entirely. The same markup here
 * paints identically everywhere and inherits the colour of the control it sits in, so states
 * like "marked for deletion" can tint it.
 *
 * Every icon is `aria-hidden`: they are decoration on top of a control that already carries its
 * own accessible name (`title` / `aria-label`), so announcing them again would only add noise. */
export function Icon({ size = "1em", className, children, ...rest }: IconBaseProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
      className={className ? `${styles.icon} ${className}` : styles.icon}
    >
      {children}
    </svg>
  );
}

export default Icon;
