import { describe, expect, it } from "vitest";
import { parseTerminalTabState, tabStateFor } from "./tabState";
import type { LocalShell, SshConfig } from "./types";

const SHELL: LocalShell = { name: "wsl:Ubuntu", path: "wsl.exe", args: ["-d", "Ubuntu"] };
const CONFIG: SshConfig = {
  host: "192.168.50.86",
  port: 22,
  username: "demo",
  auth: { type: "password", password: "demo" },
};

describe("parseTerminalTabState", () => {
  it("đọc lại được nhánh ssh", () => {
    expect(parseTerminalTabState({ kind: "ssh", targetId: "t-1" })).toEqual({
      kind: "ssh",
      targetId: "t-1",
    });
  });

  /* State ghi bởi bản trước, hồi danh sách chỉ có máy chủ và id được gọi là `hostId`. Một tab đang
     mở lúc người dùng nâng cấp không mất chỗ nó đang đứng. */
  it("đọc được id của phiên trước, hồi nó còn tên là hostId", () => {
    expect(parseTerminalTabState({ kind: "ssh", hostId: "h-1" })).toEqual({
      kind: "ssh",
      targetId: "h-1",
    });
    expect(parseTerminalTabState({ kind: "local", shellName: "pwsh", hostId: "h-1" })).toEqual({
      kind: "local",
      shellName: "pwsh",
      cwd: null,
      targetId: "h-1",
    });
  });

  it("đọc lại được nhánh local", () => {
    expect(parseTerminalTabState({ kind: "local", shellName: "pwsh", cwd: "C:\\src" })).toEqual({
      kind: "local",
      shellName: "pwsh",
      cwd: "C:\\src",
      targetId: undefined,
    });
  });

  /* `targetId` là cộng thêm: shell và thư mục vẫn là cái mở lại tab, còn id chỉ để tra lệnh mở màn.
     Nên một shell chưa ai lưu thành dòng nào vẫn nhớ được. */
  it("giữ id của đích đã lưu bên cạnh shell, không thay nó", () => {
    expect(
      parseTerminalTabState({ kind: "local", shellName: "pwsh", cwd: null, targetId: "t-1" }),
    ).toEqual({ kind: "local", shellName: "pwsh", cwd: null, targetId: "t-1" });
  });

  it("nhận shell không có thư mục bắt đầu, viết cách nào cũng được", () => {
    // So cả object chứ không `?.cwd`: `TerminalTabState` là union, nhánh `ssh` không có `cwd`.
    const expected = { kind: "local", shellName: "pwsh", cwd: null, targetId: undefined };
    expect(parseTerminalTabState({ kind: "local", shellName: "pwsh", cwd: null })).toEqual(expected);
    expect(parseTerminalTabState({ kind: "local", shellName: "pwsh" })).toEqual(expected);
  });

  it("không nói gì về tab chưa từng ghi", () => {
    expect(parseTerminalTabState(undefined)).toBeNull();
  });

  /* Tất cả những cái dưới đây là chuỗi một phiên bản nào đó của app đã ghi vào `localStorage`, nên
     không tin gì cả — shell cố ý đưa qua mà không nhìn. */
  it("bỏ qua mọi thứ không phải state của tab terminal", () => {
    expect(parseTerminalTabState(null)).toBeNull();
    expect(parseTerminalTabState("ssh")).toBeNull();
    expect(parseTerminalTabState([])).toBeNull();
    expect(parseTerminalTabState({})).toBeNull();
    expect(parseTerminalTabState({ kind: "telnet", targetId: "t-1" })).toBeNull();
    expect(parseTerminalTabState({ kind: "ssh" })).toBeNull();
    expect(parseTerminalTabState({ kind: "ssh", targetId: "" })).toBeNull();
    expect(parseTerminalTabState({ kind: "ssh", targetId: 7 })).toBeNull();
    expect(parseTerminalTabState({ kind: "local" })).toBeNull();
    expect(parseTerminalTabState({ kind: "local", shellName: "" })).toBeNull();
    expect(parseTerminalTabState({ kind: "local", shellName: "pwsh", cwd: 7 })).toBeNull();
  });

  /* Một id không đọc được không làm hỏng cả state: shell và thư mục vẫn mở lại được tab, chỉ là
     không có entry nào để tra lệnh mở màn. */
  it("bỏ id hỏng của nhánh local mà vẫn giữ được shell", () => {
    expect(parseTerminalTabState({ kind: "local", shellName: "pwsh", targetId: 7 })).toEqual({
      kind: "local",
      shellName: "pwsh",
      cwd: null,
      targetId: undefined,
    });
  });
});

describe("tabStateFor", () => {
  it("giữ tên shell và thư mục bắt đầu, không giữ đường dẫn", () => {
    expect(
      tabStateFor({
        kind: "local",
        shell: SHELL,
        cwd: "C:\\src",
        targetId: null,
        runOnConnect: null,
      }),
    ).toEqual({
      kind: "local",
      shellName: "wsl:Ubuntu",
      cwd: "C:\\src",
      targetId: undefined,
    });
  });

  it("giữ id của đích đã lưu, không giữ gì trong config", () => {
    expect(
      tabStateFor({ kind: "ssh", config: CONFIG, targetId: "t-1", runOnConnect: null }),
    ).toEqual({
      kind: "ssh",
      targetId: "t-1",
    });
  });

  /* Kể cả lệnh mở màn: nó thuộc về entry trong `terminal-hosts.json`, và tab chỉ trỏ tới entry.
     Chép ra đây là để hai bản của cùng một thứ trôi khỏi nhau — sửa lệnh xong, tab cũ vẫn chạy
     lệnh cũ. */
  it("không chép lệnh mở màn ra khỏi đích đã lưu", () => {
    expect(
      tabStateFor({ kind: "ssh", config: CONFIG, targetId: "t-1", runOnConnect: "cd ~/a" }),
    ).toEqual({ kind: "ssh", targetId: "t-1" });
    expect(
      tabStateFor({
        kind: "local",
        shell: SHELL,
        cwd: null,
        targetId: "t-2",
        runOnConnect: "npm run dev",
      }),
    ).toEqual({ kind: "local", shellName: "wsl:Ubuntu", cwd: null, targetId: "t-2" });
  });

  it("không nhớ gì về một phiên SSH gõ tay", () => {
    // Không có id để trỏ tới, và mật khẩu thì không được ghi ra — nên không ghi gì cả.
    expect(
      tabStateFor({ kind: "ssh", config: CONFIG, targetId: null, runOnConnect: null }),
    ).toBeUndefined();
  });
});
