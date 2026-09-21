// A fixed window per source, for the two routes that can cost money.
//
// **Why this is not inside the account object.** D8 puts rate limiting inside the object because
// that is already the serialized place, and for anything that is guessing at one account — signing
// in — that is exactly right, and it lives there. But the two routes that *create* work out of
// nothing, registration and asking for a reset, are abused by opening many accounts rather than by
// hammering one, and a limit kept per account cannot see that: every attempt lands on a different
// object with its own empty counter.
//
// So those two consult one more object, keyed by the source address. It costs one extra wake on two
// routes a person uses roughly twice in a lifetime — which is the arithmetic D8 asks for, spent
// where it buys the thing D8's own "the cost risk is abuse, not success" paragraph is about.

import { sha256Hex } from "./crypto";

const WINDOW_SECONDS = 60 * 60;

export class SourceLimit implements DurableObject {
  private readonly sql: SqlStorage;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: unknown,
  ) {
    this.sql = state.storage.sql;
    state.blockConcurrencyWhile(async () => {
      this.sql.exec(
        `CREATE TABLE IF NOT EXISTS window (
           action        TEXT    PRIMARY KEY,
           count         INTEGER NOT NULL,
           started_at    INTEGER NOT NULL
         )`,
      );
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.searchParams.get("action") ?? "";
    const allowance = Number(url.searchParams.get("allowance") ?? 0);
    const at = Math.floor(Date.now() / 1000);

    const row = this.sql
      .exec<{ count: number; started_at: number }>(
        `SELECT count, started_at FROM window WHERE action = ?`,
        action,
      )
      .toArray()[0];

    if (!row || at - row.started_at >= WINDOW_SECONDS) {
      this.sql.exec(
        `INSERT INTO window (action, count, started_at) VALUES (?, 1, ?)
         ON CONFLICT (action) DO UPDATE SET count = 1, started_at = excluded.started_at`,
        action,
        at,
      );
      return Response.json({ allowed: true });
    }

    if (row.count >= allowance) {
      return Response.json({ allowed: false, retryAfter: row.started_at + WINDOW_SECONDS - at });
    }

    this.sql.exec(`UPDATE window SET count = count + 1 WHERE action = ?`, action);
    return Response.json({ allowed: true });
  }
}

export interface Allowance {
  allowed: boolean;
  retryAfter?: number;
}

/**
 * The address the request came from. `CF-Connecting-IP` is set by Cloudflare and cannot be forged
 * through it; behind `wrangler dev` there is none, and one shared bucket is the honest answer.
 */
export async function askSource(
  namespace: DurableObjectNamespace,
  request: Request,
  action: string,
  allowance: number,
): Promise<Allowance> {
  return askBucket(namespace, request.headers.get("CF-Connecting-IP") ?? "local", action, allowance);
}

/**
 * The same counter against something that is not a source.
 *
 * **A letter is counted against the address it reaches** (D4a), and that counter cannot live in
 * the account object: registering over an unverified account replaces it and everything hanging
 * off it, so a counter kept there is one the counted party can clear by asking again. Here it
 * outlives the account, and outlives its deletion.
 */
export async function askBucket(
  namespace: DurableObjectNamespace,
  key: string,
  action: string,
  allowance: number,
): Promise<Allowance> {
  const stub = namespace.get(namespace.idFromName(await sha256Hex(key)));
  const query = new URLSearchParams({ action, allowance: String(allowance) });
  const response = await stub.fetch(`https://limit/?${query}`);
  return (await response.json()) as Allowance;
}
