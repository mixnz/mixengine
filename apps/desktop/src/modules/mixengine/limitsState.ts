import type { Enforcement } from "./api/types/Enforcement";

export type EnforcementDisplay = "hard" | "unsupported" | "unavailable" | "advisory";

export function enforcementKind(enforcement: Enforcement): EnforcementDisplay {
  return enforcement.kind;
}

/** Chỉ `unavailable` và `advisory` mang lý do; `null` nghĩa là không có gì để nói thêm, không phải
 *  chỗ để bịa một câu. */
export function enforcementReason(enforcement: Enforcement): string | null {
  if (enforcement.kind === "unavailable") return enforcement.why;
  if (enforcement.kind === "advisory") return enforcement.why;
  return null;
}
