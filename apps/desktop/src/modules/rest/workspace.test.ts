import { describe, expect, it } from "vitest";
import { DEFAULT_SEND_SETTINGS } from "./buildRequest";
import {
  MAX_TIMEOUT_SECONDS,
  MIN_TIMEOUT_SECONDS,
  clampTimeoutSeconds,
  sendSettings,
  type Workspace,
} from "./workspace";

const workspace: Workspace = {
  sidebarWidth: 260,
  splitRatio: 0.5,
  lastEnvId: null,
  keepResponseBodies: true,
  timeoutMs: 5_000,
  followRedirects: false,
  acceptInvalidCerts: true,
};

describe("clampTimeoutSeconds", () => {
  it("keeps a sensible number", () => {
    expect(clampTimeoutSeconds(45)).toBe(45);
  });

  it("never allows a timeout of nothing", () => {
    expect(clampTimeoutSeconds(0)).toBe(MIN_TIMEOUT_SECONDS);
    expect(clampTimeoutSeconds(-10)).toBe(MIN_TIMEOUT_SECONDS);
  });

  it("has a ceiling", () => {
    expect(clampTimeoutSeconds(99_999)).toBe(MAX_TIMEOUT_SECONDS);
  });

  it("falls back to the default when the box is empty", () => {
    expect(clampTimeoutSeconds(Number.NaN)).toBe(DEFAULT_SEND_SETTINGS.timeoutMs / 1000);
  });
});

describe("sendSettings", () => {
  it("takes only the three the wire asks for", () => {
    expect(sendSettings(workspace)).toEqual({
      timeoutMs: 5_000,
      followRedirects: false,
      acceptInvalidCerts: true,
    });
  });
});
