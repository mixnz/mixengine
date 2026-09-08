/** One argument a skip index's TYPE takes, in the order its CREATE syntax expects it. */
export interface SkipIndexArg {
  /** Shown as the field's label. */
  label: string;
  /** What the box holds before it is touched — also what an empty box falls back to, since
   *  `bloom_filter`'s own default really is `0.025`, not "nothing typed yet". */
  placeholder: string;
}

/** One TYPE a data skipping index can be declared with. Whitelisted the same way column types are
 *  (`clickhouse/editing.ts`'s `TYPES`): a fixed, verified list rather than free text, so the dialog
 *  can show the right argument boxes for whichever one is chosen. */
export interface SkipIndexType {
  name: string;
  args: SkipIndexArg[];
}

/**
 * The five data skipping index types ClickHouse offers, and the arguments each one takes — verified
 * against `clickhouse-test-server` (26.8.2.7). `tokenbf_v1` takes three arguments, not four like
 * `ngrambf_v1` — the two read alike, and sending four to `tokenbf_v1` is rejected outright
 * (`tokenbf index must have exactly 3 arguments`).
 */
export const SKIP_INDEX_TYPES: SkipIndexType[] = [
  { name: "minmax", args: [] },
  { name: "set", args: [{ label: "max rows (0 = unlimited)", placeholder: "0" }] },
  { name: "bloom_filter", args: [{ label: "false positive rate", placeholder: "0.025" }] },
  {
    name: "ngrambf_v1",
    args: [
      { label: "n", placeholder: "3" },
      { label: "size of bloom filter (bytes)", placeholder: "256" },
      { label: "number of hash functions", placeholder: "2" },
      { label: "random seed", placeholder: "0" },
    ],
  },
  {
    name: "tokenbf_v1",
    args: [
      { label: "size of bloom filter (bytes)", placeholder: "256" },
      { label: "number of hash functions", placeholder: "2" },
      { label: "random seed", placeholder: "0" },
    ],
  },
];

export function skipIndexType(name: string): SkipIndexType | undefined {
  return SKIP_INDEX_TYPES.find((type) => type.name === name);
}

/** What a fresh "Add" dialog puts in each argument box before anything is typed. */
export function defaultArgs(type: SkipIndexType): string[] {
  return type.args.map((arg) => arg.placeholder);
}
