import { describe, expect, it } from "vitest";
import { LOG_LEVEL_ERROR, createDispatcher, createProbe, returns } from "./dispatch";

describe("createDispatcher", () => {
  it("answers a command from its handler with the arguments it was called with", async () => {
    const probe = createProbe();
    const dispatch = createDispatcher({ echo: (args) => args.value }, probe);
    await expect(dispatch("echo", { value: 42 })).resolves.toBe(42);
    expect(probe.calls).toBe(1);
  });

  it("records a command nobody answers, and rejects it", async () => {
    const probe = createProbe();
    const dispatch = createDispatcher({}, probe);
    await expect(dispatch("mixengine_nope", { id: "x" })).rejects.toThrow("mixengine_nope");
    expect(probe.unmocked).toEqual([{ cmd: "mixengine_nope", args: '{"id":"x"}' }]);
  });

  it("counts a call in flight until it settles, whether it resolves or rejects", async () => {
    const probe = createProbe();
    let release: (value: unknown) => void = () => {};
    const dispatch = createDispatcher(
      {
        slow: () => new Promise((resolve) => (release = resolve)),
        fail: () => Promise.reject(new Error("no")),
      },
      probe,
    );
    const slow = dispatch("slow");
    await Promise.resolve();
    expect(probe.inFlight).toBe(1);
    expect(probe.pending).toEqual(["slow"]);
    release(null);
    await slow;
    await dispatch("fail").catch(() => {});
    expect(probe.inFlight).toBe(0);
    expect(probe.pending).toEqual([]);
  });

  it("records an error-level log call as an app error, and nothing below it", async () => {
    const probe = createProbe();
    const dispatch = createDispatcher({ "plugin:log|log": returns(null) }, probe);
    await dispatch("plugin:log|log", { level: 4, message: "just a warning" });
    await dispatch("plugin:log|log", { level: LOG_LEVEL_ERROR, message: "[react] boom" });
    expect(probe.errors).toEqual(["[react] boom"]);
  });
});
