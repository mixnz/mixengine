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
 * **Six providers, because one proves nothing.** The paragraph above is a claim, and a single
 * implementation cannot test it, in exactly the way `/v1` needs two servers before it is a protocol
 * rather than a description of one. These six disagree about nearly everything a naive interface
 * would have assumed was fixed: **three ways of carrying the key** (a bearer token, a header of the
 * provider's own, HTTP basic auth), **two body encodings** (JSON and a form), and **five different
 * spellings of "who is this from"**. A design that only ever had to swap a URL would have got all
 * three wrong.
 *
 * **`smtp` is deliberately absent here**, and `../native/` has it. Workers cannot open a socket to
 * port 587, so this is the one capability the two implementations do not share — and the one a
 * person self-hosting is most likely to want, which is why the implementation they run is the one
 * that speaks it. Naming it here is refused by name rather than ignored.
 */
export type ProviderName =
  | "resend"
  | "mailtrap"
  | "brevo"
  | "postmark"
  | "sendgrid"
  | "mailgun";

// Alphabetical, so that neither the list nor the message a deployer reads when they get the name
// wrong reads as a recommendation. This project does not pick a company on their behalf.
export const PROVIDER_NAMES = [
  "brevo",
  "mailgun",
  "mailtrap",
  "postmark",
  "resend",
  "sendgrid",
] as const;

export function isProviderName(value: string): value is ProviderName {
  return (PROVIDER_NAMES as readonly string[]).includes(value);
}

/**
 * Where to post, when the endpoint is the same for everybody using that provider. Mailtrap's is its
 * transactional stream, which is what the two letters are; only its sandbox URL carries an id, and a
 * deployment testing against one sets it. Mailgun is absent on purpose: its URL carries the sending
 * domain and the region, so there is nothing to guess and a deployment that forgot it is told
 * before it serves anything.
 */
export const DEFAULT_ENDPOINT: Partial<Record<ProviderName, string>> = {
  resend: "https://api.resend.com/emails",
  mailtrap: "https://send.api.mailtrap.io/api/send",
  brevo: "https://api.brevo.com/v3/smtp/email",
  postmark: "https://api.postmarkapp.com/email",
  sendgrid: "https://api.sendgrid.com/v3/mail/send",
};

export const NEEDS_ENDPOINT: readonly ProviderName[] = ["mailgun"];

/** Shown beside the address when a deployment names nobody else. */
export const DEFAULT_FROM_NAME = "MixLab";

/**
 * `Name <address>`, for the providers that take the sender as one string. A name holding any of
 * RFC 5322's specials is quoted, or `Acme, Inc.` would read as two addresses.
 */
export function mailbox(name: string, address: string): string {
  const display = /[()<>[\]:;@\\,."]/.test(name)
    ? `"${name.replace(/[\\"]/g, "\\$&")}"`
    : name;
  return `${display} <${address}>`;
}

class HttpProvider implements EmailSender {
  constructor(
    private readonly provider: ProviderName,
    private readonly endpoint: string,
    private readonly key: string,
    private readonly from: string,
    private readonly fromName: string,
  ) {}

  async send(letter: Letter): Promise<void> {
    const subjectLine = subject(letter.kind);
    const textBody = text(letter);
    const to = letter.to;

    const headers: Record<string, string> = {};
    switch (this.provider) {
      case "resend":
      case "sendgrid":
        headers["Authorization"] = `Bearer ${this.key}`;
        break;
      case "mailtrap":
        headers["Api-Token"] = this.key;
        break;
      case "brevo":
        headers["api-key"] = this.key;
        break;
      case "postmark":
        headers["X-Postmark-Server-Token"] = this.key;
        break;
      case "mailgun":
        // The one that does not carry a key in a header at all.
        headers["Authorization"] = `Basic ${btoa(`api:${this.key}`)}`;
        break;
    }

    let body: string;
    if (this.provider === "mailgun") {
      // Form-encoded, which is why the body shape is a per-provider decision and not one field.
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams({
        from: mailbox(this.fromName, this.from),
        to,
        subject: subjectLine,
        text: textBody,
      }).toString();
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(bodyFor(this.provider, this.from, this.fromName, to, subjectLine, textBody));
    }

    const response = await fetch(this.endpoint, { method: "POST", headers, body });
    if (!response.ok) {
      // The body, not just the status: a provider that refuses a message says why, and that
      // sentence is the difference between a minute and an afternoon.
      throw new Error(
        `the email provider answered ${response.status}: ${await response.text().catch(() => "")}`,
      );
    }
  }
}

function bodyFor(
  provider: Exclude<ProviderName, "mailgun">,
  from: string,
  fromName: string,
  to: string,
  subjectLine: string,
  textBody: string,
): unknown {
  switch (provider) {
    case "resend":
      return { from: mailbox(fromName, from), to: [to], subject: subjectLine, text: textBody };
    case "mailtrap":
      return {
        from: { email: from, name: fromName },
        to: [{ email: to }],
        subject: subjectLine,
        text: textBody,
      };
    case "brevo":
      return {
        sender: { email: from, name: fromName },
        to: [{ email: to }],
        subject: subjectLine,
        textContent: textBody,
      };
    case "postmark":
      return { From: mailbox(fromName, from), To: to, Subject: subjectLine, TextBody: textBody };
    case "sendgrid":
      return {
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from, name: fromName },
        subject: subjectLine,
        content: [{ type: "text/plain", value: textBody }],
      };
  }
}

export function senderFor(config: Config): EmailSender | null {
  // In test-outbox mode nothing is sent: the object records the letter in a table the suite reads,
  // because no HTTP suite can read an inbox. `null` is what says "record it instead".
  if (config.testOutbox || !config.emailApiKey || !config.emailEndpoint) return null;
  return new HttpProvider(
    config.emailProvider,
    config.emailEndpoint,
    config.emailApiKey,
    config.emailFrom,
    config.emailFromName,
  );
}

export { subject, text };
