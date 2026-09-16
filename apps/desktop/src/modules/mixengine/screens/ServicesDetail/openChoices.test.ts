import { describe, expect, it } from "vitest";
import type { DesktopClient } from "@mixengine/api";
import { createsDatabases, openChoices, opensADatabase } from "./openChoices";

/** The window itself: T107's answer on a merged install, and the common case. */
const thisWindow: DesktopClient = { state: "installed", name: "MixLab", program: "/usr/bin/mixlab" };

/** An application that is not this process — `database.client` only names an extension when the
 *  installed one's scheme is not the window's own. */
const anotherApp: DesktopClient = {
  state: "installed",
  extension: "dbeaver",
  name: "DBeaver",
  program: "/usr/bin/dbeaver",
};

const notInstalled: DesktopClient = {
  state: "not_installed",
  extension: "dbeaver",
  name: "DBeaver",
  searched: "App Paths and the uninstall table",
};

const noClient: DesktopClient = { state: "no_client" };

describe("openChoices", () => {
  it("is one button while this window draws the built-in client", () => {
    expect(openChoices(thisWindow, true)).toEqual(["builtIn"]);
  });

  /* Even with another application installed: inside the window, open is in-process and never
     through the OS — the desktop client design's D10. */
  it("is still one button with another application installed and the client visible", () => {
    expect(openChoices(anotherApp, true)).toEqual(["builtIn"]);
  });

  it("offers to turn the built-in client on when it is hidden", () => {
    expect(openChoices(thisWindow, false)).toEqual(["builtInAfterEnabling"]);
  });

  it("offers the other application too, when there is one", () => {
    expect(openChoices(anotherApp, false)).toEqual(["builtInAfterEnabling", "external"]);
  });

  /* Both non-installed states are a sentence and not a button, as they are today, whatever the
     profile says — T110 leaves what the affordance is *drawn from* alone. */
  it("offers nothing at all when the daemon names no client to open with", () => {
    for (const visible of [true, false]) {
      expect(openChoices(notInstalled, visible)).toEqual([]);
      expect(openChoices(noClient, visible)).toEqual([]);
    }
  });
});

describe("opensADatabase", () => {
  /* `protocol` là câu trả lời duy nhất cho "service này có phải database không". Cả panel ở màn
     Services lẫn menu 3 chấm ở Dashboard đều hỏi nó, nên nó phải là **một** hàm: hai chỗ tự quyết
     lấy là hai định nghĩa của cùng một câu hỏi, và chúng sẽ lệch nhau. */
  it("says yes to a service a client speaks a protocol to", () => {
    expect(opensADatabase({ protocol: "postgres" })).toBe(true);
  });

  /* nginx, caddy, php-fpm: `database.client` trả `protocol: null` cho chúng — một **trạng thái**,
     không phải lỗi. Chỗ này là nơi trạng thái đó biến thành "không vẽ gì cả". */
  it("says no to a service no client opens", () => {
    expect(opensADatabase({ protocol: null })).toBe(false);
  });

  /* `protocol` là member tuỳ chọn theo luật ADR 0019: vắng nghĩa là daemon cũ hơn member này, và
     đoán nó là một database sẽ vẽ ra một panel không có gì ở sau. */
  it("says no when the daemon never answered the member", () => {
    expect(opensADatabase({})).toBe(false);
  });
});

describe("createsDatabases", () => {
  it("draws the form unless the daemon said the server makes no databases", () => {
    expect(createsDatabases({ creates_databases: false })).toBe(false);
    expect(createsDatabases({ creates_databases: true })).toBe(true);
    // An older daemon sends nothing: keep the form it always had.
    expect(createsDatabases({})).toBe(true);
  });
});
