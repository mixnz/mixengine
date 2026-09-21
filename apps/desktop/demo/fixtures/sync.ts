import type { SyncStatus } from "../../src/shell/sync/api";
import { returns, type Handlers } from "../ipc/dispatch";

/** Signed out: the workspace reads both at launch, and signed out draws no closing-date banner. */
const signedOut: SyncStatus = {
  signedIn: false,
  server: null,
  email: null,
  deviceId: null,
  closingOn: null,
  verifying: null,
};

export const syncHandlers: Handlers = {
  sync_status: returns(signedOut),
  sync_closing_here: returns<number | null>(null),
};
