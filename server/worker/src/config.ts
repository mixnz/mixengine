// What this deployment was configured with, and what it refuses to run without.
//
// **A server missing a piece of its configuration refuses to serve, and names the piece** (D8).
// A Worker has no startup to refuse at, so the check runs on every request and the refusal is a
// `503` carrying the names. The failure it replaces is otherwise invisible: the deploy succeeds,
// registration succeeds, and a person waits for a letter that was never sent.

import { DEFAULT_ENDPOINT, NEEDS_ENDPOINT, PROVIDER_NAMES, isProviderName } from "./email";

export interface Env {
  ACCOUNT: DurableObjectNamespace;
  SOURCE_LIMIT: DurableObjectNamespace;

  /** Keyed into the stored password verifier, so a stolen database is not a list of verifiers. */
  PEPPER?: string;
  /** The email provider's key. Which provider is a deployment decision; see `src/email/`. */
  EMAIL_API_KEY?: string;
  /** The address verification and reset letters are sent from. */
  EMAIL_FROM?: string;
  /** The provider's HTTP endpoint. A provider is a deployment decision, not a protocol one. */
  EMAIL_ENDPOINT?: string;
  /** Which provider, by name. They differ in body shape, in the header that carries the key,
   *  and in what they call the sender — see `email.ts`. */
  EMAIL_PROVIDER?: string;

  /** Which endpoint a retired account is sent to (D4b). A symbolic id, never a URL. */
  RELOCATE_TO?: string;
  /** How long a freeze lasts before it lapses. Short on the instance that tests lapsing. */
  RELOCATION_LEASE_SECONDS?: string;

  /** `"1"` serves `/__test__/outbox` and sends no mail. Never set this on a real deployment. */
  TEST_OUTBOX?: string;

  /** How many accounts one source may open in an hour, and how often it may ask for a reset. */
  REGISTRATIONS_PER_HOUR?: string;
  RESETS_PER_HOUR?: string;
  /** How many times one account may be signed in to, right or wrong, in fifteen minutes. */
  LOGINS_PER_WINDOW?: string;
  /** How many codes may be tried against one account in fifteen minutes. Eight characters are
   *  only safe because this one is real (D4a). */
  VERIFY_ATTEMPTS_PER_WINDOW?: string;
  /** How often one source may ask where an address's salt is. Generous: a company behind one
   *  address may install on fifty machines in a morning. */
  PARAMS_PER_HOUR?: string;

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
  /** Absent for a provider whose URL carries something only the operator knows. */
  emailEndpoint: string | null;
  emailProvider: import("./email").ProviderName;
  testOutbox: boolean;
  relocateTo: string | null;
  relocationLeaseSeconds: number;
  /**
   * Not reported by `/v1/capabilities`, deliberately: publishing the number that stops abuse helps
   * only the abuser (D4a).
   */
  limits: {
    registrationsPerHour: number;
    resetsPerHour: number;
    loginsPerWindow: number;
    verifyAttemptsPerWindow: number;
    paramsPerHour: number;
  };
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
  const providerName = env.EMAIL_PROVIDER ?? "resend";
  if (!testOutbox) {
    if (!env.PEPPER) missing.push("PEPPER");
    if (!env.EMAIL_API_KEY) missing.push("EMAIL_API_KEY");
    if (!env.EMAIL_FROM) missing.push("EMAIL_FROM");
    // A name nobody implements is configuration that is missing rather than wrong: the deploy
    // would otherwise succeed and the first letter would be the thing that failed. `smtp` is a
    // real provider in `../native/` and impossible here, so it is refused by name.
    if (providerName === "smtp") {
      missing.push("EMAIL_PROVIDER (Workers cannot speak SMTP; see server/native/)");
    } else if (!isProviderName(providerName)) {
      missing.push(`EMAIL_PROVIDER (one of: ${PROVIDER_NAMES.join(", ")})`);
    } else if (NEEDS_ENDPOINT.includes(providerName) && !env.EMAIL_ENDPOINT) {
      // Mailtrap's URL carries an inbox id and Mailgun's a sending domain: nothing to guess.
      missing.push("EMAIL_ENDPOINT");
    }
  }
  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    config: {
      pepper: env.PEPPER ?? TEST_PEPPER,
      emailApiKey: env.EMAIL_API_KEY ?? null,
      emailFrom: env.EMAIL_FROM ?? "conformance@example.invalid",
      emailEndpoint:
        env.EMAIL_ENDPOINT ??
        (isProviderName(providerName) ? (DEFAULT_ENDPOINT[providerName] ?? null) : null),
      emailProvider: isProviderName(providerName) ? providerName : "resend",
      testOutbox,
      relocateTo: env.RELOCATE_TO ?? null,
      relocationLeaseSeconds: number(env.RELOCATION_LEASE_SECONDS, 900),
      limits: {
        registrationsPerHour: number(env.REGISTRATIONS_PER_HOUR, 10),
        resetsPerHour: number(env.RESETS_PER_HOUR, 10),
        loginsPerWindow: number(env.LOGINS_PER_WINDOW, 20),
        verifyAttemptsPerWindow: number(env.VERIFY_ATTEMPTS_PER_WINDOW, 10),
        paramsPerHour: number(env.PARAMS_PER_HOUR, 200),
      },
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
