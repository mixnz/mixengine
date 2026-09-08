import { describe, expect, it } from "vitest";
import { historyVars } from "./environments";
import {
  BODY_MAX_BYTES,
  MAX_ENTRIES,
  historyUrl,
  keptBody,
  withEntry,
  withoutBodies,
  withoutEntry,
  type HistoryEntry,
} from "./history";
import { newRequest } from "./requests";

function entry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: "e1",
    requestId: "r1",
    envName: "Dev",
    method: "GET",
    url: "https://example.com/",
    startedAt: 1,
    durationMs: 10,
    status: 200,
    statusText: "OK",
    size: 12,
    error: null,
    responseBody: null,
    ...over,
  };
}

describe("withEntry", () => {
  it("puts the newest at the front", () => {
    const list = withEntry([entry({ id: "old" })], entry({ id: "new" }));
    expect(list.map((e) => e.id)).toEqual(["new", "old"]);
  });

  it("keeps a repeat of the same request, because the answer may differ", () => {
    const list = withEntry([entry({ id: "a" })], entry({ id: "b" }));
    expect(list).toHaveLength(2);
  });

  it("caps the list", () => {
    let list: HistoryEntry[] = [];
    for (let i = 0; i < MAX_ENTRIES + 5; i++) list = withEntry(list, entry({ id: `e${i}` }));
    expect(list).toHaveLength(MAX_ENTRIES);
    expect(list[0].id).toBe(`e${MAX_ENTRIES + 4}`);
  });
});

describe("withoutEntry", () => {
  it("forgets one by id", () => {
    const list = withoutEntry([entry({ id: "a" }), entry({ id: "b" })], "a");
    expect(list.map((e) => e.id)).toEqual(["b"]);
  });
});

describe("withoutBodies", () => {
  it("drops every stored body", () => {
    const list = withoutBodies([entry({ responseBody: "e30=" }), entry({ id: "b" })]);
    expect(list.every((e) => e.responseBody === null)).toBe(true);
  });

  it("returns the same list when there was nothing to drop", () => {
    const list = [entry()];
    expect(withoutBodies(list)).toBe(list);
  });
});

describe("keptBody", () => {
  it("keeps a body within the ceiling", () => {
    expect(keptBody("e30=", 4, true)).toBe("e30=");
  });

  it("keeps nothing when the switch is off", () => {
    expect(keptBody("e30=", 4, false)).toBeNull();
  });

  it("keeps nothing above the ceiling", () => {
    expect(keptBody("e30=", BODY_MAX_BYTES + 1, true)).toBeNull();
  });
});

describe("historyUrl", () => {
  const request = {
    ...newRequest("r1", 0),
    url: "https://{{host}}/users",
    params: [
      { id: "p1", enabled: true, key: "page", value: "{{page}}" },
      { id: "p2", enabled: false, key: "debug", value: "1" },
    ],
    auth: { kind: "apiKey", name: "key", value: "literal-secret", in: "query" } as const,
  };

  it("resolves the ordinary variables", () => {
    expect(historyUrl(request, { host: "api.example.com", page: "2" })).toBe(
      "https://api.example.com/users?page=2",
    );
  });

  it("leaves a secret variable in its braces", () => {
    const env = {
      id: "1",
      name: "Dev",
      vars: [
        { name: "host", value: "api.example.com", secret: false },
        { name: "page", value: "2", secret: true },
      ],
    };
    expect(historyUrl(request, historyVars(env))).toBe(
      "https://api.example.com/users?page={{page}}",
    );
  });

  it("never carries the Auth tab's query key", () => {
    expect(historyUrl(request, { host: "api.example.com", page: "2" })).not.toContain(
      "literal-secret",
    );
  });

  it("leaves everything in its braces with no environment", () => {
    expect(historyUrl(request, null)).toContain("{{host}}");
  });
});
