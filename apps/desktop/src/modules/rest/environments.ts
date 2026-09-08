/**
 * An environment: a named set of values that `{{var}}` resolves against.
 *
 * One list, shared by the whole app — the request list does not change when the environment does,
 * because an environment only decides what a request's variables come out as.
 *
 * Everything here is pure. Where an environment is *kept* — `rest-environments.json` for the
 * names, the OS credential store for the values marked secret — is `environmentsStore.ts`, and the
 * two halves of that split are the last three functions in this file so they can be tested without
 * a keyring.
 */

export interface EnvVar {
  name: string;
  value: string;
  /** Kept in the OS credential store instead of the file, and shown as dots in the URL preview. */
  secret: boolean;
}

export interface Environment {
  id: string;
  name: string;
  vars: EnvVar[];
}

/** What a secret's value looks like in the preview line. Six of them: enough to read as "something
 *  is here", short enough not to push the rest of a URL off the end of the line. */
export const SECRET_MASK = "\u2022\u2022\u2022\u2022\u2022\u2022";

export function newEnvironment(id: string, name: string): Environment {
  return { id, name, vars: [] };
}

/** An empty row for the variables table. Not secret: the flag is a decision, and a row nobody has
 *  looked at yet has not had one made about it. */
export function newVar(): EnvVar {
  return { name: "", value: "", secret: false };
}

/** Name to value, for the rows that have a name. The first of two rows sharing a name wins — it is
 *  the one nearer the top of the table, which is the one a reader would expect to be in force. */
function map(env: Environment, valueOf: (v: EnvVar) => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const variable of env.vars) {
    if (variable.name === "" || variable.name in out) continue;
    out[variable.name] = valueOf(variable);
  }
  return out;
}

/** What `interpolate` is given on the way to the wire. **Null means no environment is chosen**,
 *  which is not the same as an environment with nothing in it: null turns interpolation off
 *  altogether, so `{{var}}` reaches the server as text and no send is ever blocked. */
export function varMap(env: Environment | null): Record<string, string> | null {
  return env === null ? null : map(env, (v) => v.value);
}

/** The same map for the preview line, with secrets shown rather than told. What is sent is the
 *  real value; this is only what is drawn under the URL box. */
export function previewVars(env: Environment | null): Record<string, string> | null {
  return env === null ? null : map(env, (v) => (v.secret ? SECRET_MASK : v.value));
}

/**
 * The map the history is written with: every ordinary variable, and no secret one.
 *
 * A name that is not in the map is left standing in its braces, so `Bearer {{token}}` reads as
 * `Bearer {{token}}` a week later — which says what was sent without saying what the token was.
 * Written as its own loop rather than through `map` so that the first row of a name still decides,
 * exactly as `varMap` has it: a name claimed by a secret row is claimed, not skipped over.
 */
export function historyVars(env: Environment | null): Record<string, string> | null {
  if (env === null) return null;
  const out: Record<string, string> = {};
  const claimed = new Set<string>();
  for (const variable of env.vars) {
    if (variable.name === "" || claimed.has(variable.name)) continue;
    claimed.add(variable.name);
    if (!variable.secret) out[variable.name] = variable.value;
  }
  return out;
}

export function findEnvironment(list: Environment[], id: string | null): Environment | null {
  if (id === null) return null;
  return list.find((env) => env.id === id) ?? null;
}

export function addEnvironment(list: Environment[], env: Environment): Environment[] {
  return [...list, env];
}

export function updateEnvironment(list: Environment[], env: Environment): Environment[] {
  return list.map((existing) => (existing.id === env.id ? env : existing));
}

export function removeEnvironment(list: Environment[], id: string): Environment[] {
  return list.filter((env) => env.id !== id);
}

/** The environment with a row for each name it has not got, empty and waiting to be filled. What
 *  the button under a blocked Send does: the names are already known, and typing them out again is
 *  the part nobody should have to do. */
export function withVariables(env: Environment, names: string[]): Environment {
  const held = new Set(env.vars.map((v) => v.name));
  const added = names.filter((name) => !held.has(name)).map((name) => ({ ...newVar(), name }));
  return added.length === 0 ? env : { ...env, vars: [...env.vars, ...added] };
}

/** The environment as it goes to disk: every row, and the value of the secret ones dropped. */
export function withoutSecrets(env: Environment): Environment {
  return { ...env, vars: env.vars.map((v) => (v.secret ? { ...v, value: "" } : v)) };
}

/** What the credential store is handed, keyed by variable name. */
export function secretsOf(env: Environment): Record<string, string> {
  const out: Record<string, string> = {};
  for (const variable of env.vars) {
    if (variable.secret && variable.name !== "") out[variable.name] = variable.value;
  }
  return out;
}

/** The environment as it came off disk, with the credential store's half put back. A secret the
 *  store has nothing for stays empty — which is what an entry deleted from the OS store, or a
 *  variable marked secret before anything was typed into it, looks like. */
export function withSecrets(env: Environment, secrets: Record<string, string>): Environment {
  return {
    ...env,
    vars: env.vars.map((v) => (v.secret ? { ...v, value: secrets[v.name] ?? v.value } : v)),
  };
}
