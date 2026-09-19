import type { ReactNode } from "react";
import surface from "./surface.module.css";

interface Props {
  children: ReactNode;
  /** A caller's own inner layout — a grid of fields, say. Never the frame: that is `Modal`'s. */
  className?: string;
  /** The body does not scroll; it hands its child the height left, for a list or panes that
   *  scroll themselves. */
  fill?: boolean;
  /** Runs to the dialog's edges under a dividing line, for a layout that draws its own. */
  flush?: boolean;
}

/** A dialog's body: the one part of it that scrolls, so the title and the buttons never do. */
function ModalBody({ children, className, fill, flush }: Props) {
  const classes = [surface.body];
  if (fill || flush) classes.push(surface.fill);
  if (flush) classes.push(surface.flush);
  if (className) classes.push(className);
  return <div className={classes.join(" ")}>{children}</div>;
}

export default ModalBody;
