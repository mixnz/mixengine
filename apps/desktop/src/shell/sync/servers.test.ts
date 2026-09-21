import { describe, expect, it } from "vitest";
import {
  addServer,
  DEFAULT_SERVER,
  lastServer,
  normalizeServer,
  readServers,
  rememberServer,
  removeServer,
  type ServerStorage,
} from "./servers";

function memory(value: string | null = null): ServerStorage & { value: string | null } {
  const others = new Map<string, string>();
  const store = {
    value,
    getItem: (key: string) => (key === "mixlab-sync-servers" ? store.value : (others.get(key) ?? null)),
    setItem: (key: string, next: string) => {
      if (key === "mixlab-sync-servers") store.value = next;
      else others.set(key, next);
    },
  };
  return store;
}

describe("the list of servers", () => {
  it("is the default alone, on a machine that added nothing — or kept something unreadable", () => {
    expect(readServers(memory())).toEqual([DEFAULT_SERVER]);
    expect(readServers(memory("{nope"))).toEqual([DEFAULT_SERVER]);
    expect(readServers(memory('[7, "https://a.example"]'))).toEqual([DEFAULT_SERVER, "https://a.example"]);
  });

  it("keeps the default first, whatever was stored", () => {
    expect(readServers(memory(`["https://a.example", "${DEFAULT_SERVER}"]`))).toEqual([
      DEFAULT_SERVER,
      "https://a.example",
    ]);
  });

  it("adds an address once, without its trailing slash", () => {
    const storage = memory();
    addServer(storage, " https://sync.example.com/ ");
    const again = addServer(storage, "https://sync.example.com");
    expect(again).toEqual({
      ok: true,
      url: "https://sync.example.com",
      servers: [DEFAULT_SERVER, "https://sync.example.com"],
    });
  });

  it("removes what was added, and never the default", () => {
    const storage = memory();
    addServer(storage, "https://sync.example.com");
    expect(removeServer(storage, DEFAULT_SERVER)).toEqual([DEFAULT_SERVER, "https://sync.example.com"]);
    expect(removeServer(storage, "https://sync.example.com")).toEqual([DEFAULT_SERVER]);
  });
});

describe("what counts as a server", () => {
  it("is https anywhere, and http only on this machine", () => {
    expect(normalizeServer("https://sync.example.com:8443/base/")).toEqual({
      ok: true,
      url: "https://sync.example.com:8443/base",
    });
    expect(normalizeServer("http://127.0.0.1:8766")).toEqual({ ok: true, url: "http://127.0.0.1:8766" });
    expect(normalizeServer("http://localhost:8766")).toEqual({ ok: true, url: "http://localhost:8766" });
    expect(normalizeServer("http://sync.example.com")).toEqual({ ok: false, reason: "insecure" });
  });

  it("is not something else with a colon in it", () => {
    expect(normalizeServer("sync.example.com")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizeServer("ftp://sync.example.com")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizeServer("https://sync.example.com/?x=1")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizeServer("https://user:pw@sync.example.com")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("the server chosen last", () => {
  it("is the default on a machine that never chose", () => {
    expect(lastServer(memory())).toBe(DEFAULT_SERVER);
  });

  it("is remembered, so signing out comes back to it", () => {
    const storage = memory();
    addServer(storage, "https://sync.example.com");
    rememberServer(storage, "https://sync.example.com");
    expect(lastServer(storage)).toBe("https://sync.example.com");
  });

  it("falls back to the default once it has been removed from the list", () => {
    const storage = memory();
    addServer(storage, "https://sync.example.com");
    rememberServer(storage, "https://sync.example.com");
    removeServer(storage, "https://sync.example.com");
    expect(lastServer(storage)).toBe(DEFAULT_SERVER);
  });
});
