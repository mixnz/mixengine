import { describe, expect, it } from "vitest";
/* The split and the merge moved to `core/ssh.ts` — the db module tunnels through the same
   servers and was doing the same thing. These tests came with them unchanged, which is what
   says the move changed no behaviour. */
import { mergeSshSecrets as mergeSecrets, splitSshSecrets as splitSecrets } from "../../core/ssh";
import { parseSavedTarget, withoutSecrets } from "./savedTargets";
import type { SavedTarget, SshConfig } from "./types";

const withPassword: SshConfig = {
  host: "example.com",
  port: 22,
  username: "deploy",
  auth: { type: "password", password: "hunter2" },
};

const withKey: SshConfig = {
  host: "example.com",
  port: 2222,
  username: "deploy",
  auth: { type: "privatekey", key_path: "/home/me/.ssh/id_ed25519", passphrase: "let me in" },
};

describe("splitSecrets", () => {
  it("takes the password out of what goes to the file", () => {
    const { config, secrets } = splitSecrets(withPassword);
    expect(secrets).toEqual({ sshPassword: "hunter2" });
    expect(config.auth).toEqual({ type: "password", password: "" });
  });

  it("keeps the key's path and takes only the passphrase", () => {
    const { config, secrets } = splitSecrets(withKey);
    expect(secrets).toEqual({ sshPassphrase: "let me in" });
    expect(config.auth).toEqual({
      type: "privatekey",
      key_path: "/home/me/.ssh/id_ed25519",
      passphrase: undefined,
    });
  });

  /* A key with no passphrase must not leave an empty entry behind: `secrets_save` deletes the
     entry when handed nothing, which is exactly what should happen. */
  it("makes no secret out of nothing to hide", () => {
    const noPassphrase: SshConfig = {
      ...withKey,
      auth: { type: "privatekey", key_path: "/k", passphrase: "" },
    };
    expect(splitSecrets(noPassphrase).secrets).toEqual({});
  });

  it("leaves the host, the port and the user alone", () => {
    const { config } = splitSecrets(withKey);
    expect(config.host).toBe("example.com");
    expect(config.port).toBe(2222);
    expect(config.username).toBe("deploy");
  });
});

describe("mergeSecrets", () => {
  it("puts the password back where it came from", () => {
    const { config, secrets } = splitSecrets(withPassword);
    expect(mergeSecrets(config, secrets)).toEqual(withPassword);
  });

  it("puts the passphrase back where it came from", () => {
    const { config, secrets } = splitSecrets(withKey);
    expect(mergeSecrets(config, secrets)).toEqual(withKey);
  });

  /* Someone cleared the entry out of Credential Manager, or copied `terminal-hosts.json` to
     another machine: the host still has to open in the form, only with an empty password box. */
  it("leaves the box empty when the credential store has nothing", () => {
    const { config } = splitSecrets(withPassword);
    expect(mergeSecrets(config, {})).toEqual({
      ...withPassword,
      auth: { type: "password", password: "" },
    });
  });
});

describe("parseSavedTarget", () => {
  it("reads a shell on this machine", () => {
    expect(
      parseSavedTarget({
        id: "t-1",
        name: "frontend",
        kind: "local",
        shellName: "wsl:Ubuntu",
        cwd: "D:\work",
        runOnConnect: "cd ~/a",
      }),
    ).toEqual({
      id: "t-1",
      name: "frontend",
      kind: "local",
      shellName: "wsl:Ubuntu",
      cwd: "D:\work",
      runOnConnect: "cd ~/a",
    });
  });

  /* Cùng luật với `tabState.ts`: không có thư mục bắt đầu là mở ở thư mục mặc định của shell. */
  it("reads an absent working directory as none", () => {
    const entry = parseSavedTarget({ id: "t-1", name: "a", kind: "local", shellName: "pwsh" });
    expect(entry).toEqual({
      id: "t-1",
      name: "a",
      kind: "local",
      shellName: "pwsh",
      cwd: null,
      runOnConnect: undefined,
    });
  });

  /* Entry của bản cũ, hồi danh sách chỉ có máy chủ. Không đoán gì cả: hồi ấy không có loại nào
     khác, nên `ssh` là cái nó vốn là. */
  it("reads an entry written before there were kinds as a server", () => {
    const entry = parseSavedTarget({ id: "h-1", name: "prod", config: withPassword });
    expect(entry).toEqual({
      id: "h-1",
      name: "prod",
      kind: "ssh",
      config: withPassword,
      runOnConnect: undefined,
    });
  });

  it("gives up on anything it cannot draw a row for", () => {
    expect(parseSavedTarget(null)).toBeNull();
    expect(parseSavedTarget("t-1")).toBeNull();
    expect(parseSavedTarget([])).toBeNull();
    expect(parseSavedTarget({ name: "a", config: withPassword })).toBeNull();
    expect(parseSavedTarget({ id: "", name: "a", config: withPassword })).toBeNull();
    expect(parseSavedTarget({ id: "t-1", config: withPassword })).toBeNull();
    // Một máy chủ không có `config` thì không có gì để kết nối tới.
    expect(parseSavedTarget({ id: "t-1", name: "a", kind: "ssh" })).toBeNull();
    // Một shell không có tên thì không tìm lại được trong danh sách shell của máy.
    expect(parseSavedTarget({ id: "t-1", name: "a", kind: "local" })).toBeNull();
    // Một loại phiên bản sau này thêm vào: bản này không vẽ nổi nó.
    expect(parseSavedTarget({ id: "t-1", name: "a", kind: "serial" })).toBeNull();
    // Không có địa chỉ thì không có dòng nào để vẽ, dù mọi thứ khác đều ở đó.
    expect(
      parseSavedTarget({ id: "t-1", name: "a", config: { port: 22, username: "u", auth: withPassword.auth } }),
    ).toBeNull();
  });

  /* Chỗ này từng là một `as SshConfig`, tức là không kiểm gì cả. Một entry sửa tay thiếu `auth`
     đi lọt, rồi `mergeSecrets` đọc `config.auth.type` và ném ra giữa `Promise.all` của
     `loadSavedTargets` — cả danh sách rỗng suốt phiên làm việc vì một dòng. */
  it("reads a hand-edited server without dropping the list it is in", () => {
    const entry = parseSavedTarget({ id: "t-1", name: "prod", config: { host: "example.com" } });
    expect(entry).toEqual({
      id: "t-1",
      name: "prod",
      kind: "ssh",
      config: { host: "example.com", port: 22, username: "", auth: { type: "password", password: "" } },
      runOnConnect: undefined,
    });
    // Và cái vừa đọc ra đi qua được `mergeSecrets`, thứ đã ném ra trước đây.
    expect(() => mergeSecrets((entry as { config: SshConfig }).config, {})).not.toThrow();
  });

  it("falls back to the ssh port on one it cannot believe", () => {
    const port = (value: unknown) =>
      (parseSavedTarget({ id: "t-1", name: "a", config: { ...withPassword, port: value } }) as {
        config: SshConfig;
      }).config.port;
    expect(port(2222)).toBe(2222);
    expect(port("2222")).toBe(22);
    expect(port(0)).toBe(22);
    expect(port(70000)).toBe(22);
    expect(port(22.5)).toBe(22);
  });

  /** Một khoá riêng đọc thành khoá riêng, kể cả khi đường dẫn đã bị xoá khỏi file. */
  it("keeps a key entry a key entry", () => {
    const entry = parseSavedTarget({
      id: "t-1",
      name: "a",
      config: { host: "h", port: 22, username: "u", auth: { type: "privatekey" } },
    }) as { config: SshConfig };
    expect(entry.config.auth).toEqual({ type: "privatekey", key_path: "", passphrase: undefined });
  });
});

describe("withoutSecrets", () => {
  it("takes the password out of a server on its way to the file", () => {
    const target: SavedTarget = { id: "h-1", name: "prod", kind: "ssh", config: withPassword };
    const stored = withoutSecrets(target);
    expect(stored.kind === "ssh" && stored.config.auth).toEqual({ type: "password", password: "" });
  });

  /* Một shell trên máy này không có gì để giấu, nên nó không đi vòng nào cả — và `savedTargets.ts`
     cũng không gọi keyring cho nó. */
  it("passes a local shell through untouched", () => {
    const target: SavedTarget = {
      id: "t-1",
      name: "frontend",
      kind: "local",
      shellName: "pwsh",
      cwd: null,
      runOnConnect: "npm run dev",
    };
    expect(withoutSecrets(target)).toBe(target);
  });
});
