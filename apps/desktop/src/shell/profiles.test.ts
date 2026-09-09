import { describe, expect, it } from "vitest";
import { MODULES, MODULE_PRESETS } from "./registry";
import { defaultModuleId, normalizeModules, presetOf, visibleModules } from "./profiles";

const KNOWN = MODULES.map((m) => m.id);

describe("normalizeModules", () => {
  it("keeps a set this build knows, as it was given", () => {
    expect(normalizeModules(["db", "mixengine"], KNOWN)).toEqual(["db", "mixengine"]);
  });

  it("drops an id this build does not have", () => {
    expect(normalizeModules(["db", "gopher"], KNOWN)).toEqual(["db"]);
  });

  it("collapses a repeated id", () => {
    expect(normalizeModules(["db", "db"], KNOWN)).toEqual(["db"]);
  });

  /* A window with no modules in it is not a window. Empty is the same answer as unreadable, so the
     caller has one branch to write and one to test. */
  it("answers null for anything that leaves nothing to draw", () => {
    expect(normalizeModules([], KNOWN)).toBeNull();
    expect(normalizeModules(["gopher"], KNOWN)).toBeNull();
    expect(normalizeModules(null, KNOWN)).toBeNull();
    expect(normalizeModules("db", KNOWN)).toBeNull();
    expect(normalizeModules({ db: true }, KNOWN)).toBeNull();
    expect(normalizeModules([1, 2], KNOWN)).toBeNull();
  });
});

describe("presetOf", () => {
  it("recognises each preset from its set, whatever order it arrives in", () => {
    expect(presetOf(MODULE_PRESETS.mixengine)).toBe("mixengine");
    expect(presetOf([...MODULE_PRESETS.everything].reverse())).toBe("everything");
    expect(presetOf([...MODULE_PRESETS.databaseTools].reverse())).toBe("databaseTools");
  });

  it("answers null for a set of someone's own", () => {
    expect(presetOf(["mixengine", "terminal"])).toBeNull();
  });
});

describe("visibleModules", () => {
  it("draws in the registry's order, not the order it was handed", () => {
    const ids = visibleModules(["tools", "mixengine", "db"]).map((m) => m.id);
    expect(ids).toEqual(MODULES.filter((m) => ids.includes(m.id)).map((m) => m.id));
    expect(ids[0]).toBe("mixengine");
  });

  it("ignores an id this build does not have", () => {
    expect(visibleModules(["mixengine", "gopher"]).map((m) => m.id)).toEqual(["mixengine"]);
  });
});

describe("defaultModuleId", () => {
  it("is the registry's default while that module is visible", () => {
    expect(defaultModuleId(visibleModules(MODULE_PRESETS.everything))).toBe("db");
  });

  /* Without the clamp, hiding the database module would leave `Ctrl/Cmd+T` opening a tab of the
     module the user just turned off. T109 makes the choice itself follow the profile. */
  it("falls back to the first visible module when the default is hidden", () => {
    expect(defaultModuleId(visibleModules(MODULE_PRESETS.mixengine))).toBe("mixengine");
  });
});
