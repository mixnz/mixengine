import { beforeEach, describe, expect, it } from "vitest";

import { requestSitesFilter, takePendingSitesFilter } from "./sitesNavigation";

// Module-level state — reset between tests since nothing else does.
beforeEach(() => {
  takePendingSitesFilter();
});

describe("sitesNavigation", () => {
  it("is null until a filter is requested", () => {
    expect(takePendingSitesFilter()).toBeNull();
  });

  it("hands back a requested filter exactly once", () => {
    requestSitesFilter("blog");
    expect(takePendingSitesFilter()).toBe("blog");
    expect(takePendingSitesFilter()).toBeNull();
  });

  it("a later request replaces an earlier one nobody took yet", () => {
    requestSitesFilter("blog");
    requestSitesFilter("shop");
    expect(takePendingSitesFilter()).toBe("shop");
  });
});
