import { beforeEach, describe, expect, it } from "vitest";

import {
  peekPendingRuntimesFilter,
  requestRuntimesLanguageFilter,
  takePendingRuntimesFilter,
} from "./runtimesNavigation";

// Module-level state — reset between tests since nothing else does.
beforeEach(() => {
  takePendingRuntimesFilter();
});

describe("runtimesNavigation", () => {
  it("is null until a filter is requested", () => {
    expect(peekPendingRuntimesFilter()).toBeNull();
    expect(takePendingRuntimesFilter()).toBeNull();
  });

  it("hands back a requested filter exactly once", () => {
    requestRuntimesLanguageFilter("php");
    expect(takePendingRuntimesFilter()).toBe("php");
    expect(takePendingRuntimesFilter()).toBeNull();
  });

  it("peeking leaves the request for whoever takes it", () => {
    requestRuntimesLanguageFilter("php");
    expect(peekPendingRuntimesFilter()).toBe("php");
    expect(peekPendingRuntimesFilter()).toBe("php");
    expect(takePendingRuntimesFilter()).toBe("php");
  });

  it("a later request replaces an earlier one nobody took yet", () => {
    requestRuntimesLanguageFilter("php");
    requestRuntimesLanguageFilter("node");
    expect(takePendingRuntimesFilter()).toBe("node");
  });
});
