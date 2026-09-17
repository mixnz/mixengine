/**
 * `npm run screenshots` — the six scenes, from sample data, as raw and framed PNGs.
 *
 *   npm run screenshots                          every scene, dark and light, macOS
 *   npm run screenshots -- --scene rest --theme dark
 *   npm run screenshots -- --platform windows
 *   npm run screenshots -- --check               render and verify every scene, write nothing
 *
 * The design is docs/superpowers/specs/2026-09-17-marketing-screenshots-design.md.
 */
import { mkdir, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { USER_AGENTS, modifierFor, parseArgs, storageFor } from "./args.mjs";
import { createQuietDetector } from "./readiness.mjs";
import { CONSTANTS, SCENES } from "./scenes.mjs";

const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(DESKTOP, "screenshots", "out");
const VIEWPORT = { width: 1440, height: 900 };
const SCALE = 2;
const READY_TIMEOUT_MS = 20_000;
const ACT_TIMEOUT_MS = 10_000;
const FREEZE_CSS =
  "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }";

/** A port the OS says is free right now — never a fixed one. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/* Runs in the page before any of its scripts, on every navigation of the top frame. */
function initScene(storage) {
  if (window.top !== window) return;
  localStorage.clear();
  for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
  window.__demoMutations = 0;
  new MutationObserver((records) => {
    window.__demoMutations += records.length;
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
}

/**
 * Requests the page has started and not finished.
 *
 * Counted as activity alongside IPC because a cold Vite server can take seconds to transform a
 * module a screen imports lazily, and a page waiting on one makes no IPC call and no DOM change.
 */
function trackNetwork(page) {
  const network = { started: 0, open: 0 };
  page.on("request", () => {
    network.started++;
    network.open++;
  });
  const settle = () => network.open--;
  page.on("requestfinished", settle);
  page.on("requestfailed", settle);
  return network;
}

async function waitReady(page, network) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  const isQuiet = createQuietDetector();
  while (Date.now() < deadline) {
    const sample = await page.evaluate(() => ({
      inFlight: window.__demo?.inFlight ?? 1,
      calls: window.__demo?.calls ?? 0,
      mutations: window.__demoMutations ?? 0,
      mounted: (document.getElementById("root")?.childElementCount ?? 0) > 0,
    }));
    const activity = {
      ...sample,
      inFlight: sample.inFlight + network.open,
      calls: sample.calls + network.started,
    };
    if (isQuiet(activity)) {
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      return;
    }
    await delay(100);
  }
  const pending = await page.evaluate(() => window.__demo?.pending ?? []);
  throw new Error(
    `not ready after ${READY_TIMEOUT_MS} ms (IPC in flight: ${pending.join(", ") || "nothing"}; ` +
      `requests open: ${network.open})`,
  );
}

function firstLine(error) {
  return String(error?.message ?? error).split("\n")[0];
}

/** Composites a raw image into its frame. Filled in by Task 8. */
async function frameShot() {}

async function runScene(browser, baseUrl, scene, theme, options) {
  const name = `${scene.id}-${theme}`;
  const report = { name, problems: [], consoleErrors: [] };
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    userAgent: USER_AGENTS[options.platform],
    reducedMotion: "reduce",
    locale: "en-US",
    timezoneId: "UTC",
  });
  try {
    await context.clock.setFixedTime(new Date(CONSTANTS.now));
    await context.addInitScript(initScene, storageFor(scene, theme));
    const page = await context.newPage();
    page.setDefaultTimeout(ACT_TIMEOUT_MS);
    const network = trackNetwork(page);
    let navigations = 0;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations++;
    });
    page.on("pageerror", (error) => report.problems.push(`pageerror  ${firstLine(error)}`));
    page.on("console", (message) => {
      if (message.type() === "error") report.consoleErrors.push(message.text().split("\n")[0]);
    });

    try {
      await page.goto(`${baseUrl}/demo/demo.html`);
      await page.addStyleTag({ content: FREEZE_CSS });
      await waitReady(page, network);
      if (scene.act) {
        await scene.act({ page, modifier: modifierFor(options.platform), constants: CONSTANTS });
        await waitReady(page, network);
      }
    } catch (error) {
      report.problems.push(`failed     ${firstLine(error)}`);
    }

    const probe = await page
      .evaluate(() => ({ unmocked: window.__demo?.unmocked ?? [], errors: window.__demo?.errors ?? [] }))
      .catch(() => ({ unmocked: [], errors: [] }));
    for (const call of probe.unmocked) report.problems.push(`unmocked   ${call.cmd} ${call.args}`);
    for (const message of probe.errors) report.problems.push(`app error  ${message.split("\n")[0]}`);
    // What the probe says belongs to the last document only; a reload would have hidden the rest.
    if (navigations > 1) report.problems.push("failed     the page reloaded during the scene");

    if (report.problems.length === 0 && !options.check) {
      const rawPath = join(OUT, "raw", `${name}.png`);
      await page.screenshot({ path: rawPath, animations: "disabled", caret: "hide" });
      await frameShot(browser, baseUrl, rawPath, join(OUT, "framed", `${name}.png`), scene, theme, options.platform);
    }
  } finally {
    await context.close();
  }
  return report;
}
function printReport(report) {
  console.log(`${report.problems.length === 0 ? "ok  " : "FAIL"}  ${report.name}`);
  for (const problem of report.problems) console.log(`        ${problem}`);
  for (const line of report.consoleErrors) console.log(`        console    ${line}`);
}

async function launch() {
  try {
    return await chromium.launch();
  } catch (error) {
    if (String(error?.message).includes("Executable doesn't exist")) {
      console.error("Chromium for Playwright is not installed. Run:\n\n  npx playwright install chromium\n");
      process.exit(2);
    }
    throw error;
  }
}

/* Vite optimises dependencies on the first request and may reload the page when it finds more;
   paying for that here keeps it out of the first scene. */
async function warmUp(browser, baseUrl) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/demo/demo.html`, { waitUntil: "networkidle" });
  } finally {
    await context.close();
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2), SCENES.map((scene) => scene.id));
  } catch (error) {
    console.error(firstLine(error));
    process.exit(2);
  }

  if (!options.check) {
    if (options.full) await rm(OUT, { recursive: true, force: true });
    await mkdir(join(OUT, "raw"), { recursive: true });
    await mkdir(join(OUT, "framed"), { recursive: true });
  }

  const port = await freePort();
  const server = await createServer({
    root: DESKTOP,
    configFile: join(DESKTOP, "vite.config.ts"),
    logLevel: "warn",
    clearScreen: false,
    server: { host: "127.0.0.1", port, strictPort: true, hmr: false },
    optimizeDeps: { entries: ["index.html", "demo/demo.html", "demo/frame/frame.html"] },
  });

  const reports = [];
  let browser;
  try {
    await server.listen();
    const baseUrl = `http://127.0.0.1:${port}`;
    browser = await launch();
    await warmUp(browser, baseUrl);
    for (const scene of SCENES.filter((s) => options.scenes.includes(s.id))) {
      for (const theme of options.themes) {
        const report = await runScene(browser, baseUrl, scene, theme, options);
        printReport(report);
        reports.push(report);
      }
    }
  } finally {
    await browser?.close();
    await server.close();
  }

  const failed = reports.filter((report) => report.problems.length > 0);
  const verb = options.check ? "render" : "captured";
  console.log(`\n${reports.length - failed.length}/${reports.length} scenes ${verb}`);
  if (failed.length > 0) {
    console.log(`failed: ${failed.map((report) => report.name).join(", ")}`);
    console.log(
      "An `unmocked` line names a command to add to demo/fixtures — see .claude/desktop/conventions/demo-screenshots.md.",
    );
    process.exitCode = 1;
  } else if (!options.check) {
    console.log(`images in ${OUT}`);
  }
}

await main();
