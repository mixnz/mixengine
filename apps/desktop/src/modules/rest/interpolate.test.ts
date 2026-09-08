import { describe, expect, it } from "vitest";
import { interpolate } from "./interpolate";

const vars = { host: "api.example.com", baseUrl: "https://{{host}}", token: "t0k", empty: "" };

describe("interpolate", () => {
  it("puts a value where the variable was", () => {
    expect(interpolate("{{baseUrl}}/users", { baseUrl: "https://x.dev" }).text).toBe(
      "https://x.dev/users",
    );
  });

  it("expands a value that is itself made of variables", () => {
    expect(interpolate("{{baseUrl}}/users", vars).text).toBe("https://api.example.com/users");
  });

  it("leaves an unknown variable where it is and names it", () => {
    const out = interpolate("Bearer {{missing}}", vars);
    expect(out.text).toBe("Bearer {{missing}}");
    expect(out.missing).toEqual(["missing"]);
  });

  // A variable set to nothing is set. Reading it as missing would block a send over a value its
  // owner deliberately left empty.
  it("treats an empty value as a value", () => {
    const out = interpolate("{{empty}}!", vars);
    expect(out.text).toBe("!");
    expect(out.missing).toEqual([]);
  });

  it("names each missing variable once, in the order first met", () => {
    const out = interpolate("{{b}} {{a}} {{b}}", {});
    expect(out.missing).toEqual(["b", "a"]);
  });

  // The whole reason the charset is narrow: a body carrying a Handlebars template must reach the
  // server as it was written.
  it("leaves anything that is not a name alone", () => {
    const template = "{{#each items}}{{ spaced }}{{}}";
    const out = interpolate(template, vars);
    expect(out.text).toBe(template);
    expect(out.missing).toEqual([]);
  });

  it("takes a backslash as an instruction to send the braces themselves", () => {
    const out = interpolate("\\{{token}} and {{token}}", vars);
    expect(out.text).toBe("{{token}} and t0k");
    expect(out.missing).toEqual([]);
  });

  // The literal an escape produced must not be eaten by the round after it.
  it("keeps an escaped literal through the rounds that follow", () => {
    const out = interpolate("{{wrapper}}", { wrapper: "\\{{token}}", token: "t0k" });
    expect(out.text).toBe("{{token}}");
  });

  it("resolves a chain five deep without calling it a cycle", () => {
    const chain = { a: "{{b}}", b: "{{c}}", c: "{{d}}", d: "{{e}}", e: "end" };
    const out = interpolate("{{a}}", chain);
    expect(out.text).toBe("end");
    expect(out.cyclic).toBe(false);
  });

  it("gives up on a variable that refers back to itself", () => {
    expect(interpolate("{{loop}}", { loop: "{{loop}}" }).cyclic).toBe(true);
    expect(interpolate("{{a}}", { a: "{{b}}", b: "{{a}}" }).cyclic).toBe(true);
  });
});
