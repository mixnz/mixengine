import { afterEach, describe, expect, it, vi } from "vitest";
import * as platform from "./platform";

/**
 * The module reads the user agent once, at import, so a platform is chosen by importing it afresh
 * with `navigator` standing in for the webview's.
 *
 * The test runner is neither platform — `Node.js/24` matches neither name — which is what the
 * unstubbed half of these tests relies on, and is also why the module has to tolerate there being
 * no `navigator` at all: it became a Node global only in 21, and reading it bare threw on the
 * Node 20 that CI runs.
 */
async function on(userAgent: string): Promise<typeof platform> {
  vi.stubGlobal("navigator", { userAgent });
  vi.resetModules();
  return import("./platform");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";

describe("which platform this is", () => {
  it("names a Mac and Windows, and leaves Linux as what is left", async () => {
    // WebKitGTK spells its system several ways — `X11`, `Wayland`, `Linux` — so it is never
    // tested for.
    expect(await on(MAC)).toMatchObject({ IS_MAC: true, IS_WINDOWS: false });
    expect(await on(WINDOWS)).toMatchObject({ IS_MAC: false, IS_WINDOWS: true });
    expect(await on(LINUX)).toMatchObject({ IS_MAC: false, IS_WINDOWS: false });
  });

  it("survives having no navigator to ask", async () => {
    vi.stubGlobal("navigator", undefined);
    vi.resetModules();
    const nowhere = await import("./platform");
    expect(nowhere.IS_MAC).toBe(false);
    expect(nowhere.IS_WINDOWS).toBe(false);
  });
});

describe("hasPrimaryModifier", () => {
  it("is Cmd on a Mac and Ctrl elsewhere", async () => {
    const mac = await on(MAC);
    expect(mac.hasPrimaryModifier({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(mac.hasPrimaryModifier({ metaKey: false, ctrlKey: true })).toBe(false);

    const windows = await on(WINDOWS);
    expect(windows.hasPrimaryModifier({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(windows.hasPrimaryModifier({ metaKey: true, ctrlKey: false })).toBe(false);
  });

  it("is ruled out by the other modifier being down as well", async () => {
    // On a Mac that keeps `Ctrl+Click` free for the context menu it has always opened; on Windows
    // it keeps `Win+Ctrl` — which the desktop uses to switch between them — out of the app.
    const mac = await on(MAC);
    expect(mac.hasPrimaryModifier({ metaKey: true, ctrlKey: true })).toBe(false);

    const windows = await on(WINDOWS);
    expect(windows.hasPrimaryModifier({ metaKey: true, ctrlKey: true })).toBe(false);
  });

  it("is not the generous `ctrlKey || metaKey` on either", async () => {
    // Which would make `Ctrl+A` select every row on a Mac, and let the Windows key stand in for
    // `Ctrl` everywhere else.
    for (const agent of [MAC, WINDOWS]) {
      const it = await on(agent);
      const bothWays =
        it.hasPrimaryModifier({ metaKey: true, ctrlKey: false }) &&
        it.hasPrimaryModifier({ metaKey: false, ctrlKey: true });
      expect(bothWays, agent).toBe(false);
    }
  });
});

describe("hasCtrlOnly", () => {
  it("asks the same question of every platform", async () => {
    for (const agent of [MAC, WINDOWS, LINUX]) {
      const it = await on(agent);
      expect(it.hasCtrlOnly({ ctrlKey: true, metaKey: false }), agent).toBe(true);
      expect(it.hasCtrlOnly({ ctrlKey: true, metaKey: true }), agent).toBe(false);
      expect(it.hasCtrlOnly({ ctrlKey: false, metaKey: true }), agent).toBe(false);
    }
  });

  it("is the primary modifier word for word off a Mac", async () => {
    // One flag covers both platforms because on only one of them do they differ.
    const windows = await on(WINDOWS);
    for (const event of [
      { ctrlKey: true, metaKey: false },
      { ctrlKey: false, metaKey: true },
      { ctrlKey: true, metaKey: true },
      { ctrlKey: false, metaKey: false },
    ]) {
      expect(windows.hasCtrlOnly(event)).toBe(windows.hasPrimaryModifier(event));
    }
  });
});

describe("shortcutLabel", () => {
  it("writes a Mac chord as symbols, in the order a Mac writes them", async () => {
    const mac = await on(MAC);
    expect(mac.shortcutLabel("F")).toBe("⌘F");
    expect(mac.shortcutLabel("F", { shift: true })).toBe("⇧⌘F");
    // `⌃⌥⇧⌘` is the order, so the primary glyph sits at whichever end of it belongs to.
    expect(mac.shortcutLabel("F", { alt: true, shift: true })).toBe("⌥⇧⌘F");
    expect(mac.shortcutLabel("F", { ctrl: true })).toBe("⌃F");
    expect(mac.shortcutLabel("F", { ctrl: true, alt: true, shift: true })).toBe("⌃⌥⇧F");
  });

  it("names the keys and joins them with + elsewhere", async () => {
    const windows = await on(WINDOWS);
    expect(windows.shortcutLabel("F")).toBe("Ctrl+F");
    expect(windows.shortcutLabel("F", { shift: true })).toBe("Ctrl+Shift+F");
    expect(windows.shortcutLabel("F", { alt: true, shift: true })).toBe("Ctrl+Alt+Shift+F");
    // A `ctrl` chord and a primary-modifier chord are both `Ctrl+…`, being the same key.
    expect(windows.shortcutLabel("F", { ctrl: true })).toBe("Ctrl+F");
  });

  it("carries the modifier the label file writes on its own", async () => {
    expect((await on(MAC)).MODIFIER_LABEL).toBe("⌘");
    expect((await on(WINDOWS)).MODIFIER_LABEL).toBe("Ctrl");
  });
});

describe("keyLabel", () => {
  it("spells only the keys that are not simply their own letter", async () => {
    const mac = await on(MAC);
    expect(mac.keyLabel("tab")).toBe("⇥");
    expect(mac.keyLabel("t")).toBe("T");

    const windows = await on(WINDOWS);
    expect(windows.keyLabel("tab")).toBe("Tab");
    expect(windows.keyLabel("t")).toBe("T");
  });
});
