import { describe, expect, it } from "vitest";

import { enforcementKind, enforcementReason } from "./limitsState";

describe("enforcementKind", () => {
  it("reads hard as hard", () => {
    expect(enforcementKind({ kind: "hard", when: "killed" })).toBe("hard");
  });
  it("reads unsupported as unsupported", () => {
    expect(enforcementKind({ kind: "unsupported" })).toBe("unsupported");
  });
  it("reads unavailable as unavailable", () => {
    expect(enforcementKind({ kind: "unavailable", why: "no cgroup delegation" })).toBe(
      "unavailable",
    );
  });
  it("reads advisory as advisory, never as a guarantee", () => {
    expect(enforcementKind({ kind: "advisory", why: null })).toBe("advisory");
  });
});

describe("enforcementReason", () => {
  it("carries why for unavailable", () => {
    expect(enforcementReason({ kind: "unavailable", why: "no cgroup delegation" })).toBe(
      "no cgroup delegation",
    );
  });
  it("carries why for advisory when present", () => {
    expect(enforcementReason({ kind: "advisory", why: "kernel has no per-process cap" })).toBe(
      "kernel has no per-process cap",
    );
  });
  it("is null for advisory with no why — never invents one", () => {
    expect(enforcementReason({ kind: "advisory", why: null })).toBeNull();
  });
  it("is null for hard and unsupported, which carry no reason", () => {
    expect(enforcementReason({ kind: "hard", when: "killed" })).toBeNull();
    expect(enforcementReason({ kind: "unsupported" })).toBeNull();
  });
});
