// What the server needs a cipher for, which is not much: it holds a verifier, hands out tokens,
// and addresses an object. **Nothing here touches a record.** The keys that make a record readable
// are derived on the machine that wrote it and never arrive.

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return [...view].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 32 random bytes as hex: a token, a device id, a link. */
export function randomToken(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

/**
 * The stored password verifier: `HMAC(pepper, A)`. `A` already is a verifier — the client derived
 * it and the password is not recoverable from it — so this is not about hashing a password. It is
 * about the pepper living outside the database, so that a database taken on its own is not a list
 * of values that can be replayed against this server.
 */
export async function peppered(pepper: string, a: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(a)));
}

/**
 * Comparison that does not leak where two values first differ. Both arguments here are already
 * hashes of the same fixed length, so the early return costs nothing that matters — but a verifier
 * comparison is exactly the place where "it was fine in practice" stops being an argument.
 */
export function sameSecret(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/** The object that holds an address, and the only lookup this design performs (D8). */
export async function accountName(email: string): Promise<string> {
  return sha256Hex(email.trim().toLowerCase());
}
