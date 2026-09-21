/**
 * The servers this machine can sign in to (the design's D8): the default instance, always first
 * and never removable, then whatever a person hosting their own has added. **Addresses only** — a
 * closed server's access token is typed at sign-in and kept beside `MK` by Rust.
 */
export const DEFAULT_SERVER = "https://sync-0.lab.mixnz.com";

const KEY = "mixlab-sync-servers";

/** The server picked last, so signing out comes back to it rather than to the default. */
const LAST_KEY = "mixlab-sync-last-server";

/** What this needs of `localStorage`, so a test can hand it a map instead. */
export interface ServerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type Refused = { ok: false; reason: "invalid" | "insecure" };

/** Plain `http` reaches only this machine: anything further would carry a password in the clear. */
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** `input` as the list keeps it — no trailing slash — or why it cannot be a server. */
export function normalizeServer(input: string): { ok: true; url: string } | Refused {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "invalid" };
  if (url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol === "http:" && !LOCAL.has(url.hostname)) return { ok: false, reason: "insecure" };
  return { ok: true, url: `${url.origin}${url.pathname}`.replace(/\/+$/, "") };
}

function added(storage: ServerStorage): string[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((url): url is string => typeof url === "string") : [];
  } catch {
    return [];
  }
}

export function readServers(storage: ServerStorage): string[] {
  return [DEFAULT_SERVER, ...new Set(added(storage).filter((url) => url !== DEFAULT_SERVER))];
}

export function addServer(
  storage: ServerStorage,
  input: string,
): { ok: true; url: string; servers: string[] } | Refused {
  const normalized = normalizeServer(input);
  if (!normalized.ok) return normalized;
  storage.setItem(KEY, JSON.stringify([...new Set([...added(storage), normalized.url])]));
  return { ok: true, url: normalized.url, servers: readServers(storage) };
}

export function removeServer(storage: ServerStorage, url: string): string[] {
  storage.setItem(KEY, JSON.stringify(added(storage).filter((other) => other !== url)));
  return readServers(storage);
}

export function rememberServer(storage: ServerStorage, url: string): void {
  storage.setItem(LAST_KEY, url);
}

/** The server picked last, while it is still on the list; the default otherwise. */
export function lastServer(storage: ServerStorage): string {
  const last = storage.getItem(LAST_KEY);
  return last !== null && readServers(storage).includes(last) ? last : DEFAULT_SERVER;
}
