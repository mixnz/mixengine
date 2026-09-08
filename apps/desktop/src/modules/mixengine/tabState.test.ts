import { describe, expect, it } from "vitest";

import { parseMixEngineTabState } from "./tabState";

describe("parseMixEngineTabState", () => {
  it("accepts all seven screens", () => {
    expect(parseMixEngineTabState({ screen: "dashboard" })?.screen).toBe("dashboard");
    expect(parseMixEngineTabState({ screen: "projects" })?.screen).toBe("projects");
    expect(parseMixEngineTabState({ screen: "sites" })?.screen).toBe("sites");
    expect(parseMixEngineTabState({ screen: "domains" })?.screen).toBe("domains");
    expect(parseMixEngineTabState({ screen: "runtimes" })?.screen).toBe("runtimes");
    expect(parseMixEngineTabState({ screen: "servicesDetail" })?.screen).toBe("servicesDetail");
    expect(parseMixEngineTabState({ screen: "logs" })?.screen).toBe("logs");
  });

  it("accepts blueprints", () => {
    expect(parseMixEngineTabState({ screen: "blueprints" })?.screen).toBe("blueprints");
  });

  it("accepts extensions", () => {
    expect(parseMixEngineTabState({ screen: "extensions" })?.screen).toBe("extensions");
  });

  it("accepts metrics", () => {
    expect(parseMixEngineTabState({ screen: "metrics" })?.screen).toBe("metrics");
  });

  it("accepts settings", () => {
    expect(parseMixEngineTabState({ screen: "settings" })?.screen).toBe("settings");
  });

  it("rejects a screen this build has never heard of, and garbage", () => {
    expect(parseMixEngineTabState({ screen: "quantum_flux" })).toBeUndefined();
    expect(parseMixEngineTabState("dashboard")).toBeUndefined();
    expect(parseMixEngineTabState(null)).toBeUndefined();
    expect(parseMixEngineTabState([])).toBeUndefined();
  });
});
