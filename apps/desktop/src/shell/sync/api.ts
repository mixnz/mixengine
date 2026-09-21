import { invoke } from "@tauri-apps/api/core";
import type { SyncChanges, SyncItem } from "../../core/syncCollection";

/**
 * The account and the loop's commands (`src-tauri/src/sync/commands.rs`), typed. `MK` never comes
 * this way; the recovery key does, once, from `syncRegister`.
 */

export interface SyncStatus {
  signedIn: boolean;
  server: string | null;
  email: string | null;
  deviceId: string | null;
  /** The day the server said it closes, in seconds — advisory, and `null` until this run has synced. */
  closingOn: number | null;
  /** The address a code was sent to, while sign-up waits for it. */
  verifying: string | null;
}

export interface SyncDevice {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
  current: boolean;
}

/** A page for a module to write; `token` goes back once it has. */
export interface PulledPage {
  token: string;
  changes: SyncChanges;
  more: boolean;
}

/** `replaced` is this machine's edits that lost to newer ones (D4). No token, nothing to write. */
export interface PushedChanges {
  accepted: number;
  replaced: SyncChanges;
  token: string | null;
}

/** What the loop needs of the backend, so a test can hand it a fake. */
export interface SyncBackend {
  pullPage(collection: string): Promise<PulledPage>;
  commitPull(collection: string, token: string): Promise<void>;
  push(collection: string, items: SyncItem[]): Promise<PushedChanges>;
  commitPush(collection: string, token: string): Promise<void>;
}

export const tauriSync: SyncBackend = {
  pullPage: (collection) => invoke("sync_pull_page", { collection }),
  commitPull: (collection, token) => invoke("sync_commit_pull", { collection, token }),
  push: (collection, items) => invoke("sync_push", { collection, items }),
  commitPush: (collection, token) => invoke("sync_commit_push", { collection, token }),
};

export function syncStatus(): Promise<SyncStatus> {
  return invoke("sync_status");
}

/** What this machine calls itself, offered as its name in the device list. */
export function syncDeviceName(): Promise<string> {
  return invoke("sync_device_name");
}

/** Resolves to the recovery key, which is shown once and never asked for again. */
export function syncRegister(server: string, access: string | null, email: string, password: string): Promise<string> {
  return invoke("sync_register", { server, access, email, password });
}

export function syncVerify(code: string, deviceName: string): Promise<SyncStatus> {
  return invoke("sync_verify", { code, deviceName });
}

export function syncLogin(
  server: string,
  access: string | null,
  email: string,
  password: string,
  deviceName: string,
): Promise<SyncStatus> {
  return invoke("sync_login", { server, access, email, password, deviceName });
}

export function syncLogout(): Promise<void> {
  return invoke("sync_logout");
}

export function syncDevices(): Promise<SyncDevice[]> {
  return invoke("sync_devices");
}

export function syncRevokeDevice(id: string): Promise<void> {
  return invoke("sync_revoke_device", { id });
}

export function syncChangePassword(current: string, next: string): Promise<void> {
  return invoke("sync_change_password", { current, next });
}

/** Asks for the reset letter. Resolves the same whether or not the address has an account. */
export function syncResetAsk(server: string, access: string | null, email: string): Promise<void> {
  return invoke("sync_reset_ask", { server, access, email });
}

/** D6 case 2, first step: spends the code. Rust holds the ticket for {@link syncResetKeep}. */
export function syncResetOpen(server: string, access: string | null, email: string, code: string): Promise<void> {
  return invoke("sync_reset_open", { server, access, email, code });
}

/** D6 case 2: the recovery key keeps the records; signs this machine in. */
export function syncResetKeep(recoveryKey: string, password: string, deviceName: string): Promise<SyncStatus> {
  return invoke("sync_reset_keep", { recoveryKey, password, deviceName });
}

/** D6 case 3, before anything is deleted: resolves to the new recovery key, to be shown once. */
export function syncResetPrepare(
  server: string,
  access: string | null,
  email: string,
  password: string,
): Promise<string> {
  return invoke("sync_reset_prepare", { server, access, email, password });
}

/** D6 case 3: spends the code, which deletes every record, and signs in under the new key. */
export function syncResetStartOver(code: string, deviceName: string): Promise<SyncStatus> {
  return invoke("sync_reset_start_over", { code, deviceName });
}
