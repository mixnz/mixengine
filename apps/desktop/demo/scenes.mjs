import { readFileSync } from "node:fs";

/**
 * The six scenes, and the copy the frame writes under each.
 *
 * Plain JavaScript because the capture script reads it in node. `state` is a module's own session
 * slot — `scenes.test.mjs` runs each one through that module's parser, so a change to how a tab
 * restores fails there first.
 *
 * `act` runs once the scene is quiet, and the scene waits to be quiet again after it. It may use a
 * shortcut the module registers, text the fixtures own, or an element that is the only one of its
 * kind — never interface copy, never a CSS class.
 */
export const CONSTANTS = JSON.parse(readFileSync(new URL("./constants.json", import.meta.url), "utf8"));

export const SCENES = [
  {
    id: "hero",
    moduleId: "mixengine",
    tabTitle: "MixEngine",
    state: { screen: "dashboard" },
    headline: "Your whole local stack, one window",
    description: "PHP, Node and Python side by side, databases and HTTPS domains — no Docker, no config files.",
  },
  {
    id: "sites",
    moduleId: "mixengine",
    tabTitle: "MixEngine",
    state: { screen: "sites" },
    headline: "Sites and runtimes",
    description: "Every project gets a .test domain with trusted HTTPS, on the PHP or Node version it asks for.",
  },
  {
    id: "database",
    moduleId: "db",
    tabTitle: "acme_shop",
    state: { savedId: CONSTANTS.connectionId, connected: true },
    headline: "Database",
    description: "PostgreSQL, MySQL, SQLite, MongoDB, Redis and more in one client that already knows your services.",
    // `orders` is the fixture's table name, not interface copy.
    act: async ({ page }) => {
      await page.getByText("orders", { exact: true }).first().click();
    },
  },
  {
    id: "rest",
    moduleId: "rest",
    tabTitle: "REST",
    state: { openIds: [CONSTANTS.requestId], activeId: CONSTANTS.requestId },
    headline: "REST",
    description: "Send requests, keep environments and history, and read the response the way it was meant to be read.",
    // `rest.send` in `modules/rest/shortcuts.ts`.
    act: async ({ page, modifier }) => {
      await page.keyboard.press(`${modifier}+Enter`);
    },
  },
  {
    id: "terminal",
    moduleId: "terminal",
    tabTitle: "Terminal",
    state: { kind: "local", shellName: CONSTANTS.shellName, cwd: CONSTANTS.cwd },
    headline: "Terminal",
    description: "A shell on this machine or on a server over SSH, in a tab beside everything else.",
  },
  {
    id: "tools",
    moduleId: "tools",
    tabTitle: "Tools",
    state: { toolId: "jwt" },
    headline: "Tools",
    description: "JWT, JSON, regex, timestamps, diffs and more — offline, next to your code.",
    // The JWT decoder has exactly one textarea: its input.
    act: async ({ page, constants }) => {
      await page.locator("textarea").first().fill(constants.jwt);
    },
  },
];
