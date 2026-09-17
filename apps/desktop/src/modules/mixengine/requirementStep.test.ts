import { describe, expect, it } from "vitest";

import type { Requirement } from "@mixengine/api";

import {
  askingStep,
  needLabel,
  requirementStep,
  requirementsAllowApply,
  splitLibraries,
} from "./requirementStep";

const visualCpp: Requirement = {
  need: { need: "visual_cpp", year: "2019", arch: "x64" },
  remedy: { remedy: "install_visual_cpp", arch: "x64" },
};

const oldMac: Requirement = {
  need: { need: "macos", at_least: "14.0", found: "13.6" },
  remedy: { remedy: "choose_version", version: "8.3.33" },
};

const nowhere: Requirement = {
  need: { need: "glibc", at_least: "2.34", found: "2.31" },
  remedy: { remedy: "unavailable" },
};

const noSound: Requirement = {
  need: { need: "shared_library", soname: "libasound.so.2" },
  remedy: { remedy: "install_from_distribution" },
};

describe("a library the distribution provides", () => {
  it("is a notice when it is all that is missing, and asks nothing", () => {
    expect(requirementStep([noSound])).toEqual({ kind: "notice", needs: [noSound.need] });
    expect(askingStep(requirementStep([noSound]))).toBeNull();
  });

  it("never outranks a question or a refusal", () => {
    expect(requirementStep([noSound, visualCpp]).kind).toBe("consent");
    expect(requirementStep([noSound, nowhere]).kind).toBe("choose");
  });

  it("lets a blueprint apply", () => {
    expect(requirementsAllowApply([noSound], false)).toBe(true);
  });

  it("is named by soname, and gathered apart from every other need", () => {
    expect(needLabel(noSound.need)).toBe("libasound.so.2");
    expect(splitLibraries([noSound.need, oldMac.need])).toEqual({
      others: ["macOS 14.0+"],
      libraries: ["libasound.so.2"],
    });
  });
});

describe("requirementStep", () => {
  it("lets an install that lacks nothing go straight on", () => {
    expect(requirementStep([])).toEqual({ kind: "proceed" });
  });

  it("asks once for everything MixEngine can install", () => {
    expect(requirementStep([visualCpp, visualCpp])).toEqual({
      kind: "consent",
      arches: ["x64"],
      needs: [visualCpp.need, visualCpp.need],
    });
  });

  it("offers the release that runs when nothing can be installed", () => {
    expect(requirementStep([oldMac])).toEqual({
      kind: "choose",
      version: "8.3.33",
      needs: [oldMac.need],
    });
  });

  it("never asks to install something that would not be enough", () => {
    const step = requirementStep([visualCpp, nowhere]);
    expect(step.kind).toBe("choose");
    expect(step.kind === "choose" && step.version).toBeNull();
  });
});

describe("askingStep", () => {
  it("needs a dialog only where there is something to agree to", () => {
    expect(askingStep(requirementStep([]))).toBeNull();
    expect(askingStep(requirementStep([nowhere]))).toBeNull();
    expect(askingStep(requirementStep([oldMac]))?.kind).toBe("choose");
    expect(askingStep(requirementStep([visualCpp]))?.kind).toBe("consent");
  });
});

describe("needLabel", () => {
  it("says each need in the words a cell has room for", () => {
    expect(needLabel(visualCpp.need)).toBe("Visual C++ 2019 (x64)");
    expect(needLabel(oldMac.need)).toBe("macOS 14.0+");
    expect(needLabel(nowhere.need)).toBe("glibc 2.34+");
    expect(needLabel({ need: "cpu", feature: "avx" })).toBe("CPU with AVX");
  });
});

describe("requirementsAllowApply", () => {
  it("allows a plan lacking nothing, an agreed one, and never a blocked one", () => {
    expect(requirementsAllowApply([], false)).toBe(true);
    expect(requirementsAllowApply([visualCpp], false)).toBe(false);
    expect(requirementsAllowApply([visualCpp], true)).toBe(true);
    expect(requirementsAllowApply([oldMac], true)).toBe(false);
  });
});
