import type { ModuleDefinition } from "./module";
import {
  DEFAULT_MODULE_ID,
  MODULES,
  MODULE_PRESETS,
  PRESET_IDS,
  type PresetId,
} from "./registry";

/**
 * Which modules this window draws.
 *
 * The setting is a **set of module ids** and nothing else: the order the tab bar, the `[+]` menu,
 * the number chords and the Settings panes are drawn in is the registry's, always. That is what
 * keeps a checkbox from silently moving `Ctrl/Cmd+1`, and what makes a half-written or hand-edited
 * value something that can only be wrong about *which* modules, never about their order.
 *
 * Nothing here reads storage at module scope. The functions below are pure, and the ones that do
 * reach `localStorage` take it as an argument — the test suite runs in node, where there is none.
 * The whole design is in
 * `docs/superpowers/specs/2026-09-09-t108-a-module-visibility-setting-design.md`.
 *
 * **This is visibility, not capability.** A hidden module keeps its backend commands, its state and
 * its files; it is not drawn. Turning it off deletes nothing and turning it back on finds
 * everything where it was.
 */

/**
 * The ids in `stored` as a set this build can act on, or `null` when there is nothing usable.
 *
 * Everything that arrives here is a string some older version of this app wrote, so nothing in it
 * is trusted — the same stance `parseSession` takes. An empty result is `null` rather than `[]`:
 * a window with no modules in it is not a window, and the caller then has one branch to write.
 */
export function normalizeModules(stored: unknown, knownIds: string[]): string[] | null {
  if (!Array.isArray(stored)) return null;
  const kept = stored.filter(
    (id, at): id is string =>
      typeof id === "string" && knownIds.includes(id) && stored.indexOf(id) === at,
  );
  return kept.length > 0 ? kept : null;
}

/** Which preset `enabled` is, or `null` for a set of someone's own. Set equality — the presets
 *  carry no order either. */
export function presetOf(enabled: string[]): PresetId | null {
  const set = new Set(enabled);
  return (
    PRESET_IDS.find((id) => {
      const preset = MODULE_PRESETS[id];
      return preset.length === set.size && preset.every((moduleId) => set.has(moduleId));
    }) ?? null
  );
}

/** The modules to draw, in the registry's order. */
export function visibleModules(enabled: string[]): ModuleDefinition[] {
  return MODULES.filter((module) => enabled.includes(module.id));
}

/**
 * What `Ctrl/Cmd+T` and a plain `[+]` open.
 *
 * The registry's default while it is visible, and the first visible module when it is not —
 * without the clamp, the *MixEngine* profile would open a tab of the database module it just
 * turned off. Which module a *profile* prefers is T109's, and it changes this one function.
 */
export function defaultModuleId(visible: ModuleDefinition[]): string {
  const listed = visible.find((module) => module.id === DEFAULT_MODULE_ID);
  return (listed ?? visible[0]).id;
}
