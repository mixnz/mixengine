import { describe, expect, it } from "vitest";
import { DEFAULT_SEND_SETTINGS, buildRequest } from "./buildRequest";
import { parseCurl, parsePaste, splitArgs, toCurl } from "./parsePaste";
import { newRequest } from "./requests";
import type { RestRequest } from "./types";

describe("splitArgs", () => {
  it("cuts a command on whitespace", () => {
    expect(splitArgs("curl -X POST https://example.com")).toEqual([
      "curl",
      "-X",
      "POST",
      "https://example.com",
    ]);
  });

  it("takes a caret as cmd's escape once the paste is caret-escaped", () => {
    expect(splitArgs(`curl ^"https://x/?a=1^&b=2^"`)).toEqual(["curl", "https://x/?a=1&b=2"]);
  });

  it("leaves a caret alone in a command that is not caret-escaped", () => {
    expect(splitArgs(`curl -d 'a^b' https://x`)).toEqual(["curl", "-d", "a^b", "https://x"]);
  });

  it("keeps a single-quoted argument whole", () => {
    expect(splitArgs("curl -H 'Accept: application/json' https://x")).toEqual([
      "curl",
      "-H",
      "Accept: application/json",
      "https://x",
    ]);
  });

  it("takes a backslash inside single quotes literally", () => {
    expect(splitArgs(String.raw`curl -d 'a\b'`)).toEqual(["curl", "-d", String.raw`a\b`]);
  });

  it("unescapes a quote inside double quotes", () => {
    expect(splitArgs(String.raw`curl -d "{\"a\":1}"`)).toEqual(["curl", "-d", '{"a":1}']);
  });

  it("joins the lines of a command broken with backslashes", () => {
    const command = ["curl \\", "  -X POST \\", "  https://x"].join("\n");
    expect(splitArgs(command)).toEqual(["curl", "-X", "POST", "https://x"]);
  });

  it("joins the lines of a command broken the way cmd.exe breaks them", () => {
    expect(splitArgs("curl ^\n  -X POST ^\n  https://x")).toEqual([
      "curl",
      "-X",
      "POST",
      "https://x",
    ]);
  });

  it("keeps an argument quoted down to nothing", () => {
    expect(splitArgs("curl -d '' https://x")).toEqual(["curl", "-d", "", "https://x"]);
  });

  it("glues the quoted and unquoted halves of one word together", () => {
    expect(splitArgs("curl 'https://x'/path")).toEqual(["curl", "https://x/path"]);
  });

  // Someone pasted half a command, or a command whose quoting was already broken. Half an argument
  // is a better answer than none.
  it("takes an unclosed quote as the rest of the text", () => {
    expect(splitArgs("curl -d 'oops")).toEqual(["curl", "-d", "oops"]);
  });
});

/** Ids in the order they were asked for, so a test can name the rows it expects. */
function ids(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

describe("parseCurl", () => {
  it("reads the plainest command there is", () => {
    const parsed = parseCurl("curl https://example.com/items", ids());
    expect(parsed).toEqual({
      method: "GET",
      url: "https://example.com/items",
      params: [],
      headers: [],
      body: { kind: "none" },
      auth: { kind: "none" },
    });
  });

  it("is not a cURL command at all", () => {
    expect(parseCurl("wget https://example.com", ids())).toBeNull();
  });

  it("takes the method from -X, however it was written", () => {
    expect(parseCurl("curl -X post https://x", ids())?.method).toBe("POST");
    expect(parseCurl("curl -XPUT https://x", ids())?.method).toBe("PUT");
    expect(parseCurl("curl --request=PATCH https://x", ids())?.method).toBe("PATCH");
  });

  // The wire types name seven methods. A verb outside them is not one this client can send, so it
  // is left out rather than smuggled through as a string.
  it("ignores a verb this client has no name for", () => {
    expect(parseCurl("curl -X PROPFIND https://x", ids())?.method).toBe("GET");
  });

  it("reads headers into ticked rows, trimmed", () => {
    const parsed = parseCurl(
      "curl -H 'Accept: application/json' -H 'X-Token:abc' https://x",
      ids(),
    );
    expect(parsed?.headers).toEqual([
      { id: "id-1", enabled: true, key: "Accept", value: "application/json" },
      { id: "id-2", enabled: true, key: "X-Token", value: "abc" },
    ]);
  });

  it("keeps a header whose value has colons in it", () => {
    const parsed = parseCurl("curl -H 'X-When: 10:30:00' https://x", ids());
    expect(parsed?.headers[0].value).toBe("10:30:00");
  });

  it("passes over a header with no colon in it", () => {
    expect(parseCurl("curl -H 'Accept' https://x", ids())?.headers).toEqual([]);
  });

  it("takes the URL from --url", () => {
    expect(parseCurl("curl --url https://example.com/a https://decoy.example", ids())?.url).toBe(
      "https://example.com/a",
    );
  });

  it("prefers the argument that has a scheme", () => {
    expect(parseCurl("curl -o out.json https://example.com/a", ids())?.url).toBe(
      "https://example.com/a",
    );
  });

  it("takes a URL written without a scheme", () => {
    expect(parseCurl("curl example.com/items", ids())?.url).toBe("example.com/items");
    expect(parseCurl("curl localhost:3000/items", ids())?.url).toBe("localhost:3000/items");
  });

  it("ignores the flags that are this app's settings rather than this request's", () => {
    const parsed = parseCurl("curl -L -k --compressed https://x", ids());
    expect(parsed?.url).toBe("https://x");
    expect(parsed?.headers).toEqual([]);
  });

  it("splits the query into Params and leaves the box holding the whole URL", () => {
    const parsed = parseCurl("curl 'https://x/items?page=2&q=hello%20world'", ids());
    expect(parsed?.url).toBe("https://x/items?page=2&q=hello%20world");
    expect(parsed?.params).toEqual([
      { id: "id-1", enabled: true, key: "page", value: "2" },
      { id: "id-2", enabled: true, key: "q", value: "hello world" },
    ]);
  });

  // Phase 4 gives `{{var}}` a meaning. Until then it is text, and text is what must survive.
  it("leaves a variable in the URL exactly as it was written", () => {
    expect(parseCurl("curl '{{baseUrl}}/items' ", ids())?.url).toBe("{{baseUrl}}/items");
  });
});

/**
 * The flags that carry a value, and what happens to a value the walk does not know is one.
 *
 * Every expectation here was measured against curl 8.21 through a local echo server rather than
 * read off the manual — the encoding in particular is not what a JavaScript reflex would produce.
 */
describe("parseCurl value-taking flags", () => {
  /* The one from the review. `cookies.txt` satisfies `looksLikeUrl` — dot, word characters, end —
     so with `-c` missing from the skip list it became the address and the real one was ignored. */
  it("does not read the value of a flag it ignores as the address", () => {
    expect(parseCurl("curl -c cookies.txt localhost:3000/login", ids())?.url).toBe(
      "localhost:3000/login"
    );
    expect(parseCurl("curl -D headers.txt -w out.json https://x/y", ids())?.url).toBe("https://x/y");
    expect(parseCurl("curl --cacert ca.pem --key k.pem --cert c.pem https://x/y", ids())?.url).toBe(
      "https://x/y"
    );
    expect(parseCurl("curl -m 5 --resolve x:443:1.2.3.4 https://x/y", ids())?.url).toBe("https://x/y");
  });

  /* curl's `--json` is `--data-binary` plus two headers, and it sends both — so a command that
     pasted in as a bodyless GET is a POST with a JSON body and the headers written out. */
  it("reads --json as a JSON body with the two headers curl sends for it", () => {
    const parsed = parseCurl(`curl --json '{"a":1}' https://x`, ids());
    expect(parsed?.method).toBe("POST");
    expect(parsed?.body).toEqual({ kind: "raw", language: "json", text: '{"a":1}' });
    expect(parsed?.headers.map((h) => [h.key, h.value])).toEqual([
      ["Content-Type", "application/json"],
      ["Accept", "application/json"],
    ]);
  });

  /* Measured: `--json '{"a":1}' -H 'Content-Type: text/plain'` goes out as `text/plain`, with
     `Accept: application/json` still added beside it. */
  it("leaves a content type the command gave itself alone", () => {
    const parsed = parseCurl(`curl --json '{"a":1}' -H 'Content-Type: text/plain' https://x`, ids());
    expect(parsed?.headers.map((h) => [h.key, h.value])).toEqual([
      ["Content-Type", "text/plain"],
      ["Accept", "application/json"],
    ]);
  });

  /* The encoding is curl's, not `encodeURIComponent`'s: a space is `+`, and `!'()*` are escaped.
     Measured — `--data-urlencode "q=a b&c"` puts `q=a+b%26c` on the wire. */
  it("url-encodes --data-urlencode the way curl does", () => {
    expect(parseCurl(`curl --data-urlencode 'q=a b&c' https://x`, ids())?.body).toEqual({
      kind: "form",
      fields: [{ id: "id-1", enabled: true, key: "q", value: "a b&c" }],
    });
    // Straight at the joined text, since the form table decodes it back on the way in.
    const raw = (sql: string) => parseCurl(sql, ids());
    expect(raw(`curl --data-urlencode "k=a!b'c(d)e*f~g-h_i.j+k" https://x`)?.body).toEqual({
      kind: "form",
      fields: [{ id: "id-1", enabled: true, key: "k", value: "a!b'c(d)e*f~g-h_i.j+k" }],
    });
  });

  /* curl looks for `=` before it looks for `@`, so this is a name and a value and not a filename —
     measured, it answers `x=y%40z`. */
  it("takes an at sign after an equals as part of the value", () => {
    expect(parseCurl(`curl --data-urlencode 'x=y@z' https://x`, ids())?.body).toEqual({
      kind: "form",
      fields: [{ id: "id-1", enabled: true, key: "x", value: "y@z" }],
    });
  });

  /** `content` with no marker at all is all content and no name. */
  it("encodes a bare --data-urlencode value whole", () => {
    expect(parseCurl(`curl --data-urlencode 'plain val' https://x`, ids())?.body).toEqual({
      kind: "raw",
      language: "text",
      text: "plain+val",
    });
  });

  /* `@file` and `name@file` are files this app cannot read. Nothing to show for them — but the
     argument is still eaten, or it would go on to be read as the address. */
  it("eats a --data-urlencode that names a file without reading it as the address", () => {
    const parsed = parseCurl("curl --data-urlencode note@notes.txt https://x/y", ids());
    expect(parsed?.url).toBe("https://x/y");
    expect(parsed?.body).toEqual({ kind: "none" });
  });

  /* `-T` is a PUT of a file. The file cannot be read from here; the verb can still be right, and
     the path must not end up as the address. */
  it("keeps the verb of an upload and does not mistake the file for the address", () => {
    const parsed = parseCurl("curl -T report.csv https://x/y", ids());
    expect(parsed?.method).toBe("PUT");
    expect(parsed?.url).toBe("https://x/y");
  });

  /** `--form-string` is `-F` with the value taken exactly as written — no `@path`. */
  it("takes a --form-string value literally", () => {
    expect(parseCurl("curl --form-string 'note=@notafile' https://x", ids())?.body).toEqual({
      kind: "multipart",
      fields: [{ id: "id-1", enabled: true, key: "note", value: "@notafile" }],
    });
  });
});

describe("parseCurl bodies", () => {
  // curl's own rule is that `-d` means form-urlencoded. Nobody pasting a JSON object means that,
  // so a value that parses as JSON is read as JSON.
  it("reads a JSON value as a JSON body, and makes the request a POST", () => {
    const parsed = parseCurl(`curl https://x -d '{"name":"a"}'`, ids());
    expect(parsed?.method).toBe("POST");
    expect(parsed?.body).toEqual({ kind: "raw", language: "json", text: '{"name":"a"}' });
  });

  it("reads pairs as a form, decoded the way the Params table decodes", () => {
    const parsed = parseCurl("curl https://x -d 'q=hello%20world&page=2'", ids());
    expect(parsed?.body).toEqual({
      kind: "form",
      fields: [
        { id: "id-1", enabled: true, key: "q", value: "hello world" },
        { id: "id-2", enabled: true, key: "page", value: "2" },
      ],
    });
  });

  it("joins repeated data flags with an ampersand, as curl does", () => {
    const parsed = parseCurl("curl https://x -d 'a=1' --data-raw 'b=2'", ids());
    expect(parsed?.body).toEqual({
      kind: "form",
      fields: [
        { id: "id-1", enabled: true, key: "a", value: "1" },
        { id: "id-2", enabled: true, key: "b", value: "2" },
      ],
    });
  });

  it("falls back to plain text for a value that is neither", () => {
    expect(parseCurl("curl https://x -d 'hello'", ids())?.body).toEqual({
      kind: "raw",
      language: "text",
      text: "hello",
    });
  });

  it("believes a declared content type over what the body looks like", () => {
    expect(
      parseCurl(`curl https://x -H 'Content-Type: text/plain' -d '{"a":1}'`, ids())?.body,
    ).toEqual({ kind: "raw", language: "text", text: '{"a":1}' });
    expect(
      parseCurl("curl https://x -H 'Content-Type: application/xml' -d '<a/>'", ids())?.body,
    ).toEqual({ kind: "raw", language: "xml", text: "<a/>" });
    expect(
      parseCurl("curl https://x -H 'Content-Type: application/vnd.api+json' -d '[1]'", ids())?.body,
    ).toEqual({ kind: "raw", language: "json", text: "[1]" });
  });

  it("reads a declared form as a form even when the value is not pairs", () => {
    const parsed = parseCurl(
      "curl https://x -H 'Content-Type: application/x-www-form-urlencoded' -d 'a=1&b=2'",
      ids(),
    );
    expect(parsed?.body.kind).toBe("form");
  });

  it("keeps an explicit method even where a body would have implied another", () => {
    expect(parseCurl("curl -X GET https://x -d 'a=1'", ids())?.method).toBe("GET");
  });

  it("reads -F into multipart fields, with a file's path and without curl's type hint", () => {
    const parsed = parseCurl(
      "curl https://x -F 'name=Ann' -F 'avatar=@/tmp/a.png;type=image/png'",
      ids(),
    );
    expect(parsed?.method).toBe("POST");
    expect(parsed?.body).toEqual({
      kind: "multipart",
      fields: [
        { id: "id-1", enabled: true, key: "name", value: "Ann" },
        { id: "id-2", enabled: true, key: "avatar", value: "", file: "/tmp/a.png" },
      ],
    });
  });

  it("puts -G data in the query and leaves no body behind", () => {
    const parsed = parseCurl("curl -G https://x/items -d 'page=2&q=a'", ids());
    expect(parsed?.method).toBe("GET");
    expect(parsed?.url).toBe("https://x/items?page=2&q=a");
    expect(parsed?.body).toEqual({ kind: "none" });
    expect(parsed?.params.map((row) => row.key)).toEqual(["page", "q"]);
  });

  it("adds -G data to a query that was already there", () => {
    expect(parseCurl("curl -G 'https://x?a=1' -d 'b=2'", ids())?.url).toBe("https://x?a=1&b=2");
  });

  it("turns -u into basic auth, which is what the Auth tab is for", () => {
    const parsed = parseCurl("curl https://x -u 'user:pass'", ids());
    expect(parsed?.auth).toEqual({ kind: "basic", username: "user", password: "pass" });
    expect(parsed?.headers).toEqual([]);
  });

  // curl would prompt for the password. There is nobody to prompt, and an empty one is what the
  // command as written asks for.
  it("reads a -u with no password as an empty password", () => {
    const parsed = parseCurl("curl https://x -u user", ids());
    expect(parsed?.auth).toEqual({ kind: "basic", username: "user", password: "" });
  });

  // A colon in a password is legal and common; only the first one separates.
  it("splits -u on the first colon only", () => {
    const parsed = parseCurl("curl https://x -u 'user:a:b'", ids());
    expect(parsed?.auth).toEqual({ kind: "basic", username: "user", password: "a:b" });
  });

  it("leaves an Authorization header that was already given alone", () => {
    const parsed = parseCurl("curl https://x -H 'Authorization: Bearer t' -u 'user:pass'", ids());
    expect(parsed?.headers).toHaveLength(1);
    expect(parsed?.headers[0].value).toBe("Bearer t");
    expect(parsed?.auth).toEqual({ kind: "none" });
  });
});

describe("parsePaste", () => {
  it("claims a cURL command", () => {
    expect(parsePaste("curl https://x", ids())?.url).toBe("https://x");
  });

  it("claims one copied with the prompt in front of it", () => {
    expect(parsePaste("$ curl https://x", ids())?.url).toBe("https://x");
  });

  it("claims the Windows spelling", () => {
    expect(parsePaste("curl.exe https://x", ids())?.url).toBe("https://x");
  });

  it("claims one indented or broken across lines", () => {
    const command = ["  curl \\", "  -X POST \\", "  https://x"].join("\n");
    expect(parsePaste(command, ids())?.method).toBe("POST");
  });

  /* A URL is a field's value, not a whole request: the box and the Params table are already two
     views of one thing, so a plain paste lands in the box and comes out as rows by itself. Claiming
     it would break pasting a host into the middle of a URL being edited, and would gain nothing. */
  it("leaves a plain URL to the webview", () => {
    expect(parsePaste("https://example.com/items?a=1", ids())).toBeNull();
  });

  it("leaves anything else alone", () => {
    expect(parsePaste("", ids())).toBeNull();
    expect(parsePaste("   ", ids())).toBeNull();
    expect(parsePaste("select * from users", ids())).toBeNull();
    expect(parsePaste("curling is a sport", ids())).toBeNull();
  });
});

function request(over: Partial<RestRequest> = {}): RestRequest {
  return { ...newRequest("r", 1000), ...over };
}

/** What would go on the wire, minus the send id, which is minted fresh every time. */
function wire(source: RestRequest) {
  const { request_id: _ignored, ...rest } = buildRequest(source, "send", DEFAULT_SEND_SETTINGS);
  return rest;
}

describe("toCurl", () => {
  it("writes the plainest request as the plainest command", () => {
    expect(toCurl(request({ url: "https://x/items" }))).toBe("curl 'https://x/items'");
  });

  // -X is left out only where curl would have chosen the same verb anyway. A GET with a body must
  // still say so, or reading the command back would make it a POST.
  it("names the method whenever curl would guess another", () => {
    expect(toCurl(request({ method: "DELETE", url: "https://x/1" }))).toBe(
      "curl -X DELETE 'https://x/1'",
    );
    const withBody = request({
      url: "https://x",
      body: { kind: "raw", language: "text", text: "hi" },
    });
    expect(toCurl(withBody).startsWith("curl -X GET ")).toBe(true);
  });

  it("folds the parameters into the URL, as sending does", () => {
    const source = request({
      url: "https://x/items",
      params: [
        { id: "p1", enabled: true, key: "page", value: "2" },
        { id: "p2", enabled: false, key: "draft", value: "1" },
      ],
    });
    expect(toCurl(source)).toBe("curl 'https://x/items?page=2'");
  });

  it("writes the content type sending would have added", () => {
    const source = request({
      method: "POST",
      url: "https://x",
      body: { kind: "raw", language: "json", text: '{"a":1}' },
    });
    expect(toCurl(source)).toBe(
      [
        "curl -X POST 'https://x' \\",
        "  -H 'Content-Type: application/json' \\",
        `  --data-raw '{"a":1}'`,
      ].join("\n"),
    );
  });

  it("survives a quote in the body", () => {
    const source = request({
      method: "POST",
      url: "https://x",
      body: { kind: "raw", language: "text", text: "it's" },
    });
    expect(toCurl(source)).toContain(String.raw`--data-raw 'it'\''s'`);
  });

  it("writes multipart parts as -F, files and all", () => {
    const source = request({
      method: "POST",
      url: "https://x",
      body: {
        kind: "multipart",
        fields: [
          { id: "f1", enabled: true, key: "name", value: "Ann" },
          { id: "f2", enabled: true, key: "avatar", value: "", file: "/tmp/a.png" },
        ],
      },
    });
    expect(toCurl(source)).toContain("-F 'name=Ann'");
    expect(toCurl(source)).toContain("-F 'avatar=@/tmp/a.png'");
  });
});

describe("the round trip", () => {
  /** Copied out and pasted back sends the same thing. Not the same object — the row ids are new and
   *  a content type that was added on the way out is written down in the command — but the same
   *  method, URL, headers and body, which is what "the same request" means. */
  function roundTrip(source: RestRequest) {
    const back = parsePaste(toCurl(source), ids());
    expect(back).not.toBeNull();
    expect(wire({ ...newRequest("back", 2000), ...back! })).toEqual(wire(source));
  }

  it("a GET with parameters", () => {
    roundTrip(
      request({
        url: "https://x/items?page=2",
        params: [{ id: "p1", enabled: true, key: "page", value: "2" }],
      }),
    );
  });

  it("a POST with headers and a JSON body", () => {
    roundTrip(
      request({
        method: "POST",
        url: "https://x/items",
        headers: [{ id: "h1", enabled: true, key: "X-Token", value: "abc" }],
        body: { kind: "raw", language: "json", text: '{"name":"Ann"}' },
      }),
    );
  });

  it("a form body", () => {
    roundTrip(
      request({
        method: "POST",
        url: "https://x/login",
        body: {
          kind: "form",
          fields: [
            { id: "f1", enabled: true, key: "user", value: "ann" },
            { id: "f2", enabled: true, key: "pass", value: "hunter 2" },
          ],
        },
      }),
    );
  });

  it("a multipart body with a file in it", () => {
    roundTrip(
      request({
        method: "POST",
        url: "https://x/upload",
        body: {
          kind: "multipart",
          fields: [
            { id: "f1", enabled: true, key: "name", value: "Ann" },
            { id: "f2", enabled: true, key: "avatar", value: "", file: "/tmp/a.png" },
          ],
        },
      }),
    );
  });

  it("a URL with a variable still in it", () => {
    roundTrip(request({ url: "{{baseUrl}}/items" }));
  });

  it("basic credentials, which come back out as the header they are sent as", () => {
    roundTrip(
      request({
        url: "https://x/private",
        auth: { kind: "basic", username: "ann", password: "s3cret" },
      }),
    );
  });

  it("an API key in the query, which comes back out as a parameter", () => {
    roundTrip(
      request({
        url: "https://x/items",
        auth: { kind: "apiKey", name: "api_key", value: "abc", in: "query" },
      }),
    );
  });
});

/* The commands people actually paste. Not another unit of the walk above — these are the two shapes
   a real copy arrives in, whole, and they are what catches a flag read one argument out of step. */
describe("a command copied out of a browser", () => {
  it("reads the whole thing", () => {
    const command = [
      `curl 'https://api.example.com/v2/items?page=2&per_page=50' \\`,
      `  -X 'POST' \\`,
      `  -H 'accept: application/json, text/plain, */*' \\`,
      `  -H 'accept-language: en-GB,en;q=0.9' \\`,
      `  -H 'authorization: Bearer eyJhbGciOi.abc' \\`,
      `  -H 'content-type: application/json' \\`,
      `  -b 'session=deadbeef; theme=dark' \\`,
      `  -H 'user-agent: Mozilla/5.0' \\`,
      `  --data-raw '{"name":"Ann","tags":["a","b"]}' \\`,
      `  --compressed`,
    ].join("\n");

    const parsed = parsePaste(command, ids());
    expect(parsed?.method).toBe("POST");
    expect(parsed?.url).toBe("https://api.example.com/v2/items?page=2&per_page=50");
    expect(parsed?.params.map((row) => [row.key, row.value])).toEqual([
      ["page", "2"],
      ["per_page", "50"],
    ]);
    // The cookie is not a header row — it is a flag whose value must not be read as anything else.
    expect(parsed?.headers.map((row) => row.key)).toEqual([
      "accept",
      "accept-language",
      "authorization",
      "content-type",
      "user-agent",
    ]);
    expect(parsed?.body).toEqual({
      kind: "raw",
      language: "json",
      text: '{"name":"Ann","tags":["a","b"]}',
    });
  });

  it("reads the Windows spelling of the same thing", () => {
    const command = [
      `curl.exe "https://api.example.com/v2/items" ^`,
      `  -H "content-type: application/json" ^`,
      `  --data-raw "{\\"name\\":\\"Ann\\"}"`,
    ].join("\n");

    const parsed = parsePaste(command, ids());
    expect(parsed?.method).toBe("POST");
    expect(parsed?.url).toBe("https://api.example.com/v2/items");
    expect(parsed?.body).toEqual({ kind: "raw", language: "json", text: '{"name":"Ann"}' });
  });

  /* `Copy as cURL (cmd)` escapes for `cmd.exe` instead of quoting for a shell: every argument is
     wrapped in `^"`, every character cmd would otherwise act on carries a caret, and a quote inside
     a value comes out as `\^"`. The carets are cmd's own and none of them belong in the request. */
  it("reads the cmd spelling, carets and all", () => {
    const command = [
      `curl --url ^"https://api.example.com/v1/lead?_page=1^&locale=vi^&_orderBy=id:desc^" ^`,
      `  -H ^"Accept: application/json, text/plain, */*^" ^`,
      `  -H ^"Authorization: Bearer eyJhbGciOi.abc^" ^`,
      `  -H ^"sec-ch-ua: ^\\^"Chromium^\\^";v=^\\^"151^\\^"^" ^`,
      `  -H ^"sec-ch-ua-mobile: ?0^"`,
    ].join("\n");

    const parsed = parsePaste(command, ids());
    expect(parsed?.method).toBe("GET");
    expect(parsed?.url).toBe("https://api.example.com/v1/lead?_page=1&locale=vi&_orderBy=id:desc");
    expect(parsed?.params.map((row) => [row.key, row.value])).toEqual([
      ["_page", "1"],
      ["locale", "vi"],
      ["_orderBy", "id:desc"],
    ]);
    expect(parsed?.headers.map((row) => [row.key, row.value])).toEqual([
      ["Accept", "application/json, text/plain, */*"],
      ["Authorization", "Bearer eyJhbGciOi.abc"],
      ["sec-ch-ua", `"Chromium";v="151"`],
      ["sec-ch-ua-mobile", "?0"],
    ]);
  });

  /* A body in cmd form: the quotes around the JSON keys survive as `\^"`, and a real newline is
     written `^` then a blank line — the caret eats the first newline and the second one is the
     character that was in the value. */
  it("reads a cmd body with quotes and a newline in it", () => {
    const command = [
      `curl ^"https://api.example.com/v2/items^" ^`,
      `  -X POST ^`,
      `  -H ^"content-type: application/json^" ^`,
      `  --data-raw ^"{^\\^"note^\\^":^\\^"one^`,
      ``,
      `two^\\^"}^"`,
    ].join("\n");

    const parsed = parsePaste(command, ids());
    expect(parsed?.method).toBe("POST");
    expect(parsed?.body).toEqual({
      kind: "raw",
      language: "json",
      text: '{"note":"one\ntwo"}',
    });
  });
});
