import { describe, expect, it } from "vitest";
import { portableKeyPath, sshFromSync, sshToSync, type SshConfig } from "./ssh";

describe("a key path as it travels", () => {
  it("is home-relative when it sits under a home folder, on any system", () => {
    expect(portableKeyPath("/Users/light/.ssh/id_rsa")).toBe("~/.ssh/id_rsa");
    expect(portableKeyPath("/home/me/.ssh/id_ed25519")).toBe("~/.ssh/id_ed25519");
    expect(portableKeyPath("/root/.ssh/id_rsa")).toBe("~/.ssh/id_rsa");
    expect(portableKeyPath("C:\\Users\\haiqu\\.ssh\\id_rsa")).toBe("~/.ssh/id_rsa");
    expect(portableKeyPath("c:/Users/haiqu/keys/id")).toBe("~/keys/id");
    expect(portableKeyPath("~/.ssh/id_rsa")).toBe("~/.ssh/id_rsa");
    expect(portableKeyPath("~\\.ssh\\id_rsa")).toBe("~/.ssh/id_rsa");
  });

  it("does not travel when it names a place only this machine has", () => {
    expect(portableKeyPath("/opt/keys/id")).toBe("");
    expect(portableKeyPath("D:\\keys\\id")).toBe("");
    expect(portableKeyPath("/Users/light")).toBe("");
    expect(portableKeyPath("")).toBe("");
  });
});

const key = (key_path: string): SshConfig => ({
  host: "h",
  port: 22,
  username: "u",
  auth: { type: "privatekey", key_path },
});

describe("an SSH server as it travels", () => {
  it("carries its key path home-relative", () => {
    expect(sshToSync(key("/Users/light/.ssh/id_rsa")).auth).toEqual({ type: "privatekey", key_path: "~/.ssh/id_rsa" });
  });

  it("keeps this machine's key path when the other machine's could not travel", () => {
    expect(sshFromSync(key(""), key("D:\\keys\\id")).auth).toEqual({ type: "privatekey", key_path: "D:\\keys\\id" });
    expect(sshFromSync(key(""), undefined).auth).toEqual({ type: "privatekey", key_path: "" });
  });

  it("takes the home-relative path that travelled over this machine's own", () => {
    expect(sshFromSync(key("~/.ssh/id_rsa"), key("/Users/light/.ssh/id_rsa")).auth).toEqual({
      type: "privatekey",
      key_path: "~/.ssh/id_rsa",
    });
  });

  it("leaves a password server alone", () => {
    const password: SshConfig = { host: "h", port: 22, username: "u", auth: { type: "password", password: "" } };
    expect(sshToSync(password)).toEqual(password);
    expect(sshFromSync(password, key("/x"))).toEqual(password);
  });
});
