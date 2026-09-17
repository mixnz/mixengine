import type { ReactNode } from "react";
import styles from "./SegmentedControl.module.css";

export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  /** A number beside the label — how many rows the filter would leave, say. */
  count?: number;
  disabled?: boolean;
  /** Said on hover — most of all why a disabled segment cannot be picked. */
  title?: string;
}

interface Props<T extends string> {
  segments: readonly Segment<T>[];
  /** `null` when the current state matches none of the segments — a hand-picked set no preset
   *  names — so none of them is shown as chosen. */
  value: T | null;
  onChange: (value: T) => void;
  /**
   * `tabs` when the segments switch what the screen shows, `filter` when they narrow a list that
   * stays on screen. The two are announced differently — a tab list, or a group of toggle buttons
   * — and a screen reader user is told which one they are in.
   */
  mode?: "tabs" | "filter";
  "aria-label": string;
  /** Stretch the segments to fill the width the caller gives the control. */
  block?: boolean;
  className?: string;
}

/** A row of mutually exclusive choices drawn on a sunken track, the selected one raised out of it. */
function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  mode = "filter",
  block,
  className,
  "aria-label": ariaLabel,
}: Props<T>) {
  const tabs = mode === "tabs";
  return (
    <div
      role={tabs ? "tablist" : "group"}
      aria-label={ariaLabel}
      className={`${styles.track}${block ? ` ${styles.block}` : ""}${className ? ` ${className}` : ""}`}
    >
      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <button
            key={segment.value}
            type="button"
            role={tabs ? "tab" : undefined}
            aria-selected={tabs ? selected : undefined}
            aria-pressed={tabs ? undefined : selected}
            disabled={segment.disabled}
            title={segment.title}
            className={`${styles.segment}${selected ? ` ${styles.selected}` : ""}`}
            onClick={() => onChange(segment.value)}
          >
            {segment.icon}
            <span>{segment.label}</span>
            {segment.count !== undefined && <span className={styles.count}>{segment.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
