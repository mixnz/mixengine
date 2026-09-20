// What this deployment was configured with, and what it refuses to run without.
//
// **A server missing a piece of its configuration refuses to serve, and names the piece** (D8).
// A Worker has no startup to refuse at, so the check runs on every request and the refusal is a
// `503` carrying the names. The failure it replaces is otherwise invisible: the deploy succeeds,
// registration succeeds, and a person waits for a letter that was never sent.

export interface Env {
  ACCOUNT: DurableObjectNamespace;

  /** Keyed into the stored password verifier, so a stolen database is not a list of verifiers. */
  PEPPER?: string;
  /** The email provider's key. Which provider is a deployment decision; see `src/email/`. */
  EMAIL_API_KEY?: string;
  /** The address verification and reset letters are sent from. */
  EMAIL_FROM?: string;

  /** `"1"` serves `/__test__/outbox` and sends no mail. Never set this on a real deployment. */
  TEST_OUTBOX?: string;

  MAX_RECORD_BYTES?: string;
  MAX_BATCH_OPERATIONS?: string;
  MAX_PAGE_RECORDS?: string;
  ACCOUNT_QUOTA_BYTES?: string;
  TOMBSTONE_RETENTION_DAYS?: string;
}

export interface Capabilities {
  protocolVersions: string[];
  maxRecordBytes: number;
  maxBatchOperations: number;
  maxPageRecords: number;
  accountQuotaBytes: number;
  tombstoneRetentionDays: number;
  features: string[];
}

export interface Config {
  pepper: string;
  emailApiKey: string | null;
  emailFrom: string;
  testOutbox: boolean;
  capabilities: Capabilities;
}

const DEFAULTS = {
  maxRecordBytes: 1_048_576,
  maxBatchOperations: 100,
  maxPageRecords: 500,
  accountQuotaBytes: 20_971_520,
  tombstoneRetentionDays: 90,
} as const;

/**
 * A fixed pepper for a server started in test-outbox mode. It is a constant on purpose: that mode
 * already hands out verification tokens over HTTP, so there is nothing left for a secret to
 * protect, and requiring one would only make the suite harder to run.
 */
const TEST_PEPPER = "conformance-pepper-not-for-any-real-deployment";

export type ConfigResult =
  | { ok: true; config: Config }
  | { ok: false; missing: string[] };

function number(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function readConfig(env: Env): ConfigResult {
  const testOutbox = env.TEST_OUTBOX === "1";
  const missing: string[] = [];

  // In test-outbox mode nothing is emailed, so a provider key would have no use; every other
  // deployment needs one, and a silent absence is the failure this check exists for.
  if (!testOutbox) {
    if (!env.PEPPER) missing.push("PEPPER");
    if (!env.EMAIL_API_KEY) missing.push("EMAIL_API_KEY");
    if (!env.EMAIL_FROM) missing.push("EMAIL_FROM");
  }
  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    config: {
      pepper: env.PEPPER ?? TEST_PEPPER,
      emailApiKey: env.EMAIL_API_KEY ?? null,
      emailFrom: env.EMAIL_FROM ?? "conformance@example.invalid",
      testOutbox,
      capabilities: {
        protocolVersions: ["v1"],
        maxRecordBytes: number(env.MAX_RECORD_BYTES, DEFAULTS.maxRecordBytes),
        maxBatchOperations: number(env.MAX_BATCH_OPERATIONS, DEFAULTS.maxBatchOperations),
        maxPageRecords: number(env.MAX_PAGE_RECORDS, DEFAULTS.maxPageRecords),
        accountQuotaBytes: number(env.ACCOUNT_QUOTA_BYTES, DEFAULTS.accountQuotaBytes),
        tombstoneRetentionDays: number(
          env.TOMBSTONE_RETENTION_DAYS,
          DEFAULTS.tombstoneRetentionDays,
        ),
        // A complete v1 server announces nothing optional, and a client must run against an
        // empty list forever (D4a).
        features: [],
      },
    },
  };
}
