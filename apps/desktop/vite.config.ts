import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  /* Vitest stubs every `.css` request out by default — a test run has nothing to paint, so
     processing stylesheets buys nothing. But the stub answers `?raw` too, with an empty string,
     and a test that parses an empty stylesheet finds no rules, filters them to an empty list, and
     asserts that the list is empty: it passes for ever without reading a line.

     `glass.test.ts` did exactly that from the day it was written, so the WebKit `backdrop-filter`
     trap it exists to guard was never guarded. Both stylesheet tests now assert they read
     something before asserting anything about it, but this is the fix for the cause. */
  test: {
    css: true,
  },
}));
