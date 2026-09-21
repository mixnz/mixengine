import { describe, expect, it } from "vitest";
import { accountKey, normaliseCode, randomCode } from "./crypto";

// The pure half of this server, which needs no Worker to run. Everything else is exercised through
// `../conformance/`, against a running instance, the same way `../native/` is.

describe("the account key", () => {
  // **The vector both implementations assert**, from D4a. If this and the one in
  // `../native/src/crypto.rs` ever disagree, an account means two different things on the two
  // servers and a row cannot cross between them — which is the whole reason the value is frozen.
  it("matches the vector in the specification", async () => {
    expect(await accountKey("alice@example.com")).toBe(
      "176d00c0673f7e1e711ea55a7d9345f43949376bd9777c4854be01448b5b74a4",
    );
  });

  it("is the same key however the address was typed", async () => {
    const wanted = await accountKey("alice@example.com");
    expect(await accountKey("Alice@Example.com")).toBe(wanted);
    expect(await accountKey("  alice@example.com  ")).toBe(wanted);
  });

  it("is a different key for a different address", async () => {
    expect(await accountKey("alice@example.com")).not.toBe(await accountKey("bob@example.com"));
  });
});

describe("a code a person types", () => {
  it("is eight characters of Crockford base32, in two groups", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(randomCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    }
  });

  it("is read back however it was typed", () => {
    const code = randomCode();
    const bare = code.replace("-", "");
    expect(normaliseCode(code)).toBe(bare);
    expect(normaliseCode(code.toLowerCase())).toBe(bare);
    expect(normaliseCode(code.replace("-", " "))).toBe(bare);
    expect(normaliseCode(` ${code} `)).toBe(bare);
  });

  it.each(["IIII-IIII", "LLLL-LLLL", "OOOO-OOOO", "UUUU-UUUU", "ABC-ABC", ""])(
    "refuses %s",
    (presented) => {
      // The four letters the alphabet leaves out, and anything of the wrong length. Strict here,
      // because a character outside the alphabet means the person has the wrong thing in front of
      // them and should be told so rather than told their code is wrong.
      expect(normaliseCode(presented)).toBeNull();
    },
  );
});
