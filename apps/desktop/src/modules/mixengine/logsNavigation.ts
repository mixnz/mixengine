/**
 * A one-way bridge from a service row to the Logs screen: "open Logs on service X".
 *
 * Same shape as `sitesNavigation.ts`: Logs keeps its selection locally, so the request waits here
 * until Logs reads it on becoming active. **Taken, not peeked** — read once and cleared, so a later
 * choice made by hand is not overwritten by a stale request.
 */
let pendingService: string | null = null;

export function requestLogsService(service: string): void {
  pendingService = service;
}

export function takePendingLogsService(): string | null {
  const service = pendingService;
  pendingService = null;
  return service;
}
