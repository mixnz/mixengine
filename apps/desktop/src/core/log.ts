import { error as pluginError } from "@tauri-apps/plugin-log";

/**
 * One log line for an uncaught error, with a source (`"react"` from the Error Boundary,
 * `"window"` from `window.onerror`, `"promise"` from `unhandledrejection`) and context when there
 * is any (e.g. React's `ErrorInfo.componentStack`).
 *
 * A pure function, kept apart from the real write (`logError`) so it can be tested without mocking
 * Tauri's IPC.
 */
export function formatLogMessage(source: string, error: unknown, context?: string): string {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return `[${source}] ${message}${context ? `\n${context}` : ""}`;
}

/**
 * Writes an uncaught error to the app's log file (`tauri-plugin-log`, under `appLogDir()`).
 *
 * Swallows a failure of the write itself — a broken crash log must not become a second crash.
 * `console.error` is the only thing left at that point, seen only by whoever has devtools open.
 */
export async function logError(source: string, error: unknown, context?: string): Promise<void> {
  try {
    await pluginError(formatLogMessage(source, error, context));
  } catch {
    console.error(source, error);
  }
}
