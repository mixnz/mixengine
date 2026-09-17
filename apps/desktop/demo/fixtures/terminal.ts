import type { Channel } from "@tauri-apps/api/core";
import constants from "../constants.json";
import type { SessionMessage } from "../../src/modules/terminal/api";
import type { LocalShell } from "../../src/modules/terminal/types";
import { returns, type Handlers } from "../ipc/dispatch";

const ESC = "\x1b[";
const reset = `${ESC}0m`;
const bold = (code: number, text: string) => `${ESC}1;${code}m${text}${reset}`;
const color = (code: number, text: string) => `${ESC}${code}m${text}${reset}`;

const PROMPT = `${bold(32, "ada")}@${bold(34, "macbook")} ${color(36, constants.cwd)} ${color(35, "(main)")} $ `;

const dots = (label: string, width = 58) => `${label} ${color(90, ".".repeat(Math.max(3, width - label.length)))}`;
const done = (label: string, ms: string) => `  ${dots(label)} ${color(90, ms)} ${bold(32, "DONE")}`;

/** What the session prints: two commands a PHP developer runs every day, and a git log. */
const TRANSCRIPT = [
  `${PROMPT}php -v`,
  "PHP 8.4.3 (cli) (built: Jan  8 2026 10:12:44) (NTS)",
  "Copyright (c) The PHP Group",
  "Zend Engine v4.4.3, Copyright (c) Zend Technologies",
  "    with Zend OPcache v8.4.3, Copyright (c), by Zend Technologies",
  "",
  `${PROMPT}php artisan migrate`,
  "",
  // No background: the xterm palette differs per theme, and no foreground reads on its blue in both.
  `   ${bold(34, "INFO")}  Running migrations.`,
  "",
  done("2026_01_12_093000_create_orders_table", "18.41ms"),
  done("2026_01_12_093100_create_order_items_table", "9.87ms"),
  done("2026_01_14_151200_add_refunded_at_to_orders", "4.02ms"),
  "",
  `${PROMPT}git log --oneline -5`,
  `${color(33, "9c1e4b2")} ${color(36, "(HEAD -> main, origin/main)")} Add refunds to the orders API`,
  `${color(33, "7a03d5f")} Paginate paid orders`,
  `${color(33, "e41b9a0")} Move checkout to PHP 8.4`,
  `${color(33, "2f6c8d1")} Cache product listings in Redis`,
  `${color(33, "b5d2e77")} Serve docs.acme.test from docs/dist`,
  "",
  PROMPT,
].join("\r\n");

export const terminalFiles = {
  "terminal-settings.json": { settings: { cursorBlink: false } },
};

export const terminalHandlers: Handlers = {
  terminal_local_shells: returns<LocalShell[]>([
    { name: constants.shellName, path: "/bin/zsh", args: ["-l"] },
    { name: "bash", path: "/bin/bash", args: ["-l"] },
  ]),
  terminal_open: (args) => {
    const channel = args.onEvent as Channel<SessionMessage>;
    const bytes = new TextEncoder().encode(TRANSCRIPT);
    // `encode` allocates a buffer of exactly its length, so the whole buffer is the transcript.
    setTimeout(() => channel.onmessage(bytes.buffer as ArrayBuffer), 0);
    return null;
  },
  terminal_write: returns(null),
  terminal_resize: returns(null),
  terminal_close: returns(null),
};
