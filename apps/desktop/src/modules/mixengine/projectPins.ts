import type { ProjectPin } from "./api/types/ProjectPin";
import type { RuntimeKind } from "./api/types/RuntimeKind";

/**
 * Một `ProjectPin` thành thứ vẽ được — không suy ra `resolvedVersion` từ `constraint` phía client,
 * chỉ đọc lại đúng những gì daemon đã tính.
 */
export interface FormattedPin {
  kind: RuntimeKind;
  constraint: string;
  sourceLabel: "manifest" | "row";
  sourcePath?: string;
  resolvedVersion?: string;
  hint?: string;
}

export function formatPins(pins: ProjectPin[]): FormattedPin[] {
  return pins.map((pin) => ({
    kind: pin.kind,
    constraint: pin.constraint,
    sourceLabel: pin.source.from === "manifest" ? "manifest" : "row",
    sourcePath: pin.source.from === "manifest" ? pin.source.path : undefined,
    resolvedVersion: pin.resolved ?? undefined,
    hint: pin.hint ?? undefined,
  }));
}
