import {
  applySyncChanges,
  asRecord,
  type SyncableCollection,
  type SyncItem,
} from "../../core/syncCollection";
import { mergeSshSecrets, splitSshSecrets } from "../../core/ssh";
import {
  addSavedTarget,
  loadSavedTargets,
  parseSavedTarget,
  removeSavedTarget,
  updateSavedTarget,
  withoutSecrets,
} from "./savedTargets";
import { sanitizeSettings, type TerminalSettings } from "./settings";
import { loadTerminalSettings, updateTerminalSettings } from "./settingsStore";
import type { SavedTarget } from "./types";

/** D5's *font, cursor, scrollback*, and nothing that names this machine. */
const TRAVELS = ["fontFamily", "fontSize", "scrollback", "cursorStyle", "cursorBlink"] as const;

export function settingsToSync(settings: TerminalSettings): SyncItem[] {
  const data: Record<string, unknown> = {};
  for (const key of TRAVELS) data[key] = settings[key];
  return [{ id: "settings", data }];
}

/** The fields that travelled, checked the way the file is checked when a person edits it. */
export function settingsFromSync(synced: SyncItem): Partial<TerminalSettings> | null {
  const data = asRecord(synced.data);
  if (!data) return null;
  const clean = sanitizeSettings(data);
  const patch: Partial<TerminalSettings> = {};
  for (const key of TRAVELS) {
    if (key in data) (patch as Record<string, unknown>)[key] = clean[key];
  }
  return patch;
}

/** An SSH target, without its secrets. A local target is a shell on this machine. */
export function targetsToSync(targets: SavedTarget[]): SyncItem[] {
  return targets
    .filter((target) => target.kind === "ssh")
    .map((target) => {
      const { id, ...rest } = withoutSecrets(target);
      return { id, data: rest };
    });
}

export function targetFromSync(synced: SyncItem, local: SavedTarget | undefined): SavedTarget | null {
  const data = asRecord(synced.data);
  const parsed = data ? parseSavedTarget({ ...data, id: synced.id }) : null;
  if (!parsed || parsed.kind !== "ssh") return null;
  if (local?.kind !== "ssh") return parsed;
  return { ...parsed, config: mergeSshSecrets(parsed.config, splitSshSecrets(local.config).secrets) };
}

export const settingsSyncable: SyncableCollection = {
  id: "terminal-settings",
  labelKey: "terminalSync.settings",
  read: async () => settingsToSync(await loadTerminalSettings()),
  write: async (changes) => {
    for (const synced of changes.upserts) {
      const patch = synced.id === "settings" ? settingsFromSync(synced) : null;
      if (patch) updateTerminalSettings(patch);
    }
    // Settings are not a list and cannot be deleted; a removal has nothing to act on.
  },
};

export const hostsSyncable: SyncableCollection = {
  id: "terminal-hosts",
  labelKey: "terminalSync.hosts",
  read: async () => targetsToSync(await loadSavedTargets()),
  write: async (changes) => {
    const current = await loadSavedTargets();
    const had = new Set(current.map((target) => target.id));
    const next = applySyncChanges(current, changes, (t) => t.id, targetFromSync);
    const touched = new Set(changes.upserts.map((item) => item.id));
    for (const id of changes.removed) if (had.has(id)) await removeSavedTarget(id);
    for (const target of next) {
      if (!touched.has(target.id)) continue;
      await (had.has(target.id) ? updateSavedTarget(target) : addSavedTarget(target));
    }
  },
};
