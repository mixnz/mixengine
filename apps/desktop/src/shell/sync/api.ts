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
