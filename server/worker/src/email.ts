// Sending the two letters this server ever sends.
//
// **The provider sits behind this interface, and that is a more important decision than which
// provider it is** (D8). Every free tier in this market will be renegotiated within a few years;
// what protects the project is that changing provider is this file rather than a migration.
//
// The volume is two messages in the lifetime of an account — verify an address at registration,
// prove control of it after a forgotten password — and nothing else. No notification, no digest,
// no newsletter.
//
// **Workers cannot speak SMTP**, so an SMTP account is the wrong thing to hold: the provider needs
// an HTTP API. Cloudflare's own Email Routing receives and does not send, and MailChannels' free
// offering for Workers ended in 2024; both pieces of advice are still all over the internet.

import type { Config } from "./config";

export type LetterKind = "verification" | "reset";

export interface Letter {
  kind: LetterKind;
  to: string;
  /** What the person types back. **Not a link** — see D4a for the three reasons. */
  code: string;
}

export interface EmailSender {
  send(letter: Letter): Promise<void>;
}

function subject(kind: LetterKind): string {
  return kind === "verification" ? "Confirm your MixLab address" : "Reset your MixLab password";
}

function text(letter: Letter): string {
  if (letter.kind === "verification") {
    return [
      "Type this code into MixLab to confirm your address:",
      "",
      `    ${letter.code}`,
      "",
      "It works for 24 hours. If you did not ask for an account, ignore this message —",
      "nothing was created that you have to undo.",
    ].join("\n");
  }
  return [
    "Somebody asked to reset the password on this MixLab account. The code is:",
    "",
    `    ${letter.code}`,
    "",
    "It works for one hour.",
    "",
    "Resetting the password restores the login and NOT the data. Everything stored in the",
    "account is encrypted with a key that only your password or your recovery key can unwrap,",
    "and this server has never held either. Completing a reset deletes it all.",
    "",
    "If you have your recovery key, close this message and use that instead — it keeps the data.",
  ].join("\n");
}

/**
 * **Two providers, because one does not prove anything.** The paragraph above claims the provider
 * is replaceable; a single implementation cannot test that claim, in exactly the way `/v1` needs
 * two servers before it is a protocol rather than a description of one.
 *
 * They differ in more than a URL — the body shape and the header that carries the key are both
 * per-provider, which is the thing a "just change the endpoint" design gets wrong.
 */
export type ProviderName = "resend" | "mailtrap";

export function isProviderName(value: string): value is ProviderName {
  return value === "resend" || value === "mailtrap";
}

class HttpProvider implements EmailSender {
  constructor(
    private readonly provider: ProviderName,
    private readonly endpoint: string,
    private readonly key: string,
    private readonly from: string,
  ) {}

  async send(letter: Letter): Promise<void> {
    const body =
      this.provider === "resend"
        ? { from: this.from, to: [letter.to] }
        : { from: { email: this.from }, to: [{ email: letter.to }] };
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.provider === "resend") headers["Authorization"] = `Bearer ${this.key}`;
    else headers["Api-Token"] = this.key;

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, subject: subject(letter.kind), text: text(letter) }),
    });
    if (!response.ok) {
      // The body, not just the status: a provider that refuses a message says why, and that
      // sentence is the difference between a minute and an afternoon.
      throw new Error(
        `the email provider answered ${response.status}: ${await response.text().catch(() => "")}`,
      );
    }
  }
}

export function senderFor(config: Config): EmailSender | null {
  // In test-outbox mode nothing is sent: the object records the letter in a table the suite reads,
  // because no HTTP suite can read an inbox. `null` is what says "record it instead".
  if (config.testOutbox || !config.emailApiKey) return null;
  return new HttpProvider(
    config.emailProvider,
    config.emailEndpoint,
    config.emailApiKey,
    config.emailFrom,
  );
}

export { subject, text };
