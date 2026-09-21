import {
  applySyncChanges,
  asRecord,
  type SyncableCollection,
  type SyncItem,
} from "../../core/syncCollection";
import type { Environment, EnvVar } from "./environments";
import { currentEnvironments, environmentsReady, replaceEnvironments } from "./environmentsStore";
import { newRequest } from "./requests";
import { currentLists, replaceSaved, requestsReady } from "./requestsStore";
import type { RestRequest } from "./types";

/** An allow-list: `lastUsedAt` changes on every send, and `auth` may hold a credential (D5). */
export function requestToSync(request: RestRequest): SyncItem {
  const { name, method, url, params, headers, body, origin, createdAt } = request;
  return { id: request.id, data: { name, method, url, params, headers, body, origin, createdAt } };
}

export function requestFromSync(synced: SyncItem, local: RestRequest | undefined): RestRequest | null {
  const data = asRecord(synced.data);
  if (
    !data ||
    typeof data.name !== "string" ||
    typeof data.method !== "string" ||
    typeof data.url !== "string" ||
    !Array.isArray(data.params) ||
    !Array.isArray(data.headers) ||
    !asRecord(data.body)
  ) {
    return null;
  }
  // What never travelled stays this machine's; a request new here gets the module's own empty
  // auth rather than one invented in this file.
  const base = local ?? newRequest(synced.id, 0);
  return { ...base, ...(data as Partial<RestRequest>), id: synced.id, auth: base.auth, lastUsedAt: base.lastUsedAt };
}

/** A secret variable travels as a name and a flag; its value is `rest-env-secrets`' (T177f). */
export function environmentToSync(env: Environment): SyncItem {
  return {
    id: env.id,
    data: {
      name: env.name,
      vars: env.vars.map((v) => (v.secret ? { name: v.name, secret: true } : { ...v })),
    },
  };
}

export function environmentFromSync(synced: SyncItem, local: Environment | undefined): Environment | null {
  const data = asRecord(synced.data);
  if (!data || typeof data.name !== "string" || !Array.isArray(data.vars)) return null;
  const kept = new Map((local?.vars ?? []).filter((v) => v.secret).map((v) => [v.name, v.value]));
  const vars: EnvVar[] = [];
  for (const raw of data.vars) {
    const v = asRecord(raw);
    if (!v || typeof v.name !== "string") return null;
    vars.push(
      v.secret === true
        ? { name: v.name, value: kept.get(v.name) ?? "", secret: true }
        : { name: v.name, value: typeof v.value === "string" ? v.value : "", secret: false },
    );
  }
  return { id: synced.id, name: data.name, vars };
}

export const requestsSyncable: SyncableCollection = {
  id: "rest-requests",
  labelKey: "restSync.requests",
  read: async () => {
    await requestsReady();
    return currentLists().saved.map(requestToSync);
  },
  write: async (changes) => {
    await requestsReady();
    replaceSaved(applySyncChanges(currentLists().saved, changes, (r) => r.id, requestFromSync));
  },
};

export const environmentsSyncable: SyncableCollection = {
  id: "rest-environments",
  labelKey: "restSync.environments",
  read: async () => {
    await environmentsReady();
    return currentEnvironments().map(environmentToSync);
  },
  write: async (changes) => {
    await environmentsReady();
    replaceEnvironments(applySyncChanges(currentEnvironments(), changes, (e) => e.id, environmentFromSync));
  },
};
