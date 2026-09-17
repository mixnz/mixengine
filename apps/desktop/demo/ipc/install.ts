import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { handlers } from "../fixtures";
import { createDispatcher, createProbe, type Probe } from "./dispatch";

declare global {
  interface Window {
    /** Read by `demo/capture.mjs`: readiness, unanswered commands, app errors. */
    __demo: Probe;
  }
}

const probe = createProbe();
window.__demo = probe;
mockWindows("main");
mockIPC(createDispatcher(handlers, probe), { shouldMockEvents: true });
