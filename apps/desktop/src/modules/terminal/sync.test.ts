import { describe, expect, it } from "vitest";
import {
  hostSecretsFromSync,
  hostSecretsToSync,
  settingsFromSync,
  settingsToSync,
  targetFromSync,
  targetsToSync,
} from "./sync";
import type { TerminalSettings } from "./settings";
import type { SavedTarget } from "./types";

const settings = {
  fontFamily: "Fira Code",
  fontSize: 14,
  scrollback: 5000,
  cursorStyle: "bar",
  cursorBlink: true,
  defaultShell: "pwsh",
  defaultCwd: "C:\\work",
  rightClickPastes: true,
} as unknown as TerminalSettings;

describe("terminal settings in sync", () => {
  it("carry the font, the cursor and the scrollback, and nothing about this machine", () => {
    const [item] = settingsToSync(settings);
    expect(item?.id).toBe("settings");
    expect(item?.data).toEqual({
      fontFamily: "Fira Code",
      fontSize: 14,
      scrollback: 5000,
      cursorStyle: "bar",
      cursorBlink: true,
    });
  });

  it("change only what travelled", () => {
    const patch = settingsFromSync({ id: "settings", data: { fontSize: 16 } });
    expect(patch).toEqual({ fontSize: 16 });
  });
});

describe("saved hosts in sync", () => {
  it("are the SSH ones only", () => {
    const targets = [
      { id: "l", name: "Local", kind: "local", shellName: "pwsh" },
      { id: "s", name: "Server", kind: "ssh", config: { host: "h", port: 22, username: "u", auth: { type: "password", password: "pw" } } },
    ] as unknown as SavedTarget[];
    const items = targetsToSync(targets);
    expect(items.map((item) => item.id)).toEqual(["s"]);
    expect(JSON.stringify(items)).not.toContain("\"pw\"");
  });

  it("refuse a local target from another machine", () => {
    expect(targetFromSync({ id: "l", data: { name: "Local", kind: "local", shellName: "pwsh" } }, undefined)).toBeNull();
  });
});

describe("what travels of a host's credentials", () => {
  const ssh = (id: string, auth: object): SavedTarget =>
    ({ id, name: id, kind: "ssh", config: { host: "h", port: 22, username: "u", auth } }) as SavedTarget;

  it("is the SSH password or passphrase, and nothing for a host with neither", () => {
    expect(
      hostSecretsToSync([
        ssh("a", { type: "password", password: "pw" }),
        ssh("b", { type: "privatekey", key_path: "k", passphrase: "pp" }),
        ssh("c", { type: "privatekey", key_path: "k" }),
      ]),
    ).toEqual([
      { id: "a", data: { sshPassword: "pw" } },
      { id: "b", data: { sshPassphrase: "pp" } },
    ]);
  });

  it("arrives as those two fields, strings only", () => {
    expect(hostSecretsFromSync({ sshPassword: "pw", sshPassphrase: 3, other: "x" })).toEqual({ sshPassword: "pw" });
    expect(hostSecretsFromSync(null)).toBeNull();
  });
});
