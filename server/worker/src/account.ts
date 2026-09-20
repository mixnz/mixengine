// One Durable Object per account (D8).
//
// Everything about an account lives in here — the address, the stored verifier, the salt, both
// wrapped copies of MK, the device list and the record table — because nothing in this design ever
// queries across accounts: there is no administrative screen, no statistic and no search, and every
// operation begins by naming one account.
//
// The object is addressed by `idFromName(hex(SHA-256(lowercased address)))`, which is what replaces
// an index: the same address is the same object every time, so there is nothing to keep in step,
// and two simultaneous registrations meet inside one serialized object where one of them loses
// without a transaction being written.

import { fail } from "./http";

export class Account implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: unknown,
  ) {}

  async fetch(_request: Request): Promise<Response> {
    // Nothing routes here yet: the only route this server answers is `/v1/capabilities`, which
    // never reaches an object (D8). The class exists because the binding needs one.
    return fail(501, "not-implemented", "This server does not yet hold accounts.");
  }
}

/** The name of the object that holds an address, and the only lookup this design performs. */
export async function accountName(email: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.toLowerCase()));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
