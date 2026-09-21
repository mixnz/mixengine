import {
  applySyncChanges,
  asRecord,
  type SyncableCollection,
  type SyncChanges,
  type SyncItem,
} from "../../core/syncCollection";
import { mergeSshSecrets, splitSshSecrets, sshFromSync, sshToSync } from "../../core/ssh";
import {
  deleteSecrets,
  loadSavedTargets,
  loadSecrets,
  parseSavedTarget,
  saveSecrets,
  withoutSecrets,
  type HostSecrets,
} from "./savedTargets";
// Writes go through the shared list, which tells every open tab; `savedTargets.ts` alone would
// change the file and leave each tab's sidebar as it was until the app restarted.
import { addTarget, removeTarget, updateTarget } from "./savedTargetsStore";
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
      return { id, data: rest.kind === "ssh" ? { ...rest, config: sshToSync(rest.config) } : rest };
    });
}

export function targetFromSync(synced: SyncItem, local: SavedTarget | undefined): SavedTarget | null {
  const data = asRecord(synced.data);
  const parsed = data ? parseSavedTarget({ ...data, id: synced.id }) : null;
  if (!parsed || parsed.kind !== "ssh") return null;
  if (local?.kind !== "ssh") return { ...parsed, config: sshFromSync(parsed.config, undefined) };
  const config = sshFromSync(parsed.config, local.config);
  return { ...parsed, config: mergeSshSecrets(config, splitSshSecrets(local.config).secrets) };
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
    for (const id of changes.removed) if (had.has(id)) await removeTarget(id);
    for (const target of next) {
      if (!touched.has(target.id)) continue;
      if (had.has(target.id)) {
        await updateTarget(target);
        continue;
      }
      // As for a connection: saved with no credential, it would delete what may be waiting (D5).
      const waiting = target.kind === "ssh" ? await loadSecrets(target.id) : {};
      await addTarget(
        target.kind === "ssh" ? { ...target, config: mergeSshSecrets(target.config, waiting) } : target,
      );
    }
  },
};

/** A host's credentials, as `terminal-host-secrets` lends them: nothing for a host with none. */
export function hostSecretsToSync(targets: SavedTarget[]): SyncItem[] {
  return targets.flatMap((target) => {
    if (target.kind !== "ssh") return [];
    const secrets = splitSshSecrets(target.config).secrets;
    return Object.keys(secrets).length === 0 ? [] : [{ id: target.id, data: { ...secrets } }];
  });
}

/** Another machine's credentials for one host: the SSH password and passphrase, strings only. */
export function hostSecretsFromSync(data: unknown): HostSecrets | null {
  const record = asRecord(data);
  if (!record) return null;
  const out: HostSecrets = {};
  if (typeof record.sshPassword === "string" && record.sshPassword !== "") out.sshPassword = record.sshPassword;
  if (typeof record.sshPassphrase === "string" && record.sshPassphrase !== "") {
    out.sshPassphrase = record.sshPassphrase;
  }
  return out;
}

/** The same shape as `connection-secrets`' writer: through the list for a host this machine has,
 *  straight into the vault for one that has not arrived (D5). */
async function writeHostSecrets(changes: SyncChanges): Promise<void> {
  const current = new Map((await loadSavedTargets()).map((target) => [target.id, target]));
  for (const synced of changes.upserts) {
    const secrets = hostSecretsFromSync(synced.data);
    if (!secrets) continue;
    const local = current.get(synced.id);
    if (local?.kind === "ssh") {
      await updateTarget({ ...local, config: mergeSshSecrets(splitSshSecrets(local.config).config, secrets) });
    } else if (!local) {
      await saveSecrets(synced.id, secrets);
    }
  }
  for (const id of changes.removed) {
    const local = current.get(id);
    if (local?.kind === "ssh") await updateTarget(withoutSecrets(local));
    else if (!local) await deleteSecrets(id);
  }
}

export const hostSecretsSyncable: SyncableCollection = {
  id: "terminal-host-secrets",
  labelKey: "terminalSync.hostSecrets",
  belongsTo: "terminal-hosts",
  read: async () => hostSecretsToSync(await loadSavedTargets()),
  write: writeHostSecrets,
};
