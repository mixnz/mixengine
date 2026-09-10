import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { bashArray, bashScalar, headlessBinaries } from "./packaging-lists.mjs";

const FIXTURE = [
  "# a comment, and a line that is not an assignment",
  "MIX_BINARIES=(mix mixengined mixengine-shim mixengine-elevate mixlab)",
  "export MIX_BINARIES",
  "",
  "MIX_CRATES=(mixengine-cli mixengine-daemon mixengine-shim mixengine-elevate mixlab)",
  "export MIX_CRATES",
  "MIX_WINDOW=mixlab",
  "export MIX_WINDOW",
  "",
].join("\n");

describe("headlessBinaries", () => {
  it("pairs each binary with the crate at the same index and drops the window", () => {
    expect(headlessBinaries(FIXTURE)).toEqual([
      { binary: "mix", crate: "mixengine-cli" },
      { binary: "mixengined", crate: "mixengine-daemon" },
      { binary: "mixengine-shim", crate: "mixengine-shim" },
      { binary: "mixengine-elevate", crate: "mixengine-elevate" },
    ]);
  });

  it("refuses a file with no MIX_BINARIES line", () => {
    const text = FIXTURE.replace(/^MIX_BINARIES=.*$/m, "");
    expect(() => headlessBinaries(text)).toThrow(/MIX_BINARIES/);
  });

  it("refuses arrays of different lengths, because they are paired by index", () => {
    const text = FIXTURE.replace("MIX_CRATES=(mixengine-cli ", "MIX_CRATES=(");
    expect(() => headlessBinaries(text)).toThrow(/paired by index/);
  });

  it("reads the repository's own common.sh", () => {
    const common = readFileSync(
      fileURLToPath(new URL("../../../packaging/common.sh", import.meta.url)),
      "utf8",
    );
    const staged = headlessBinaries(common);
    expect(staged.map(({ binary }) => binary)).toContain("mixengined");
    expect(staged.map(({ binary }) => binary)).not.toContain(bashScalar(common, "MIX_WINDOW"));
    expect(staged).toHaveLength(bashArray(common, "MIX_BINARIES").length - 1);
  });
});
