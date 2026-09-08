/**
 * `{{var}}` turned into what the environment says it is.
 *
 * The only place the shape of a variable is decided, and the only place that decides what happens
 * when there is no value for one. Pure, so both are settled under `npm test` rather than in a
 * component nobody can run without a server.
 */

/** A name is letters, digits, and the three marks names are usually built from. Anything else
 *  between braces is not a variable: `{{#each items}}` and `{{ x }}` are a template the request is
 *  carrying to a server, and they travel through untouched. */
const VAR = /(\\?)\{\{([A-Za-z0-9_.-]+)\}\}/g;

/** How many rounds of substitution a text is allowed. Five is far past anything real —
 *  `baseUrl = https://{{host}}` is two — and finite, which is what a variable pointing at itself
 *  needs it to be. A chain exactly five deep still resolves: the round that finds nothing left to
 *  do is not one of the five. */
export const MAX_PASSES = 5;

export interface Interpolated {
  /** Every known variable replaced. An unknown one is left in its braces, which is what the
   *  preview line under the URL box paints red. */
  text: string;
  /** Names the text asked for that the environment had no value for, each once, in the order they
   *  were first met. */
  missing: string[];
  /** The rounds ran out with work still being done: a variable refers back to itself, directly or
   *  through another. The text is left mid-expansion — nothing is sent, so nobody sees it. */
  cyclic: boolean;
}

/** Stands in for an escaped `\{{name}}` while the rounds run, so a literal an escape produced is
 *  not substituted by the round after it. A control character no URL, header or form value holds,
 *  and it is put back only where this function itself left one. */
const FROZEN = "\u0000";

function restore(text: string, literals: string[]): string {
  if (literals.length === 0) return text;
  return text.replace(
    new RegExp(`${FROZEN}(\\d+)${FROZEN}`, "g"),
    (match, index: string) => literals[Number(index)] ?? match,
  );
}

export function interpolate(text: string, vars: Record<string, string>): Interpolated {
  const missing: string[] = [];
  const literals: string[] = [];
  let current = text;
  let changed = true;
  let rounds = 0;

  while (changed && rounds <= MAX_PASSES) {
    changed = false;
    current = current.replace(VAR, (match, escape: string, name: string) => {
      if (escape !== "") {
        changed = true;
        literals.push(`{{${name}}}`);
        return `${FROZEN}${literals.length - 1}${FROZEN}`;
      }
      const value = vars[name];
      if (value === undefined) {
        if (!missing.includes(name)) missing.push(name);
        return match;
      }
      changed = true;
      return value;
    });
    rounds++;
  }

  // The loop leaves on one of two conditions. Out of work is the ordinary end; out of rounds with
  // work still waiting is the other one, and there is no text that reaches it honestly.
  return { text: restore(current, literals), missing, cyclic: changed };
}
