import { describe, expect, it } from "vitest";
import { DEFAULT_MODULE_ID, MODULES, MODULE_PRESETS, PRESET_IDS } from "./registry";

/* The presets are the only place in the app that names a module by hand, so what is worth pinning
   down is that every name is one the registry actually has, and that the order the tab bar draws —
   which is the registry's, never the stored set's — puts MixEngine at the front. */
describe("the registry", () => {
  it("leads with MixEngine", () => {
    expect(MODULES[0].id).toBe("mixengine");
  });

  it("has a default module it also lists", () => {
    expect(MODULES.map((m) => m.id)).toContain(DEFAULT_MODULE_ID);
  });

  it("names only modules it has, in every preset", () => {
    const ids = MODULES.map((m) => m.id);
    for (const preset of PRESET_IDS) {
      expect(MODULE_PRESETS[preset].length).toBeGreaterThan(0);
      for (const id of MODULE_PRESETS[preset]) expect(ids).toContain(id);
    }
  });

  it("offers MixEngine alone, everything, and the four toolbox modules", () => {
    expect(MODULE_PRESETS.mixengine).toEqual(["mixengine"]);
    expect([...MODULE_PRESETS.everything].sort()).toEqual(MODULES.map((m) => m.id).sort());
    expect(MODULE_PRESETS.databaseTools).not.toContain("mixengine");
    expect(MODULE_PRESETS.databaseTools).toHaveLength(MODULES.length - 1);
  });
});
