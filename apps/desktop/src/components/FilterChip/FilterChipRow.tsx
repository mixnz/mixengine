import { useRef, type ReactNode } from "react";
import { useStripScroll } from "../TabStrip";
import styles from "./FilterChip.module.css";

interface Props {
  children: ReactNode;
  className?: string;
}

/** A row of `FilterChip`s that never wraps. Chips past the edge scroll sideways, with the same
 *  wheel handling as a tab strip — a plain vertical notch moves the row — and a fade on whichever
 *  side still hides some. No arrows: a row of chips sits in narrow places, where two arrows would
 *  take the room of a chip. */
function FilterChipRow({ children, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { atStart, atEnd } = useStripScroll(ref);
  return (
    // `data-hscroll` keeps `core/scroll.ts` from handing this row's notches to the pane behind it.
    <div
      ref={ref}
      className={`${styles.row}${className ? ` ${className}` : ""}`}
      data-hscroll=""
      data-fade-start={atStart ? undefined : ""}
      data-fade-end={atEnd ? undefined : ""}
    >
      {children}
    </div>
  );
}

export default FilterChipRow;
