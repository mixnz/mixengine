import { describe, expect, it } from "vitest";
import { mailbox } from "./email";

// The vectors `../native/src/email.rs` asserts too: the sender line is one string for three
// providers, and the two servers have to write it the same way.
describe("the sender line", () => {
  it("takes a plain name as it is", () => {
    expect(mailbox("MixLab", "no-reply@example.com")).toBe("MixLab <no-reply@example.com>");
  });

  it("quotes a name holding a special", () => {
    expect(mailbox("Acme, Inc.", "no-reply@example.com")).toBe(
      '"Acme, Inc." <no-reply@example.com>',
    );
    expect(mailbox('The "Lab" \\ Team', "a@example.com")).toBe(
      '"The \\"Lab\\" \\\\ Team" <a@example.com>',
    );
  });
});
