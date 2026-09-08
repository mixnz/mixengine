import { describe, expect, it } from "vitest";
import {
  SECRET_MASK,
  addEnvironment,
  findEnvironment,
  historyVars,
  newEnvironment,
  previewVars,
  removeEnvironment,
  secretsOf,
  updateEnvironment,
  varMap,
  withSecrets,
  withVariables,
  withoutSecrets,
} from "./environments";

const dev = (): ReturnType<typeof newEnvironment> => ({
  id: "e1",
  name: "Dev",
  vars: [
    { name: "host", value: "api.dev", secret: false },
    { name: "token", value: "t0k", secret: true },
  ],
});

describe("varMap", () => {
  it("is null for no environment, which is what stops interpolation running at all", () => {
    expect(varMap(null)).toBeNull();
  });

  it("gives every variable its value, secret or not", () => {
    expect(varMap(dev())).toEqual({ host: "api.dev", token: "t0k" });
  });

  // A row typed into and not yet named is the empty one at the foot of the table.
  it("passes over a row with no name", () => {
    const env = { ...dev(), vars: [{ name: "", value: "orphan", secret: false }] };
    expect(varMap(env)).toEqual({});
  });

  // Two rows can be given the same name, and one of them has to win. The first does, because it
  // is the one nearer the top of a table read from the top.
  it("keeps the first of two rows with the same name", () => {
    const env = {
      ...dev(),
      vars: [
        { name: "host", value: "first", secret: false },
        { name: "host", value: "second", secret: false },
      ],
    };
    expect(varMap(env)).toEqual({ host: "first" });
  });
});

describe("previewVars", () => {
  it("shows a secret as dots and everything else as itself", () => {
    expect(previewVars(dev())).toEqual({ host: "api.dev", token: SECRET_MASK });
  });

  it("is null for no environment", () => {
    expect(previewVars(null)).toBeNull();
  });
});

describe("the keyring split", () => {
  it("keeps a secret's name and flag in the file and its value out", () => {
    expect(withoutSecrets(dev()).vars).toEqual([
      { name: "host", value: "api.dev", secret: false },
      { name: "token", value: "", secret: true },
    ]);
  });

  it("hands the credential store only the secrets", () => {
    expect(secretsOf(dev())).toEqual({ token: "t0k" });
  });

  it("puts the values back where they were", () => {
    const stored = withoutSecrets(dev());
    expect(withSecrets(stored, secretsOf(dev()))).toEqual(dev());
  });

  // An entry the user deleted from the OS store, or one written before a variable was marked
  // secret: the row is still there and its value is simply empty.
  it("reads a secret the store has nothing for as empty", () => {
    expect(withSecrets(withoutSecrets(dev()), {}).vars[1].value).toBe("");
  });
});

describe("the list", () => {
  it("finds one by id and answers null for an id nothing has", () => {
    const list = [dev()];
    expect(findEnvironment(list, "e1")?.name).toBe("Dev");
    expect(findEnvironment(list, "gone")).toBeNull();
    expect(findEnvironment(list, null)).toBeNull();
  });

  it("adds, replaces and removes", () => {
    const prod = newEnvironment("e2", "Prod");
    const two = addEnvironment([dev()], prod);
    expect(two.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(updateEnvironment(two, { ...prod, name: "Live" })[1].name).toBe("Live");
    expect(removeEnvironment(two, "e1").map((e) => e.id)).toEqual(["e2"]);
  });

  // What the blocked-send button does: the names go in with nothing in them, ready to be filled.
  it("adds the variables a request asked for and skips the ones already there", () => {
    const filled = withVariables(dev(), ["token", "apiKey"]);
    expect(filled.vars.map((v) => v.name)).toEqual(["host", "token", "apiKey"]);
    expect(filled.vars[2]).toEqual({ name: "apiKey", value: "", secret: false });
  });
});

describe("historyVars", () => {
  const env = {
    id: "e1",
    name: "Dev",
    vars: [
      { name: "host", value: "api.example.com", secret: false },
      { name: "token", value: "s3cret", secret: true },
      { name: "", value: "ignored", secret: false },
    ],
  };

  it("holds the ordinary variables and no secret one", () => {
    expect(historyVars(env)).toEqual({ host: "api.example.com" });
  });

  it("is null with no environment, so nothing is resolved at all", () => {
    expect(historyVars(null)).toBeNull();
  });

  it("lets the first row of a name decide, exactly as varMap does", () => {
    const twice = {
      ...env,
      vars: [
        { name: "host", value: "first", secret: false },
        { name: "host", value: "second", secret: true },
      ],
    };
    expect(historyVars(twice)).toEqual({ host: "first" });
  });
});
