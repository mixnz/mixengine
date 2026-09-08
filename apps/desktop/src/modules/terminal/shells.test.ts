import { describe, expect, it } from "vitest";
import { shellBrand, shellLabel } from "./shells";

describe("shellLabel", () => {
  it("gives the two PowerShells names that tell them apart", () => {
    expect(shellLabel("powershell")).toBe("Windows PowerShell");
    expect(shellLabel("pwsh")).toBe("PowerShell 7");
  });

  it("spells out the ones whose name is not the label", () => {
    expect(shellLabel("cmd")).toBe("Command Prompt");
    expect(shellLabel("git-bash")).toBe("Git Bash");
  });

  it("leaves a unix shell as it is", () => {
    expect(shellLabel("zsh")).toBe("zsh");
    expect(shellLabel("bash")).toBe("bash");
  });

  it("reads the distribution out of a WSL name", () => {
    expect(shellLabel("wsl:Ubuntu")).toBe("WSL: Ubuntu");
    expect(shellLabel("wsl:Ubuntu 22.04")).toBe("WSL: Ubuntu 22.04");
  });

  // Rust dò được cái gì thì frontend hiện cái đó — một shell chưa có trong bảng vẫn phải chọn được.
  it("falls back to the name for anything it has never heard of", () => {
    expect(shellLabel("fish")).toBe("fish");
  });
});

describe("shellBrand", () => {
  it("gives both PowerShells the same mark", () => {
    expect(shellBrand("powershell")).toBe("powershell");
    expect(shellBrand("pwsh")).toBe("powershell");
  });

  it("marks Git Bash by Git, not by bash", () => {
    expect(shellBrand("git-bash")).toBe("git");
    expect(shellBrand("bash")).toBe("bash");
  });

  it("marks every WSL distribution as Linux", () => {
    expect(shellBrand("wsl:Ubuntu")).toBe("linux");
    expect(shellBrand("wsl:my-dev-box")).toBe("linux");
  });

  // Không có logo là một câu trả lời, và `icons.tsx` vẽ biểu tượng terminal chung cho nó.
  it("has no mark for the shells that have no logo", () => {
    expect(shellBrand("cmd")).toBeNull();
    expect(shellBrand("sh")).toBeNull();
    expect(shellBrand("nushell")).toBeNull();
  });
});
