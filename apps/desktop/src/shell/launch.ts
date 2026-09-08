import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * A tab the backend asks the shell to open.
 *
 * The one way in for a tab nobody clicked for: a connection MixEngine handed over on the command
 * line, or over the channel from a second copy of the app that has since exited. `state` is the
 * module's own and goes into the same slot `restored` fills between launches — the shell carries it
 * to the tab and does not read it, exactly as with the session.
 *
 * Requests are queued on the Rust side and drained from here, rather than delivered in the event:
 * the request that came with the process was queued before this webview existed, and an event
 * fired then had nobody to hear it. So `launch://request` only says "look", and the looking is
 * the same call the shell makes once on mount.
 */
export interface TabRequest {
  moduleId: string;
  state: unknown;
}

/** The request, if it is one for a module this app has, or `null`. Pure, like `parseSession`. */
export function parseTabRequest(value: unknown, knownModuleIds: string[]): TabRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (typeof request.moduleId !== "string" || !knownModuleIds.includes(request.moduleId)) return null;
  return { moduleId: request.moduleId, state: request.state };
}

/** Every request made since the last call, oldest first, minus any this app cannot draw. */
export async function takeTabRequests(knownModuleIds: string[]): Promise<TabRequest[]> {
  const raw = await invoke<unknown[]>("launch_take_requests");
  return raw
    .map((request) => parseTabRequest(request, knownModuleIds))
    .filter((request): request is TabRequest => request !== null);
}

/** Runs `callback` each time the backend has queued something. */
export function onTabRequest(callback: () => void): Promise<UnlistenFn> {
  return listen("launch://request", () => callback());
}
