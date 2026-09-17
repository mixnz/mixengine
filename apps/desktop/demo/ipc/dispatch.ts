/**
 * The demo's answer to every IPC call the app makes.
 *
 * Pure on purpose — no `window`, no Tauri import — so what decides a scene's failure can be tested
 * in node. `install.ts` is the one place that wires it into `mockIPC`.
 */

export type Args = Record<string, any>;
export type Handler = (args: Args) => unknown;
export type Handlers = Record<string, Handler>;

/** What the capture script reads back out of the page. */
export interface Probe {
  /** Calls started and not yet settled. */
  inFlight: number;
  /** Calls ever started. A change here is IPC activity even when `inFlight` is back to zero. */
  calls: number;
  /** The command names still in flight, for the readiness timeout's message. */
  pending: string[];
  /** Commands no fixture answers — each one is a fixture to write. */
  unmocked: { cmd: string; args: string }[];
  /** Messages the app logged at error level: a crashed ErrorBoundary, a window error, an
   *  unhandled rejection — `core/log.ts` sends all of them through `plugin:log|log`. */
  errors: string[];
}

/** `LogLevel.Error` in `@tauri-apps/plugin-log`. */
export const LOG_LEVEL_ERROR = 5;

export function createProbe(): Probe {
  return { inFlight: 0, calls: 0, pending: [], unmocked: [], errors: [] };
}

/** A handler that always answers `value`. Typed, so a fixture that drifts from its contract fails
 *  `tsc` at the place it is written. */
export function returns<T>(value: T): Handler {
  return () => value;
}

function describeArgs(args: Args): string {
  try {
    return JSON.stringify(args);
  } catch {
    return "[arguments that do not serialise]";
  }
}

export function createDispatcher(
  handlers: Handlers,
  probe: Probe,
): (cmd: string, payload?: unknown) => Promise<unknown> {
  return async (cmd, payload) => {
    const args = (payload ?? {}) as Args;
    probe.calls++;
    probe.inFlight++;
    probe.pending.push(cmd);
    try {
      if (cmd === "plugin:log|log" && args.level === LOG_LEVEL_ERROR) {
        probe.errors.push(String(args.message));
      }
      const handler = handlers[cmd];
      if (handler === undefined) {
        probe.unmocked.push({ cmd, args: describeArgs(args) });
        throw new Error(`demo: no fixture answers ${cmd}`);
      }
      return await handler(args);
    } finally {
      probe.inFlight--;
      probe.pending.splice(probe.pending.indexOf(cmd), 1);
    }
  };
}
