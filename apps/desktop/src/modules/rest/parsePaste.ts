/**
 * What a paste into the URL box turns out to be, and the command a request turns back into.
 *
 * All pure: the ids of the rows it makes come from a `nextId` the caller supplies, and nothing in
 * here reads a clock or a clipboard. That is the point — a cURL command is the most error-prone
 * input this app takes, and this is the one file where it can be got wrong under `npm test`.
 */
import { DEFAULT_SEND_SETTINGS, buildRequest } from "./buildRequest";
import { decodeComponent, paramsFromUrl } from "./syncUrlParams";
import { METHODS } from "./types";
import type {
  Auth,
  Body,
  KeyValue,
  Method,
  MultipartField,
  RawLanguage,
  RestRequest,
  WireRequest,
} from "./types";

/** The characters a backslash escapes inside double quotes. Everywhere else in a double-quoted
 *  string a backslash is a literal backslash, which is what makes `"C:\path"` survive. */
const DOUBLE_QUOTE_ESCAPES = ['"', "\\", "$", "`"];

/** A command broken across lines, joined back into one. `\` is how a POSIX shell continues a line
 *  and `^` is how `cmd.exe` does; a command copied out of a terminal has one or the other. */
function joinContinuations(text: string): string {
  return text.replace(/[\\^]\r?\n/g, " ");
}

/** What a command escaped for `cmd.exe` looks like: an argument opened with a caret before its
 *  quote. `Copy as cURL (cmd)` writes every argument that way and a POSIX shell writes none, so a
 *  single one of these settles which of the two spellings the whole paste is in. Read off the text
 *  as it arrived, because once the carets are off there is nothing left to tell from. */
const CMD_ESCAPED = /\^"/;

/**
 * A `cmd.exe` command with cmd's own escaping taken back off.
 *
 * A caret in cmd hands the character after it through untouched: `^&` is an ampersand rather than
 * the start of a second command, and `^"` is a quote cmd itself does not act on — but that quote is
 * still handed to the program, which is exactly what holds `^"a^&b^"` together as one argument. So
 * the carets come off and everything else stays, leaving a command line in the ordinary shape the
 * tokenizer below already reads: quotes still quoting, and `\"` still an escaped quote.
 *
 * A caret before a newline escapes the newline, which is how cmd continues a line — and why a
 * newline inside a value is written as a caret and then a blank line: the caret eats the first
 * newline, and the second one is the character that was in the value.
 */
function unescapeCmd(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "^") {
      out += text[i];
      continue;
    }
    const next = text[i + 1];
    // A caret with nothing after it escapes nothing; cmd drops it and so does this.
    if (next === undefined) continue;
    i++;
    if (next === "\n") continue;
    if (next === "\r") {
      if (text[i + 1] === "\n") i++;
      continue;
    }
    out += next;
  }
  return out;
}

/**
 * A command line cut into arguments, the way a shell would cut it.
 *
 * Single quotes take everything literally, double quotes take everything but the four characters
 * above, and a bare backslash escapes the character after it. An unterminated quote is not an
 * error: the text was pasted by a human and half of it is still worth reading.
 *
 * A caret-escaped command has cmd's layer taken off first, which is also where its line
 * continuations are dealt with — so a caret that is left over from `^^` is a caret in a value and
 * not the end of a line.
 */
export function splitArgs(text: string): string[] {
  const source = CMD_ESCAPED.test(text) ? unescapeCmd(text) : joinContinuations(text);
  const args: string[] = [];
  let arg = "";
  /** Whether anything has been put into `arg` — including a quote that opened and closed with
   *  nothing between, which is a real empty argument and not the gap between two others. */
  let started = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];

    if (quote === "'") {
      if (char === "'") quote = null;
      else arg += char;
      continue;
    }

    if (quote === '"') {
      if (char === "\\" && DOUBLE_QUOTE_ESCAPES.includes(source[i + 1] ?? "")) arg += source[++i];
      else if (char === '"') quote = null;
      else arg += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }
    if (char === "\\" && i + 1 < source.length) {
      arg += source[++i];
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) {
        args.push(arg);
        arg = "";
        started = false;
      }
      continue;
    }
    arg += char;
    started = true;
  }

  if (started) args.push(arg);
  return args;
}

/** The part of a request a paste can know about. The rest of `RestRequest` — the id, the name, the
 *  timestamps, which group it belongs to — is the caller's, because only the caller knows whether
 *  this is a new row or the one already on screen. */
export interface ParsedRequest {
  method: Method;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: Body;
  /** From `-u`. A command that also gives an `Authorization` header keeps the header and sets no
   *  auth, so what the Auth tab shows and what goes on the wire never disagree. */
  auth: Auth;
}

/** Short flags that take a value, which is written either after a space or glued straight on. */
const SHORT_WITH_VALUE = ["-X", "-H", "-d", "-F", "-u"];

/**
 * Flags whose value this client has no use for, named only so the value is not mistaken for the
 * URL: `curl -o out.json https://…` has two arguments that look like addresses and one that is.
 *
 * Dull on purpose, and long on purpose. A value-taking flag left out of here does not fail loudly:
 * its value falls through to `bare`, where `looksLikeUrl` is perfectly happy to read `cookies.txt`
 * as a host — so `curl -c cookies.txt localhost:3000/login` used to paste in as a request to
 * `cookies.txt`. Everything curl might sensibly be seen carrying in a copied command belongs here,
 * whether or not this app could do anything with it.
 */
const SKIPPED_WITH_VALUE = new Set([
  // Where the answer goes
  "-o",
  "--output",
  "--output-dir",
  "-w",
  "--write-out",
  "-D",
  "--dump-header",
  "--trace",
  "--trace-ascii",
  "--stderr",
  // Who the client says it is
  "-A",
  "--user-agent",
  "-e",
  "--referer",
  "-b",
  "--cookie",
  "-c",
  "--cookie-jar",
  "--oauth2-bearer",
  // Through what
  "-x",
  "--proxy",
  "-U",
  "--proxy-user",
  "--noproxy",
  "--proxy-header",
  "--interface",
  "--unix-socket",
  "--dns-servers",
  "--local-port",
  "--resolve",
  "--connect-to",
  // Certificates and ciphers
  "-E",
  "--cert",
  "--cert-type",
  "--key",
  "--key-type",
  "--pass",
  "--cacert",
  "--capath",
  "--crlfile",
  "--pinnedpubkey",
  "--ciphers",
  "--tls-max",
  // How long, how fast, how much
  "-m",
  "--max-time",
  "--connect-timeout",
  "--retry",
  "--retry-delay",
  "--retry-max-time",
  "--limit-rate",
  "--max-filesize",
  "--max-redirs",
  "-y",
  "--speed-time",
  "-Y",
  "--speed-limit",
  // Which part of it, and from where
  "-C",
  "--continue-at",
  "-r",
  "--range",
  "-K",
  "--config",
  "--alt-svc",
  "--hsts",
  "--proto",
  "--proto-redir",
]);

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * `-XPOST` and `--request=POST` written out as two arguments.
 *
 * Both spellings are what a real copied command looks like — browsers write the long one, people
 * write the short one — and normalising here leaves the walk below with a single shape to read.
 */
function normalise(args: string[]): string[] {
  const out: string[] = [];
  for (const arg of args) {
    const short = SHORT_WITH_VALUE.find((flag) => arg.startsWith(flag) && arg.length > flag.length);
    if (short !== undefined) {
      out.push(short, arg.slice(short.length));
      continue;
    }
    const equals = arg.startsWith("--") ? arg.indexOf("=") : -1;
    if (equals !== -1) {
      out.push(arg.slice(0, equals), arg.slice(equals + 1));
      continue;
    }
    out.push(arg);
  }
  return out;
}

/** Whether a bare argument could be the address. A scheme is the sure sign; `example.com/x`,
 *  `localhost:3000` and `{{baseUrl}}/x` are what people write when they leave it out. */
function looksLikeUrl(arg: string): boolean {
  return (
    SCHEME.test(arg) ||
    arg.startsWith("{{") ||
    /^localhost([:/]|$)/i.test(arg) ||
    /^[\w-]+(\.[\w-]+)+([:/?]|$)/.test(arg)
  );
}

function headerValue(headers: KeyValue[], name: string): string | null {
  const found = headers.find((row) => row.key.toLowerCase() === name);
  return found?.value ?? null;
}

/** The notation a declared content type implies, or null when it names none this editor knows.
 *  Suffix matching rather than a list: `application/vnd.api+json` is JSON, and so is every other
 *  vendor type that ends that way. */
function languageOf(contentType: string): RawLanguage | null {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type.endsWith("json")) return "json";
  if (type.endsWith("xml")) return "xml";
  if (type.endsWith("yaml") || type.endsWith("yml")) return "yaml";
  if (type.startsWith("text/")) return "text";
  return null;
}

/** A `key=value&key=value` body as rows, decoded for the table the way the Params table decodes. */
function formFields(text: string, nextId: () => string): KeyValue[] {
  return text
    .split("&")
    .filter((pair) => pair !== "")
    .map((pair) => {
      const eq = pair.indexOf("=");
      return {
        id: nextId(),
        enabled: true,
        key: eq === -1 ? decodeComponent(pair) : decodeComponent(pair.slice(0, eq)),
        value: eq === -1 ? "" : decodeComponent(pair.slice(eq + 1)),
      };
    });
}

/**
 * One piece of `--data-urlencode`, encoded the way curl encodes it.
 *
 * Which is *not* `encodeURIComponent`: measured against curl 8.21, a space comes out as `+` and
 * `!`, `'`, `(`, `)` and `*` come out escaped, leaving only the RFC 3986 unreserved set — so
 * `q=a b&c` becomes `q=a+b%26c`.
 */
function formEscape(text: string): string {
  return encodeURIComponent(text)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

/**
 * `--data-urlencode`'s five spellings as the piece of body each stands for, or null for the two
 * that name a file this app cannot read.
 *
 * curl looks for `=` first and only then for `@`, so `x=y@z` is a name and a value rather than a
 * name and a filename — checked against curl, which answers `x=y%40z`. `content` on its own is all
 * content and no name; `=content` is the same with the marker written out.
 */
function urlEncoded(raw: string): string | null {
  const eq = raw.indexOf("=");
  if (eq !== -1) return `${raw.slice(0, eq)}${eq === 0 ? "" : "="}${formEscape(raw.slice(eq + 1))}`;
  if (raw.includes("@")) return null;
  return formEscape(raw);
}

/** One `-F` part. `name=@path` sends a file; the `;type=…` curl allows after the path is it telling
 *  the server what the file is, which the parts table has nowhere to put. */
function formField(raw: string, nextId: () => string): MultipartField {
  const eq = raw.indexOf("=");
  const key = eq === -1 ? raw : raw.slice(0, eq);
  const rest = eq === -1 ? "" : raw.slice(eq + 1);
  if (rest.startsWith("@")) {
    return { id: nextId(), enabled: true, key, value: "", file: rest.slice(1).split(";")[0] };
  }
  return { id: nextId(), enabled: true, key, value: rest };
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * What those data flags add up to.
 *
 * A declared `Content-Type` is believed first, because someone wrote it down. With none, an object
 * or an array that parses is JSON — curl's own rule says form-urlencoded, and curl's own rule is
 * not what anybody pasting `-d '{"…"}'` means. Failing both, pairs are a form and anything else is
 * text, which at least shows the user what they pasted.
 */
function dataBody(data: string[], contentType: string | null, nextId: () => string): Body {
  const text = data.join("&");
  const declared = contentType === null ? null : contentType.split(";")[0].trim().toLowerCase();
  if (declared === "application/x-www-form-urlencoded") {
    return { kind: "form", fields: formFields(text, nextId) };
  }
  const language = declared === null ? null : languageOf(declared);
  if (language !== null) return { kind: "raw", language, text };
  if (looksLikeJson(text)) return { kind: "raw", language: "json", text };
  if (text.includes("=")) return { kind: "form", fields: formFields(text, nextId) };
  return { kind: "raw", language: "text", text };
}

function appendQuery(url: string, query: string): string {
  if (query === "") return url;
  return url.includes("?") ? `${url}&${query}` : `${url}?${query}`;
}

/**
 * A cURL command read into the part of a request it describes, or null when it is not one.
 *
 * Flags this client has nothing to do with are passed over rather than refused — `-L`, `-k` and
 * `--compressed` say how a client behaves, which in this app is a global setting and not part of
 * any one request, and a command full of `--silent` and `--fail` is still a request.
 */
export function parseCurl(text: string, nextId: () => string): ParsedRequest | null {
  const args = normalise(splitArgs(text));
  // `curl.exe` is what Windows copies, and a `$` prompt often comes along for the ride.
  if (!/^(\$)?curl(\.exe)?$/i.test(args[0] ?? "")) return null;

  let method: Method | null = null;
  let flagUrl = "";
  const bare: string[] = [];
  const headers: KeyValue[] = [];
  const data: string[] = [];
  const form: MultipartField[] = [];
  let user: string | null = null;
  let asQuery = false;
  /* `--json` is curl's shorthand for `--data-binary` plus a Content-Type and an Accept. Remembered
     rather than acted on where it is read, because a `-H` written after it still wins and the
     headers can only be compared once the whole command has been walked. */
  let jsonShortcut = false;
  /* `-T` is a PUT of a file this app has no way to read. The verb is the half that survives. */
  let upload = false;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "-X":
      case "--request": {
        const wanted = (args[++i] ?? "").toUpperCase();
        if ((METHODS as string[]).includes(wanted)) method = wanted as Method;
        break;
      }
      case "-H":
      case "--header": {
        const raw = args[++i] ?? "";
        const colon = raw.indexOf(":");
        // `-H 'Accept;'` is curl's way of unsetting a header it would have sent by itself. There is
        // nothing for the table to show for it.
        if (colon === -1) break;
        const key = raw.slice(0, colon).trim();
        if (key !== "") {
          headers.push({ id: nextId(), enabled: true, key, value: raw.slice(colon + 1).trim() });
        }
        break;
      }
      case "--url":
        flagUrl = args[++i] ?? "";
        break;
      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-binary":
      case "--data-ascii":
        data.push(args[++i] ?? "");
        break;
      case "--data-urlencode": {
        const piece = urlEncoded(args[++i] ?? "");
        // The `@filename` spellings. Nothing to read and nothing to show, but the argument is
        // still eaten so it cannot go on to be read as the address.
        if (piece !== null) data.push(piece);
        break;
      }
      case "--json":
        jsonShortcut = true;
        data.push(args[++i] ?? "");
        break;
      case "-T":
      case "--upload-file":
        upload = true;
        i++;
        break;
      case "-F":
      case "--form":
        form.push(formField(args[++i] ?? "", nextId));
        break;
      // Like `-F`, except the value is taken exactly as written — no `@path`, no `<path`.
      case "--form-string": {
        const raw = args[++i] ?? "";
        const eq = raw.indexOf("=");
        form.push({
          id: nextId(),
          enabled: true,
          key: eq === -1 ? raw : raw.slice(0, eq),
          value: eq === -1 ? "" : raw.slice(eq + 1),
        });
        break;
      }
      case "-u":
      case "--user":
        user = args[++i] ?? "";
        break;
      case "-G":
      case "--get":
        asQuery = true;
        break;
      default:
        if (SKIPPED_WITH_VALUE.has(arg)) {
          i++;
          break;
        }
        if (!arg.startsWith("-")) bare.push(arg);
        break;
    }
  }

  /* Added here and not where `--json` was read, so a header the command gives itself keeps the
     field. That is curl's own answer: `--json '{}' -H 'Content-Type: text/plain'` goes out as
     `text/plain` with `Accept: application/json` still added beside it. */
  if (jsonShortcut) {
    for (const name of ["Content-Type", "Accept"]) {
      if (headerValue(headers, name.toLowerCase()) === null) {
        headers.push({ id: nextId(), enabled: true, key: name, value: "application/json" });
      }
    }
  }

  const bareUrl = bare.find((arg) => SCHEME.test(arg)) ?? bare.find(looksLikeUrl) ?? "";
  const address = flagUrl !== "" ? flagUrl : bareUrl;
  // -G: the data is the query, not the body.
  const url = asQuery ? appendQuery(address, data.join("&")) : address;

  /* A body already there says POST; -G says the opposite. An explicit -X beats both — curl honours
     it, and so does anyone reading the command. */
  const implied: Method = asQuery
    ? "GET"
    : data.length > 0 || form.length > 0
      ? "POST"
      : upload
        ? "PUT"
        : "GET";

  const body: Body =
    form.length > 0
      ? { kind: "multipart", fields: form }
      : asQuery || data.length === 0
        ? { kind: "none" }
        : dataBody(data, headerValue(headers, "content-type"), nextId);

  /* `-u` becomes basic auth rather than a header, now that there is a tab to show it in. An
     Authorization header given as well wins — `buildRequest` would drop the auth anyway, and a tab
     showing credentials that are not the ones being sent is worse than no tab at all. */
  const colon = user === null ? -1 : user.indexOf(":");
  const auth: Auth =
    user === null || headerValue(headers, "authorization") !== null
      ? { kind: "none" }
      : {
          kind: "basic",
          username: colon === -1 ? user : user.slice(0, colon),
          password: colon === -1 ? "" : user.slice(colon + 1),
        };

  return {
    method: method ?? implied,
    url,
    params: paramsFromUrl(url, [], nextId),
    headers,
    body,
    auth,
  };
}

/**
 * A paste read as a request, or null when it is just text.
 *
 * Only a cURL command is claimed. A pasted URL is left to the webview on purpose: the URL box and
 * the Params table are already two views of one thing, so a whole pasted URL becomes rows the moment
 * the box changes — and claiming the paste would stop a host pasted over part of a URL from
 * replacing it, which is what pasting into a text box is for.
 */
export function parsePaste(text: string, nextId: () => string): ParsedRequest | null {
  const trimmed = text.trim();
  if (!/^(\$\s+)?curl(\.exe)?(\s|$)/i.test(trimmed)) return null;
  return parseCurl(trimmed.replace(/^\$\s+/, ""), nextId);
}

/** A single-quoted argument. Single quotes take everything literally, so the only character that
 *  needs care is the quote itself: close, escape one, reopen — the `'\''` every shell script has in
 *  it somewhere. */
function quote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * The command that would send this request.
 *
 * Written from the `WireRequest` rather than from the request pane, so what it says is what the app
 * would actually send: the URL with its parameters already folded in, and the content type whether
 * it was typed by hand or added on the way out.
 *
 * The three send settings are deliberately absent, which is also why the parser passes over `-L`,
 * `-k` and `--compressed`: those say how a client behaves, and in this app that is one global
 * setting rather than a property of any one request. Which `SendSettings` is passed below therefore
 * cannot change a character of the output.
 *
 * Broken across lines the way a command is written out for someone to read. `splitArgs` joins those
 * lines back up, so a command copied out of here pastes back in.
 */
export function toCurl(request: RestRequest): string {
  const wire: WireRequest = buildRequest(request, "curl", DEFAULT_SEND_SETTINGS);
  const head = ["curl"];
  // Named unless curl would have guessed the same verb from the body — see the test for this.
  if (!(wire.method === "GET" && wire.body.kind === "none")) head.push("-X", wire.method);
  head.push(quote(wire.url));

  const lines = [head.join(" ")];
  for (const [key, value] of wire.headers) lines.push(`-H ${quote(`${key}: ${value}`)}`);
  switch (wire.body.kind) {
    case "text":
      lines.push(`--data-raw ${quote(wire.body.text)}`);
      break;
    case "file":
      lines.push(`--data-binary ${quote(`@${wire.body.path}`)}`);
      break;
    case "multipart":
      for (const part of wire.body.parts) {
        const field =
          part.path !== null ? `${part.name}=@${part.path}` : `${part.name}=${part.value ?? ""}`;
        lines.push(`-F ${quote(field)}`);
      }
      break;
    case "none":
      break;
  }
  return lines.join(" \\\n  ");
}
