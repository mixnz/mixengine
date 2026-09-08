/**
 * Thứ một tab MixEngine mang sang lần chạy sau.
 *
 * **Ids only.** Đây là `localStorage`: không host, không mật khẩu, không URL, không endpoint. Shell
 * truyền slot này qua mà không kiểm gì, nên `parseMixEngineTabState` là chỗ việc kiểm sống — xem
 * `docs/superpowers/specs/2026-08-23-tab-session-context-design.md`.
 */
export type MixEngineScreen =
  | "dashboard"
  | "projects"
  | "sites"
  | "domains"
  | "runtimes"
  | "servicesDetail"
  | "logs"
  | "blueprints"
  | "extensions"
  | "metrics"
  | "settings";

export interface MixEngineTabState {
  screen: MixEngineScreen;
}

const SCREENS: readonly MixEngineScreen[] = [
  "dashboard",
  "projects",
  "sites",
  "domains",
  "runtimes",
  "servicesDetail",
  "logs",
  "blueprints",
  "extensions",
  "metrics",
  "settings",
];

/** Slot shell trả lại từ lần chạy trước, đã kiểm. `undefined` nghĩa là không dùng được. */
export function parseMixEngineTabState(value: unknown): MixEngineTabState | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const screen = (value as { screen?: unknown }).screen;
  return SCREENS.includes(screen as MixEngineScreen)
    ? { screen: screen as MixEngineScreen }
    : undefined;
}
