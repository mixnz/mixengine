import { describe, expect, it } from "vitest";
import { decodeComponent, foldQuery, paramsFromUrl, replaceQuery, urlWithParams } from "./syncUrlParams";
import type { KeyValue } from "./types";

/** Ids in order, so a test can say which row it means. */
function counter() {
  let n = 0;
  return () => `new-${++n}`;
}

function row(over: Partial<KeyValue> & { id: string }): KeyValue {
  return { enabled: true, key: "", value: "", ...over };
}

describe("paramsFromUrl", () => {
  it("makes a row per query parameter", () => {
    expect(paramsFromUrl("https://x.test/a?page=2&q=hi", [], counter())).toEqual([
      row({ id: "new-1", key: "page", value: "2" }),
      row({ id: "new-2", key: "q", value: "hi" }),
    ]);
  });

  it("decodes percent escapes and pluses", () => {
    const params = paramsFromUrl("https://x.test/a?q=a%20b+c&t=%26", [], counter());
    expect(params.map((p) => p.value)).toEqual(["a b c", "&"]);
  });

  it("gives a parameter with no value an empty one", () => {
    expect(paramsFromUrl("https://x.test/a?flag", [], counter())[0]).toEqual(
      row({ id: "new-1", key: "flag", value: "" }),
    );
  });

  // The URL is the only source for the rows that are in it, so a row that was there keeps its id
  // and its tick and is simply refilled — which is what stops the table's rows jumping about as
  // the URL is typed.
  it("refills the rows already there rather than replacing them", () => {
    const existing = [row({ id: "kept", key: "page", value: "1" })];
    expect(paramsFromUrl("https://x.test/a?page=9", existing, counter())).toEqual([
      row({ id: "kept", key: "page", value: "9" }),
    ]);
  });

  // An unticked row is not in the URL, so the URL cannot say anything about it — it stays put,
  // which is the whole point of being able to untick one.
  it("keeps unticked rows and passes over them", () => {
    const existing = [
      row({ id: "off", enabled: false, key: "debug", value: "1" }),
      row({ id: "on", key: "page", value: "1" }),
    ];
    expect(paramsFromUrl("https://x.test/a?page=2", existing, counter())).toEqual([
      row({ id: "off", enabled: false, key: "debug", value: "1" }),
      row({ id: "on", key: "page", value: "2" }),
    ]);
  });

  it("drops the ticked rows the URL no longer has", () => {
    const existing = [row({ id: "a", key: "page", value: "1" }), row({ id: "b", key: "q", value: "x" })];
    expect(paramsFromUrl("https://x.test/a?page=1", existing, counter()).map((p) => p.id)).toEqual(["a"]);
  });

  it("finds nothing in a URL with no query", () => {
    expect(paramsFromUrl("https://x.test/a", [], counter())).toEqual([]);
  });

  it("stops at the fragment", () => {
    expect(paramsFromUrl("https://x.test/a?page=2#section", [], counter())).toEqual([
      row({ id: "new-1", key: "page", value: "2" }),
    ]);
  });
});

describe("foldQuery", () => {
  it("moves a typed query into the table and leaves the box holding the address", () => {
    expect(foldQuery({ url: "https://x.test/a?page=2&q=hi", params: [] }, counter())).toEqual({
      url: "https://x.test/a",
      params: [
        row({ id: "new-1", key: "page", value: "2" }),
        row({ id: "new-2", key: "q", value: "hi" }),
      ],
    });
  });

  it("adds after the rows already there, unticked ones included", () => {
    const params = [
      row({ id: "off", enabled: false, key: "debug", value: "1" }),
      row({ id: "on", key: "locale", value: "vi" }),
    ];
    expect(foldQuery({ url: "https://x.test/a?page=2", params }, counter()).params).toEqual([
      ...params,
      row({ id: "new-1", key: "page", value: "2" }),
    ]);
  });

  // A request saved while the box and the table were two copies of each other.
  it("does not double a query the ticked rows already hold", () => {
    const params = [row({ id: "a", key: "page", value: "2" }), row({ id: "b", key: "q", value: "hi" })];
    expect(foldQuery({ url: "https://x.test/a?page=2&q=hi", params }, counter())).toEqual({
      url: "https://x.test/a",
      params,
    });
  });

  it("matches one row per pair, so a key given twice is added once more", () => {
    const params = [row({ id: "a", key: "id", value: "1" })];
    expect(foldQuery({ url: "https://x.test/a?id=1&id=1", params }, counter()).params).toEqual([
      ...params,
      row({ id: "new-1", key: "id", value: "1" }),
    ]);
  });

  it("does not take an unticked row as the pair", () => {
    const params = [row({ id: "off", enabled: false, key: "page", value: "2" })];
    expect(foldQuery({ url: "https://x.test/a?page=2", params }, counter()).params).toEqual([
      ...params,
      row({ id: "new-1", key: "page", value: "2" }),
    ]);
  });

  it("keeps the fragment in the box", () => {
    expect(foldQuery({ url: "https://x.test/a?page=2#top", params: [] }, counter()).url).toBe(
      "https://x.test/a#top",
    );
  });

  it("drops a question mark with nothing after it", () => {
    expect(foldQuery({ url: "https://x.test/a?", params: [] }, counter())).toEqual({
      url: "https://x.test/a",
      params: [],
    });
  });

  it("keeps a {{variable}} as typed", () => {
    expect(foldQuery({ url: "{{host}}/a?key={{apiKey}}", params: [] }, counter())).toEqual({
      url: "{{host}}/a",
      params: [row({ id: "new-1", key: "key", value: "{{apiKey}}" })],
    });
  });

  it("hands back the same object when there is no query", () => {
    const request = { url: "https://x.test/a", params: [] };
    expect(foldQuery(request, counter())).toBe(request);
  });
});

describe("replaceQuery", () => {
  it("replaces the ticked rows with the pasted query and leaves the box holding the address", () => {
    const params = [row({ id: "a", key: "locale", value: "vi" }), row({ id: "b", key: "_route", value: "role" })];
    expect(replaceQuery({ url: "https://x.test/items?page=2", params }, counter())).toEqual({
      url: "https://x.test/items",
      params: [row({ id: "a", key: "page", value: "2" })],
    });
  });

  it("keeps the unticked rows where they were", () => {
    const params = [
      row({ id: "off", enabled: false, key: "debug", value: "1" }),
      row({ id: "on", key: "page", value: "1" }),
    ];
    expect(replaceQuery({ url: "https://x.test/a?page=2&q=hi", params }, counter()).params).toEqual([
      row({ id: "off", enabled: false, key: "debug", value: "1" }),
      row({ id: "on", key: "page", value: "2" }),
      row({ id: "new-1", key: "q", value: "hi" }),
    ]);
  });

  it("leaves the table alone when the pasted URL has no query", () => {
    const request = { url: "https://x.test/a", params: [row({ id: "a", key: "page", value: "2" })] };
    expect(replaceQuery(request, counter())).toBe(request);
  });

  it("keeps the fragment in the box", () => {
    expect(replaceQuery({ url: "https://x.test/a?page=2#top", params: [] }, counter()).url).toBe(
      "https://x.test/a#top",
    );
  });
});

describe("urlWithParams", () => {
  it("writes the ticked rows back onto the URL", () => {
    const params = [row({ id: "a", key: "page", value: "2" }), row({ id: "b", key: "q", value: "hi" })];
    expect(urlWithParams("https://x.test/a", params)).toBe("https://x.test/a?page=2&q=hi");
  });

  it("replaces whatever query was there", () => {
    expect(urlWithParams("https://x.test/a?old=1", [row({ id: "a", key: "new", value: "2" })])).toBe(
      "https://x.test/a?new=2",
    );
  });

  it("leaves unticked rows out", () => {
    const params = [row({ id: "a", enabled: false, key: "debug", value: "1" })];
    expect(urlWithParams("https://x.test/a?debug=1", params)).toBe("https://x.test/a");
  });

  it("leaves out a row with no key, which is the empty row waiting to be typed in", () => {
    expect(urlWithParams("https://x.test/a", [row({ id: "a", key: "", value: "x" })])).toBe("https://x.test/a");
  });

  it("encodes what would otherwise change the query's shape", () => {
    const params = [row({ id: "a", key: "q", value: "a b&c=d" })];
    expect(urlWithParams("https://x.test/a", params)).toBe("https://x.test/a?q=a%20b%26c%3Dd");
  });

  // A variable that came out as `%7B%7Btoken%7D%7D` would no longer be one: Phase 4 resolves
  // `{{name}}` on the finished URL, and the braces have to survive to be found there.
  it("leaves a {{variable}} legible", () => {
    const params = [row({ id: "a", key: "key", value: "{{apiKey}}" })];
    expect(urlWithParams("https://x.test/a", params)).toBe("https://x.test/a?key={{apiKey}}");
  });

  it("keeps the fragment at the end", () => {
    expect(urlWithParams("https://x.test/a#top", [row({ id: "a", key: "page", value: "2" })])).toBe(
      "https://x.test/a?page=2#top",
    );
  });

  it("round-trips a URL through the table and back", () => {
    const url = "https://x.test/a?page=2&q=a%20b";
    expect(urlWithParams(url, paramsFromUrl(url, [], counter()))).toBe(url);
  });
});

describe("decodeComponent", () => {
  it("decodes an escape and reads a plus as a space", () => {
    expect(decodeComponent("hello%20world")).toBe("hello world");
    expect(decodeComponent("hello+world")).toBe("hello world");
  });

  it("hands back a half-typed escape rather than throwing", () => {
    expect(decodeComponent("100%")).toBe("100%");
  });
});
