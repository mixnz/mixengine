import {
  applySyncChanges,
  asRecord,
  type SyncableCollection,
  type SyncChanges,
  type SyncItem,
} from "../../core/syncCollection";
import { loadSavedConnections, readSecrets, withSecrets, withoutSecrets } from "./savedConnections";
import { addConnection, removeConnection, updateConnection } from "./savedConnectionsStore";
import type { ConnectionConfig, SavedConnection } from "./types";

/**
 * What travels of a connection: what it *is* (D5), and its read-only guard.
 *
 * An allow-list: a sidebar's width, a pin, a scan ceiling and a MixEngine keyring reference belong
 * to this machine, and every credential belongs to `connection-secrets` (T177f).
 */
export function connectionToSync(connection: SavedConnection): SyncItem {
  return {
    id: connection.id,
    data: {
      name: connection.name,
      config: withoutSecrets(connection.config),
      // A guard, not a preference: a production connection that arrives without it is more
      // dangerous on the second machine than it was on the first.
      readOnly: connection.readOnly === true,
    },
  };
}

/** Another machine's connection, over this machine's: what travelled replaces, the rest stays. */
export function connectionFromSync(
  synced: SyncItem,
  local: SavedConnection | undefined,
): SavedConnection | null {
  const data = asRecord(synced.data);
  const config = asRecord(data?.config);
  if (!data || typeof data.name !== "string" || !config) return null;
  const incoming = config as unknown as ConnectionConfig;
  return {
    ...local,
    id: synced.id,
    name: data.name,
    // No credential travels (D5). The one this machine has is kept; a new connection has none.
    config: local ? withSecrets(incoming, readSecrets(local.config, local.keyringRef)) : incoming,
    readOnly: data.readOnly === true ? true : undefined,
  };
}

/** Through the store's own add, update and remove, which own the split with the credential store. */
async function write(changes: SyncChanges): Promise<void> {
  const current = await loadSavedConnections();
  const had = new Set(current.map((connection) => connection.id));
  const next = applySyncChanges(current, changes, (c) => c.id, connectionFromSync);
  const touched = new Set(changes.upserts.map((item) => item.id));

  for (const id of changes.removed) if (had.has(id)) await removeConnection(id);
  for (const connection of next) {
    if (!touched.has(connection.id)) continue;
    await (had.has(connection.id) ? updateConnection(connection) : addConnection(connection));
  }
}

export const connectionsSyncable: SyncableCollection = {
  id: "connections",
  labelKey: "dbSync.connections",
  read: async () => (await loadSavedConnections()).map(connectionToSync),
  write,
};
