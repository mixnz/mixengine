import { describe, expect, it } from "vitest";

import { DEFAULT_INSTANCE, serviceIdFrom, takesInstanceName } from "./serviceId";

describe("serviceIdFrom", () => {
  it("is the bare package name when no instance is named", () => {
    expect(serviceIdFrom("caddy", "")).toBe("caddy");
  });

  it("joins package and instance with @", () => {
    expect(serviceIdFrom("mariadb", "secondary")).toBe("mariadb@secondary");
  });

  it("ignores the whitespace somebody typed around an instance name", () => {
    expect(serviceIdFrom("mariadb", "  secondary  ")).toBe("mariadb@secondary");
  });

  it("treats an all-whitespace instance as none, not as an empty suffix", () => {
    expect(serviceIdFrom("redis", "   ")).toBe("redis");
  });
});

describe("takesInstanceName", () => {
  it("says no for the web servers, which a home has exactly one of", () => {
    expect(takesInstanceName("caddy")).toBe(false);
    expect(takesInstanceName("nginx")).toBe(false);
    expect(takesInstanceName("apache")).toBe(false);
  });

  it("says yes for databases and caches, which come in instances", () => {
    expect(takesInstanceName("mariadb")).toBe(true);
    expect(takesInstanceName("mysql")).toBe(true);
    expect(takesInstanceName("postgres")).toBe(true);
    expect(takesInstanceName("redis")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(takesInstanceName("Caddy")).toBe(false);
  });

  it("says yes for a package it has never heard of, so the field stays reachable", () => {
    expect(takesInstanceName("something-new")).toBe(true);
  });
});

describe("DEFAULT_INSTANCE", () => {
  it("is a name the daemon's own examples use", () => {
    expect(serviceIdFrom("mariadb", DEFAULT_INSTANCE)).toBe("mariadb@main");
  });
});
