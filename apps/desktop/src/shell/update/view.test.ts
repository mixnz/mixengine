import { describe, expect, it } from "vitest";
import { isNewer, updateView, type ViewInput } from "./view";

const base: ViewInput = {
  current: "0.0.9",
  placement: { kind: "swap" },
  offered: { version: "0.0.10", hasBuild: true },
  skipped: null,
  installing: false,
  handedOver: false,
  onDisk: null,
};

describe("updateView", () => {
  it("offers a newer version", () => expect(updateView(base)).toBe("offer"));

  it("says up to date when the feed is not newer", () =>
    expect(updateView({ ...base, offered: { version: "0.0.9", hasBuild: true } })).toBe("upToDate"));

  it("never offers an older version, whatever the feed says", () =>
    expect(updateView({ ...base, offered: { version: "0.0.8", hasBuild: true } })).toBe("upToDate"));

  it("says so when there is no build for this machine", () =>
    expect(updateView({ ...base, offered: { version: "0.0.10", hasBuild: false } })).toBe("noBuild"));

  it("keeps a skipped version quiet", () => expect(updateView({ ...base, skipped: "0.0.10" })).toBe("skipped"));

  it("puts development and elsewhere before any offer", () => {
    expect(updateView({ ...base, placement: { kind: "development" } })).toBe("development");
    expect(updateView({ ...base, placement: { kind: "elsewhere" } })).toBe("elsewhere");
  });

  it("shows the work in progress over the offer", () =>
    expect(updateView({ ...base, installing: true })).toBe("installing"));

  it("offers Finish once the installer has put the new version on disk", () => {
    const handed: ViewInput = { ...base, placement: { kind: "installer" }, handedOver: true };
    expect(updateView(handed)).toBe("handedOver");
    expect(updateView({ ...handed, onDisk: "0.0.9" })).toBe("handedOver");
    expect(updateView({ ...handed, onDisk: "0.0.10" })).toBe("finish");
  });

  it("is up to date when nothing has been read yet", () =>
    expect(updateView({ ...base, offered: null })).toBe("upToDate"));
});

describe("isNewer", () => {
  it("compares numerically, part by part", () => {
    expect(isNewer("0.0.10", "0.0.9")).toBe(true);
    expect(isNewer("0.0.9", "0.0.10")).toBe(false);
    expect(isNewer("0.1.0", "0.0.99")).toBe(true);
    expect(isNewer("0.0.9", "0.0.9")).toBe(false);
  });
});
