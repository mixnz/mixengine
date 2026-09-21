import { describe, expect, it } from "vitest";
import { MODULES, MODULE_PRESETS, PRESET_IDS, SYNCABLE } from "./registry";

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

describe("what sync can offer", () => {
  const ids = SYNCABLE.map((collection) => collection.id);

  it("is exactly D5's list, in the app's order", () => {
    expect(ids).toEqual([
      "preferences",
      "connections",
      "connection-secrets",
      "query-snippets",
      "rest-requests",
      "rest-environments",
      "terminal-settings",
      "terminal-hosts",
      "tools-snippets",
    ]);
  });

  it("puts every secret row after the row it belongs to", () => {
    for (const [index, collection] of SYNCABLE.entries()) {
      if (collection.belongsTo === undefined) continue;
      expect(ids.indexOf(collection.belongsTo)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(collection.belongsTo)).toBeLessThan(index);
    }
  });

  it("never offers what D5 refuses", () => {
    for (const refused of ["rest-history", "query-history", "query-drafts", "tool-usage", "workspace"]) {
      expect(ids.some((id) => id.includes(refused))).toBe(false);
    }
  });

  it("names every collection once, each with a label", () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const collection of SYNCABLE) expect(collection.labelKey).toBeTruthy();
  });
});
