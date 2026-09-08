import { invoke } from "@tauri-apps/api/core";

/** The types this viewer has a reading for, plus whatever else a server may report — a stream,
 * a module type. The unknown ones are shown as a key with a type and no items. */
export type RedisKeyType = "string" | "list" | "set" | "zset" | "hash" | "none" | (string & {});

export interface RedisKeyInfo {
  name: string;
  type: RedisKeyType;
}

export interface RedisKeyPage {
  keys: RedisKeyInfo[];
  /** Opaque — hand it back as-is to load the next page. */
  cursor: string;
  /** The cursor has come full circle: nothing left to load. */
  done: boolean;
}

/** A numbered database and how many keys it holds. Redis databases have no names, so the count
 * is the only thing that tells one worth opening from an empty one. */
export interface RedisDbInfo {
  index: number;
  keys: number;
}

/** One item of a key's value. Which fields are filled in follows the key's type: a string and a
 * set carry `value` alone, a list adds `index`, a sorted set `score`, a hash `field`. */
export interface RedisValueItem {
  value: string;
  index?: number;
  score?: number | string;
  field?: string;
}

export interface RedisValuePage {
  type: RedisKeyType;
  /** Seconds left to live, `-1` for a key with no expiry, `-2` for one that is gone. */
  ttl: number;
  /** How many items the key holds in total, or `-1` when its type gives no cheap count. */
  total: number;
  items: RedisValueItem[];
  /** Where the next page resumes, or `null` at the end of the value. */
  nextCursor: string | null;
}

/** The cursor a first page starts from — both for the keyspace and for a value. */
export const REDIS_FIRST_CURSOR = "0";

export function redisServerInfo(id: string): Promise<{ version: string; os: string }> {
  return invoke<{ version: string; os: string }>("redis_server_info", { id });
}

export function redisListDatabases(id: string): Promise<RedisDbInfo[]> {
  return invoke<RedisDbInfo[]>("redis_list_databases", { id });
}

/** Points the connection at another numbered database. Sticky — everything read afterwards
 * comes from it, so the key list has to be reloaded once this resolves. */
export function redisSelectDb(id: string, index: number): Promise<void> {
  return invoke<void>("redis_select_db", { id, index });
}

/**
 * Reads one page of the keyspace, matching `pattern` (a Redis glob: `*`, `?`, `[ab]`).
 *
 * Pages come from `SCAN`, so they are not a partition of the keyspace: a key can show up on two
 * pages, and `count` is a hint rather than a promise. Callers append pages keyed by name and
 * stop when the page says `done`.
 */
export function redisScanKeys(
  id: string,
  pattern: string,
  cursor: string,
  count: number,
): Promise<RedisKeyPage> {
  return invoke<RedisKeyPage>("redis_scan_keys", { id, pattern, cursor, count });
}

/** Reads one page of a key's value. `cursor` is `null` for the first page and whatever the
 * previous page's `nextCursor` was for the ones after it. */
export function redisKeyValue(
  id: string,
  key: string,
  cursor: string | null,
  count: number,
): Promise<RedisValuePage> {
  return invoke<RedisValuePage>("redis_key_value", { id, key, cursor, count });
}

/** Removes keys and resolves to how many of them existed. */
export function redisDeleteKeys(id: string, keys: string[]): Promise<number> {
  return invoke<number>("redis_delete_keys", { id, keys });
}
