/**
 * Registration does not finish until the person types two of the recovery key's thirteen groups
 * back (D2). The point is not to test them: it is to make writing the key down the only way past
 * this screen.
 */

export function groupsOf(key: string): string[] {
  return key.split("-");
}

/** Two different group positions, 0-based, ascending. `random` has `Math.random`'s shape. */
export function pickTwo(count: number, random: () => number = Math.random): [number, number] {
  const first = Math.floor(random() * count);
  let second = Math.floor(random() * (count - 1));
  if (second >= first) second += 1;
  return first < second ? [first, second] : [second, first];
}

/** What a person typed, the way `parse_recovery_key` reads it: any case, any spacing. */
function clean(text: string): string {
  return text.replace(/[\s-]/g, "").toUpperCase();
}

export function typedBack(key: string, picked: readonly number[], typed: readonly string[]): boolean {
  const groups = groupsOf(key);
  return (
    picked.length === typed.length &&
    picked.every((index, n) => groups[index] !== undefined && clean(typed[n]) === groups[index])
  );
}
