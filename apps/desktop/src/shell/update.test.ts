import { describe, expect, it } from "vitest";
import { holdsUpdate, isPending, type UpdateStatus } from "./update";

const EVERY: UpdateStatus[] = [
  "idle",
  "checking",
  "upToDate",
  "available",
  "downloading",
  "downloaded",
  "installing",
  "error",
];

describe("holdsUpdate", () => {
  /* The one that was missing. A bundle already on disk is a handle in use just as much as one
     being fetched: `check` closes it and puts a new one in its place, so the download the user
     waited for is gone and the offer drops back to "available". */
  it("counts a bundle waiting for the restart, not only one being fetched", () => {
    expect(holdsUpdate("downloaded")).toBe(true);
    expect(holdsUpdate("downloading")).toBe(true);
    expect(holdsUpdate("installing")).toBe(true);
  });

  it("leaves the handle free everywhere else", () => {
    for (const status of EVERY) {
      if (status === "downloading" || status === "downloaded" || status === "installing") continue;
      expect(holdsUpdate(status)).toBe(false);
    }
  });
});

describe("isPending", () => {
  /* A re-check does not un-find what was found. Without `checking` in the list the dot on the
     brand button and the panel in the corner blink off for the length of the request. */
  it("keeps announcing a found release while a re-check is out", () => {
    expect(isPending("checking", true, false)).toBe(true);
  });

  it("announces a release through the whole of fetching and installing it", () => {
    for (const status of ["available", "downloading", "downloaded", "installing", "error"] as const) {
      expect(isPending(status, true, false)).toBe(true);
    }
  });

  /** Nothing found is nothing to say — including a check that failed before it found anything,
   *  which belongs in Settings and not in a panel over the user's work. */
  it("says nothing without a release to say it about", () => {
    for (const status of EVERY) expect(isPending(status, false, false)).toBe(false);
  });

  it("says nothing about a version the user has skipped", () => {
    for (const status of EVERY) expect(isPending(status, true, true)).toBe(false);
  });
});
