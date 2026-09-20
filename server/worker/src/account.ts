// One Durable Object per account (D8).
//
// **Execution here is serialized**, and that is the whole reason this design is on Durable Objects
// rather than on a shared database. Three things that would otherwise need a carefully written
// transaction are free: the registration race settles because two attempts on one address arrive at
// one object; the per-account `seq` counter is monotonic because nothing else is running; and the
// per-record compare-and-swap is correct for the same reason. `server/native/` has to write those
// transactions by hand, and says so where it does.
//
// The object is addressed by the hash of the lowercased address, which is what this design has
// instead of an index: the same address is the same object every time, so there is nothing to keep
// in step. The cost is that changing an address changes the address of the object, so v1 does not
// offer it.
//
// **Nothing in here parses a ciphertext.**

import { readConfig, type Config, type Env } from "./config";
import { peppered, randomToken, sameSecret, sha256Hex } from "./crypto";
import { senderFor, type LetterKind } from "./email";
import { fail, json, notFound } from "./http";
import { SCHEMA, type AccountRow, type DeviceRow, type TokenRow } from "./schema";
import {
  asObject,
  isBase64,
  isEmail,
  isNonEmptyString,
  isPositiveInteger,
} from "./validate";

const ACCESS_TOKEN_SECONDS = 15 * 60;
const REFRESH_TOKEN_SECONDS = 90 * 24 * 60 * 60;
const VERIFICATION_TOKEN_SECONDS = 24 * 60 * 60;
const RESET_TOKEN_SECONDS = 60 * 60;

const now = (): number => Math.floor(Date.now() / 1000);

/** A token is `<object name>.<secret>`; only the second half is stored, and only as its hash. */
const secretOf = (token: string): string => token.split(".").at(-1) ?? "";

export class Account implements DurableObject {
  private readonly sql: SqlStorage;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    this.sql = state.storage.sql;
    // `blockConcurrencyWhile` holds every request until this finishes, so no handler can ever meet
    // a half-built schema — the object's equivalent of a migration that runs before the first
    // connection is served.
    state.blockConcurrencyWhile(async () => {
      for (const statement of SCHEMA) this.sql.exec(statement);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const result = readConfig(this.env);
    if (!result.ok) return fail(503, "server-misconfigured", "Missing configuration.");
    const config = result.config;

    const url = new URL(request.url);
    const body = await this.readBody(request);
    if (body === undefined) return fail(400, "invalid-request", "The body is not JSON.");

    switch (`${request.method} ${url.pathname}`) {
      case "POST /v1/auth/register":
        return this.register(config, body, url);
      case "POST /v1/auth/verify":
        return this.verifyAddress(body);
      case "POST /v1/auth/login":
        return this.login(config, body);
      case "POST /v1/auth/refresh":
        return this.refresh(body);
      case "GET /v1/devices":
        return this.listDevices(request);
      case "GET /__test__/outbox":
        return this.readOutbox(config);
      default:
        break;
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/v1/devices/")) {
      return this.deleteDevice(request, url.pathname.slice("/v1/devices/".length));
    }

    return notFound();
  }

  // --- the account itself ------------------------------------------------------------------

  private async register(config: Config, body: unknown, url: URL): Promise<Response> {
    const fields = asObject(body);
    if (
      !fields ||
      !isEmail(fields["email"]) ||
      !isBase64(fields["a"]) ||
      !isBase64(fields["saltAccount"]) ||
      !isBase64(fields["wrappedMkPassword"]) ||
      !isBase64(fields["wrappedMkRecovery"])
    ) {
      return fail(400, "invalid-request", "An address, a verifier, a salt and two wrapped keys.");
    }

    const argon = asObject(fields["argon"]);
    if (
      !argon ||
      !isPositiveInteger(argon["m"]) ||
      !isPositiveInteger(argon["t"]) ||
      !isPositiveInteger(argon["p"])
    ) {
      return fail(400, "invalid-request", "The Argon2 parameters the client derived with.");
    }

    // The race settles here and nowhere else: two attempts on one address reach one object, and
    // the second finds this row (D8).
    if (this.account()) {
      return fail(409, "email-taken", "That address already has an account.");
    }

    this.sql.exec(
      `INSERT INTO account (id, email, verifier, salt_account, argon_m, argon_t, argon_p,
                            wrapped_mk_password, wrapped_mk_recovery, verified, created_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      (fields["email"] as string).trim().toLowerCase(),
      await peppered(config.pepper, fields["a"] as string),
      fields["saltAccount"],
      argon["m"],
      argon["t"],
      argon["p"],
      fields["wrappedMkPassword"],
      fields["wrappedMkRecovery"],
      now(),
    );

    await this.sendLetter(config, "verification", url);
    return json(201, {});
  }

  private async verifyAddress(body: unknown): Promise<Response> {
    const fields = asObject(body);
    const token = fields?.["token"];
    if (typeof token !== "string") return fail(400, "invalid-token", "That link is not usable.");

    const account = this.account();
    if (!account) return fail(400, "invalid-token", "That link is not usable.");
    if (account.verified === 1) {
      // Already verified and the token already spent look alike on purpose: wrong, expired and
      // used answer with one code, because the sentence a person needs is the same (D4a).
      return fail(400, "invalid-token", "That link is not usable.");
    }
    if (!(await this.spendMailToken(token, "verification"))) {
      return fail(400, "invalid-token", "That link is not usable.");
    }

    this.sql.exec(`UPDATE account SET verified = 1 WHERE id = 1`);
    return json(200, {});
  }

  // --- signing in --------------------------------------------------------------------------

  private async login(config: Config, body: unknown): Promise<Response> {
    const fields = asObject(body);
    if (!fields || !isBase64(fields["a"]) || !isNonEmptyString(fields["deviceName"], 128)) {
      return fail(400, "invalid-request", "A verifier and a name for this machine.");
    }

    const account = this.account();
    const presented = await peppered(config.pepper, fields["a"] as string);
    // An unknown address and a wrong verifier answer alike. Registration has to refuse a taken
    // address and therefore leaks one; this route has no such obligation, so it does not (D4a).
    if (!account || !sameSecret(account.verifier, presented)) {
      return fail(401, "invalid-credentials", "That address and password do not match an account.");
    }
    if (account.verified !== 1) {
      return fail(403, "email-not-verified", "Confirm the address before signing in.");
    }

    const deviceId = randomToken();
    const at = now();
    this.sql.exec(
      `INSERT INTO device (id, name, created_at, last_seen_at) VALUES (?, ?, ?, ?)`,
      deviceId,
      (fields["deviceName"] as string).trim(),
      at,
      at,
    );

    return json(200, { ...(await this.issue(deviceId)), deviceId });
  }

  private async refresh(body: unknown): Promise<Response> {
    const fields = asObject(body);
    const presented = fields?.["refreshToken"];
    if (typeof presented !== "string") {
      return fail(401, "invalid-token", "That token is not usable.");
    }

    const row = this.token(await sha256Hex(secretOf(presented)));
    if (!row || row.kind !== "refresh" || row.expires_at <= now()) {
      return fail(401, "invalid-token", "That token is not usable.");
    }

    if (row.rotated === 1) {
      // Either it was copied, or two clients raced. Both want the person to sign in again rather
      // than continue quietly, so the device's whole chain goes (D4a).
      this.sql.exec(`DELETE FROM token WHERE device_id = ?`, row.device_id);
      return fail(401, "invalid-token", "That token is not usable.");
    }

    this.sql.exec(`UPDATE token SET rotated = 1 WHERE hash = ?`, row.hash);
    this.sql.exec(`DELETE FROM token WHERE device_id = ? AND kind = 'access'`, row.device_id);
    this.touch(row.device_id);
    return json(200, await this.issue(row.device_id));
  }

  // --- devices -----------------------------------------------------------------------------

  private async listDevices(request: Request): Promise<Response> {
    const session = await this.authenticate(request);
    if (!session) return fail(401, "invalid-token", "That token is not usable.");

    const devices = this.sql
      .exec<DeviceRow>(`SELECT * FROM device ORDER BY created_at ASC`)
      .toArray()
      .map((device) => ({
        id: device.id,
        name: device.name,
        createdAt: device.created_at,
        lastSeenAt: device.last_seen_at,
        current: device.id === session.deviceId,
      }));

    return json(200, { devices });
  }

  private async deleteDevice(request: Request, id: string): Promise<Response> {
    const session = await this.authenticate(request);
    if (!session) return fail(401, "invalid-token", "That token is not usable.");

    const exists = this.sql.exec(`SELECT id FROM device WHERE id = ?`, id).toArray().length === 1;
    // 404 and not 403: a 403 would confirm that the device exists on somebody else's account.
    if (!exists) return fail(404, "unknown-device", "No such device on this account.");

    this.sql.exec(`DELETE FROM token WHERE device_id = ?`, id);
    this.sql.exec(`DELETE FROM device WHERE id = ?`, id);
    return new Response(null, { status: 204 });
  }

  // --- the test outbox ---------------------------------------------------------------------

  private readOutbox(config: Config): Response {
    if (!config.testOutbox) return notFound();
    const messages = this.sql
      .exec<{ kind: string; token: string; sent_at: number }>(
        `SELECT kind, token, sent_at FROM outbox ORDER BY id ASC`,
      )
      .toArray()
      .map((row) => ({ kind: row.kind, token: row.token, sentAt: row.sent_at }));
    return json(200, { messages });
  }

  // --- the small things everything else stands on ------------------------------------------

  private account(): AccountRow | null {
    return this.sql.exec<AccountRow>(`SELECT * FROM account WHERE id = 1`).toArray()[0] ?? null;
  }

  private token(hash: string): TokenRow | null {
    return this.sql.exec<TokenRow>(`SELECT * FROM token WHERE hash = ?`, hash).toArray()[0] ?? null;
  }

  private touch(deviceId: string): void {
    this.sql.exec(`UPDATE device SET last_seen_at = ? WHERE id = ?`, now(), deviceId);
  }

  private async readBody(request: Request): Promise<unknown> {
    if (request.method === "GET" || request.method === "DELETE") return null;
    const text = await request.text();
    if (text.length === 0) return null;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  /**
   * A token carries the name of the object that issued it, so that a request bearing one can be
   * routed without an index — the same problem the address hash solves for the routes that name an
   * account, and the same answer. The prefix is the object's id and not the address hash: the id
   * is not reversible to an address, so a token that leaks into a log does not leak a guessable
   * hash of somebody's email. **This format is not protocol** — a token is opaque to a client, and
   * `server/native/` is free to shape its own differently.
   */
  private async issue(deviceId: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const at = now();
    const name = this.state.id.toString();
    const accessSecret = randomToken();
    const refreshSecret = randomToken();
    const accessToken = `${name}.${accessSecret}`;
    const refreshToken = `${name}.${refreshSecret}`;

    this.sql.exec(
      `INSERT INTO token (hash, kind, device_id, expires_at) VALUES (?, 'access', ?, ?)`,
      await sha256Hex(accessSecret),
      deviceId,
      at + ACCESS_TOKEN_SECONDS,
    );
    this.sql.exec(
      `INSERT INTO token (hash, kind, device_id, expires_at) VALUES (?, 'refresh', ?, ?)`,
      await sha256Hex(refreshSecret),
      deviceId,
      at + REFRESH_TOKEN_SECONDS,
    );

    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_SECONDS };
  }

  /**
   * The access token in `Authorization`, checked against the table. It is the same lookup that
   * would notice a revocation, which is why deleting a device ends both its tokens at once and
   * costs nothing to do (D4a).
   */
  async authenticate(request: Request): Promise<{ deviceId: string } | null> {
    const header = request.headers.get("Authorization") ?? "";
    if (!header.startsWith("Bearer ")) return null;
    const row = this.token(await sha256Hex(secretOf(header.slice("Bearer ".length))));
    if (!row || row.kind !== "access" || row.expires_at <= now()) return null;

    this.touch(row.device_id);
    return { deviceId: row.device_id };
  }

  private async spendMailToken(presented: string, kind: LetterKind): Promise<boolean> {
    const hash = await sha256Hex(presented);
    const row = this.sql
      .exec<{ hash: string; kind: string; expires_at: number; used: number }>(
        `SELECT * FROM mail_token WHERE hash = ?`,
        hash,
      )
      .toArray()[0];
    if (!row || row.kind !== kind || row.used === 1 || row.expires_at <= now()) return false;
    this.sql.exec(`UPDATE mail_token SET used = 1 WHERE hash = ?`, hash);
    return true;
  }

  private async sendLetter(config: Config, kind: LetterKind, url: URL): Promise<void> {
    const account = this.account();
    if (!account) return;

    const token = randomToken();
    const lifetime = kind === "verification" ? VERIFICATION_TOKEN_SECONDS : RESET_TOKEN_SECONDS;
    this.sql.exec(
      `INSERT INTO mail_token (hash, kind, expires_at) VALUES (?, ?, ?)`,
      await sha256Hex(token),
      kind,
      now() + lifetime,
    );

    const sender = senderFor(config);
    if (!sender) {
      this.sql.exec(
        `INSERT INTO outbox (kind, token, sent_at) VALUES (?, ?, ?)`,
        kind,
        token,
        now(),
      );
      return;
    }

    const query = new URLSearchParams({ email: account.email, token });
    await sender.send({
      kind,
      to: account.email,
      token,
      verifyUrl: `${url.origin}/v1/auth/verify?${query}`,
    });
  }
}
