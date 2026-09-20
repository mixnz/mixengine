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
  token: string;
  /** Where the address is confirmed, for the one letter that carries a link. */
  verifyUrl?: string;
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
      "Confirm this address to finish setting up your MixLab account:",
      "",
      letter.verifyUrl ?? letter.token,
      "",
      "The link works for 24 hours. If you did not ask for an account, ignore this message —",
      "nothing was created that you have to undo.",
    ].join("\n");
  }
  return [
    "Somebody asked to reset the password on this MixLab account. The code is:",
    "",
    letter.token,
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
 * A provider with an HTTP API, in the shape most of them use: a bearer key and a JSON body. Adding
 * a second provider is a second class here and one line in `senderFor` — which is the whole reason
 * this interface exists.
 */
class HttpProvider implements EmailSender {
  constructor(
    private readonly endpoint: string,
    private readonly key: string,
    private readonly from: string,
  ) {}

  async send(letter: Letter): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [letter.to],
        subject: subject(letter.kind),
        text: text(letter),
      }),
    });
    if (!response.ok) {
      // Loud, because the alternative is a person waiting for a letter that was never sent.
      throw new Error(`the email provider answered ${response.status}`);
    }
  }
}

export function senderFor(config: Config): EmailSender | null {
  // In test-outbox mode nothing is sent: the object records the letter in a table the suite reads,
  // because no HTTP suite can read an inbox. `null` is what says "record it instead".
  if (config.testOutbox || !config.emailApiKey) return null;
  return new HttpProvider(config.emailEndpoint, config.emailApiKey, config.emailFrom);
}

export { subject, text };
