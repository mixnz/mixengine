// What a body has to look like before anything is done with it.
//
// The server validates shapes and lengths and never meaning: it cannot tell whether a ciphertext
// is a saved query or a connection, and nothing here tries.

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
// Deliberately loose. The address is a delivery target, not a claim to be parsed: the only real
// test of it is whether a letter arrives, and a stricter pattern refuses valid addresses far more
// often than it catches invalid ones.
const EMAIL = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

export function isEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && EMAIL.test(value);
}

export function isOpaqueId(value: unknown): value is string {
  return typeof value === "string" && HEX_64.test(value);
}

/** Standard base64 with padding, which is the one spelling D4a allows. */
export function isBase64(value: unknown, decodedBytes?: number): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0) return false;
  if (!BASE64.test(value)) return false;
  if (decodedBytes === undefined) return true;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding === decodedBytes;
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isNonEmptyString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

export function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
