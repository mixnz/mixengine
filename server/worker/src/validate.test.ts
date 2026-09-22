import { describe, expect, it } from "vitest";
import { isEmail } from "./validate";

describe("an email address", () => {
  it("is a plain address", () => {
    expect(isEmail("someone@example.com")).toBe(true);
    expect(isEmail("some.one+tag@mail.example.co.uk")).toBe(true);
  });

  it.each([
    "someone<victim@example.com>",
    '"MixLab"<victim@example.com>',
    "some,one@example.com",
    "some;one@example.com",
    "someone@example.com>",
    "some(one)@example.com",
    "some\\one@example.com",
    "someone@example.com",
    "someone@[192.0.2.1]",
  ])("is not %j", (bad) => {
    // A name and an address, or a list: each spelling was an account and a letter counter of its
    // own, all delivered to one mailbox, with a name the sender chose.
    expect(isEmail(bad)).toBe(false);
  });
});
