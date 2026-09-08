import { describe, expect, it } from "vitest";
import { openableUrl } from "./links";

describe("openableUrl", () => {
  it("passes the two schemes a browser is for", () => {
    expect(openableUrl("https://example.com/a?b=1#c")).toBe("https://example.com/a?b=1#c");
    expect(openableUrl("http://192.168.50.86:3307/")).toBe("http://192.168.50.86:3307/");
  });

  /* Every one of these is a string a server printed into someone's terminal. Handing it to the
     operating system's opener is handing that server a way to start something on this machine. */
  it("refuses every other scheme", () => {
    expect(openableUrl("file:///etc/passwd")).toBeNull();
    expect(openableUrl("javascript:alert(1)")).toBeNull();
    expect(openableUrl("vscode://file/etc/passwd")).toBeNull();
    expect(openableUrl("ms-msdt:/id")).toBeNull();
    expect(openableUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("refuses what is not a url at all", () => {
    expect(openableUrl("")).toBeNull();
    expect(openableUrl("example.com")).toBeNull();
    expect(openableUrl("HTTPS//example.com")).toBeNull();
  });

  /* Case belongs to the scheme, not to the user: `HTTPS://` is the same scheme shouted. */
  it("does not mind how the scheme is spelled", () => {
    expect(openableUrl("HTTPS://example.com/")).toBe("HTTPS://example.com/");
  });
});
