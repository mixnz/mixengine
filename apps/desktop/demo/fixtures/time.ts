import constants from "../constants.json";

/** The moment every fixture is written relative to. `capture.mjs` fixes the browser clock here. */
export const NOW = Date.parse(constants.now);
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
