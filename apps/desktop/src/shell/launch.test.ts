import { describe, expect, it } from "vitest";
import { parseTabRequest } from "./launch";

const MODULE_IDS = ["db", "rest", "terminal"];

describe("parseTabRequest", () => {
  it("reads a request for a module the app has", () => {
    expect(parseTabRequest({ moduleId: "db", state: { handoffId: "h-1" } }, MODULE_IDS)).toEqual({
      moduleId: "db",
      state: { handoffId: "h-1" },
    });
  });

  /* The state is the module's own, carried through untouched — exactly as `parseSession` carries
     the slot it does not read. */
  it("carries any state, including none", () => {
    expect(parseTabRequest({ moduleId: "rest" }, MODULE_IDS)).toEqual({ moduleId: "rest", state: undefined });
    expect(parseTabRequest({ moduleId: "rest", state: null }, MODULE_IDS)).toEqual({ moduleId: "rest", state: null });
  });

  it("refuses a module the app does not have", () => {
    expect(parseTabRequest({ moduleId: "gopher", state: {} }, MODULE_IDS)).toBeNull();
  });

  it("refuses anything that is not a request", () => {
    expect(parseTabRequest(null, MODULE_IDS)).toBeNull();
    expect(parseTabRequest("db", MODULE_IDS)).toBeNull();
    expect(parseTabRequest([], MODULE_IDS)).toBeNull();
    expect(parseTabRequest({}, MODULE_IDS)).toBeNull();
    expect(parseTabRequest({ moduleId: 7 }, MODULE_IDS)).toBeNull();
  });
});
