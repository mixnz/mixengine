import { describe, expect, it } from "vitest";

import type { UpdateHandedOver, UpdateStatus } from "@mixengine/api";

import { updatesView } from "./updatesState";

const status: UpdateStatus = {
  current: "0.0.8",
  available: {
    version: "0.0.9",
    published_at: "2026-09-24T00:00:00Z",
    notes: "",
    size: 68638683,
  },
  offered: true,
  stale: false,
  placement: { kind: "managed", directory: "/usr/local/bin", because: "the .pkg installed this copy" },
  installer: { kind: "pkg", size: 68638683 },
};

const handed: UpdateHandedOver = {
  version: "0.0.9",
  package: "/x/mixlab-0.0.9-macos-universal.pkg",
  command: "sudo installer -pkg '/x/mixlab-0.0.9-macos-universal.pkg' -target /",
  opened: true,
};

describe("updatesView", () => {
  // The daemon's `installed` wins over everything: the new binaries are on disk (T88f, D7).
  it("offers to finish once the daemon reads the new version on disk", () => {
    expect(updatesView({ ...status, installed: "0.0.9" }, handed)).toBe("installed");
    expect(updatesView({ ...status, installed: "0.0.9" }, null)).toBe("installed");
  });

  it("waits on Installer.app while a handover is open and nothing is installed", () => {
    expect(updatesView(status, handed)).toBe("installerOpen");
  });

  // A .pkg copy reads `managed` on the wire and is still offered its update.
  it("offers a .pkg copy its update rather than the refusal", () => {
    expect(updatesView(status, null)).toBe("offer");
  });

  it("refuses a managed copy with no installer", () => {
    const managed = { ...status, installer: undefined, offered: false };
    expect(updatesView(managed, null)).toBe("managed");
  });

  it("says nothing is offered when nothing is", () => {
    const self = {
      ...status,
      installer: undefined,
      offered: false,
      placement: { kind: "self_updatable" as const, directory: "/opt/mixengine" },
    };
    expect(updatesView(self, null)).toBe("none");
  });
});
