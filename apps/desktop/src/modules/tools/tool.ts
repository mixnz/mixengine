import type { ComponentType } from "react";
import type { TranslationKey } from "../../i18n";

/** Năm ngăn của sidebar, theo thứ tự chúng hiện ra. */
export type ToolGroup = "data" | "encode" | "time" | "infra" | "text";

export const TOOL_GROUPS: ToolGroup[] = ["data", "encode", "time", "infra", "text"];

/**
 * Một tool trong module.
 *
 * `Panel` không nhận prop nào, và đó là chủ ý: một tool không cần biết nó ở tab nào hay tab có
 * đang hiện không — nó là một ô vào và một ô ra. Hợp đồng nhỏ đến mức này là thứ giữ cho việc
 * thêm tool thứ 15 vẫn là một file cộng một dòng trong `registry.ts`.
 */
export interface ToolDefinition {
  id: string;
  labelKey: TranslationKey;
  group: ToolGroup;
  Panel: ComponentType;
}
