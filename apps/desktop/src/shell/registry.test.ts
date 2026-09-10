import { describe, expect, it } from "vitest";
import { MODULES, MODULE_PRESETS, PRESET_IDS } from "./registry";

/* The presets are the only place in the app that names a module by hand, so what is worth pinning
   down is that every name is one the registry actually has, and that the order the tab bar draws —
   which is the registry's, never the stored set's — puts MixEngine at the front. */
describe("the registry", () => {
  /* The head of the list is also the tab this window opens by default — `defaultModuleId` is the
     first *visible* module, and MixEngine is visible in two of the three presets. */
  it("leads with MixEngine, which is also the default tab", () => {
    expect(MODULES[0].id).toBe("mixengine");
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
