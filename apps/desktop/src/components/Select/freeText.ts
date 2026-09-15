/**
 * What a free-text `Select` should offer to commit for what has been typed, or `null` for
 * nothing.
 *
 * The one rule worth stating: a value is offered whenever no option is spelled *exactly* that way,
 * not whenever no option matches it. The two differ for the case this exists to serve — a runtime
 * pin like `8.3` means "whatever 8.3.x is installed", which is a different thing from the `8.3.12`
 * sitting in the list above it, and an option list that swallowed it would make the constraint
 * unreachable from the form.
 */
export function typedValue(query: string, options: readonly string[]): string | null {
  const wanted = query.trim();
  if (wanted === "") return null;

  return options.includes(wanted) ? null : wanted;
}
