import { createStore, jsonFile, useStore } from "../../core/jsonStore";
import { DEFAULT_SEND_SETTINGS, type SendSettings } from "./buildRequest";

/**
 * How the REST workspace is laid out, kept between sessions.
 *
 * The shell remembers no tabs, so nothing here is about which requests were open — only about
 * the furniture, which is the same in every REST tab and so belongs to the app rather than to one
 * of them — the settings pane's four switches included, since a timeout is no more one tab's than
 * a sidebar width is.
 */

export interface Workspace {
  sidebarWidth: number;
  /** The request pane's share of the width between the two. */
  splitRatio: number;
  /** Only a seed. A REST tab reads this once, when this file first arrives, and writes it whenever
   *  its own choice changes — but it never reads it again, because a second tab moving to prod is
   *  not this tab moving with it. */
  lastEnvId: string | null;
  /** Whether a response body is kept with its history entry. Turning it off also forgets the ones
   *  already kept — see `dropHistoryBodies`. */
  keepResponseBodies: boolean;
  timeoutMs: number;
  followRedirects: boolean;
  /** Off. Turning it on stops the client checking any server's certificate, on every request. */
  acceptInvalidCerts: boolean;
}

/** A timeout of nothing is a request that always fails, and one of a day is a tab that never comes
 *  back. Both ends belong to the box, not to the wire. */
export const MIN_TIMEOUT_SECONDS = 1;
export const MAX_TIMEOUT_SECONDS = 600;

export function clampTimeoutSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_SEND_SETTINGS.timeoutMs / 1000;
  return Math.min(MAX_TIMEOUT_SECONDS, Math.max(MIN_TIMEOUT_SECONDS, Math.round(seconds)));
}

/** The three the wire asks for, out of the seven kept here. */
export function sendSettings(workspace: Workspace): SendSettings {
  return {
    timeoutMs: workspace.timeoutMs,
    followRedirects: workspace.followRedirects,
    acceptInvalidCerts: workspace.acceptInvalidCerts,
  };
}

export const DEFAULT_SIDEBAR_WIDTH = 260;
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 520;
export const DEFAULT_SPLIT_RATIO = 0.5;
export const MIN_SPLIT_RATIO = 0.2;
export const MAX_SPLIT_RATIO = 0.8;

const DEFAULTS: Workspace = {
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  splitRatio: DEFAULT_SPLIT_RATIO,
  lastEnvId: null,
  keepResponseBodies: true,
  ...DEFAULT_SEND_SETTINGS,
};

/* Spread over the defaults on the way in, not replaced by them: a file written by a version that
   had one fewer switch is still the user's furniture, and the field it never heard of takes its
   default rather than the whole file being thrown away. */
const file = jsonFile<Partial<Workspace>>("rest-workspace.json", "workspace", {});
const store = createStore<Workspace>({
  defaults: DEFAULTS,
  load: async () => ({ ...DEFAULTS, ...(await file.load()) }),
  persist: file.persist,
});

/** Publish, and write behind. Nothing here is worth an error in front of the user: a sidebar width
 *  that did not reach the disk is a sidebar width that comes back to its default next launch. */
function write(next: Workspace): void {
  void store.save(next).catch(() => {});
}

export function useWorkspace(): Workspace {
  return useStore(store);
}

export function setSidebarWidth(sidebarWidth: number): void {
  write({ ...store.get(), sidebarWidth });
}

export function setSplitRatio(splitRatio: number): void {
  write({ ...store.get(), splitRatio });
}

/** Whether the file has been read yet. A tab seeds its environment from `lastEnvId` the moment
 *  this turns true, and never again — which is not something a defaulted value can be told apart
 *  from a stored one. */
export function workspaceLoaded(): boolean {
  return store.isLoaded();
}

export function setLastEnvId(lastEnvId: string | null): void {
  write({ ...store.get(), lastEnvId });
}

/** What the store holds now, for a caller that is not a component — the send path, which reads the
 *  settings as they stand rather than as they were when its handler was made. */
export function currentWorkspace(): Workspace {
  return store.get();
}

/** A settings change. One entry point rather than a setter each: the Settings pane changes one
 *  field at a time and none of them needs anything the others do not. */
export function updateWorkspace(patch: Partial<Workspace>): void {
  write({ ...store.get(), ...patch });
}
