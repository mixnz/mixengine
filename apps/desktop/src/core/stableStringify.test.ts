import { describe, expect, it } from "vitest";
import { stableStringify } from "./stableStringify";

describe("stableStringify", () => {
  /* The whole reason this exists: the same connection, once as a form built it and once as it came
     back off disk, has to come out as one string. */
  it("does not mind what order the keys arrived in", () => {
    expect(stableStringify({ host: "a", port: 22, user: "me" })).toBe(
      stableStringify({ user: "me", host: "a", port: 22 }),
    );
  });

  it("sorts the keys of nested objects too", () => {
    expect(stableStringify({ auth: { type: "password", password: "x" } })).toBe(
      '{"auth":{"password":"x","type":"password"}}',
    );
  });

  /* Both stores in this app write absent for a default, so a field the form is holding as
     `undefined` and one the file never had are the same saved entry. */
  it("treats an undefined field as one that is not there", () => {
    expect(stableStringify({ name: "a", pinned: undefined })).toBe(stableStringify({ name: "a" }));
  });

  it("keeps an array in the order it was written", () => {
    expect(stableStringify({ args: ["-d", "Ubuntu"] })).toBe('{"args":["-d","Ubuntu"]}');
    expect(stableStringify(["b", "a"])).not.toBe(stableStringify(["a", "b"]));
  });

  it("says what JSON.stringify says about everything that is not an object", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify(7)).toBe("7");
    expect(stableStringify("a")).toBe('"a"');
    expect(stableStringify(true)).toBe("true");
  });

  /* An empty box and a field that was never there are two different things to the user, so they
     have to be two different things here. */
  it("does not confuse an empty string with an absent field", () => {
    expect(stableStringify({ passphrase: "" })).not.toBe(stableStringify({}));
  });
});
