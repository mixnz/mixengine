/**
 * How often each tool has been opened, over a rolling window.
 *
 * `Record<toolId, number[]>` — each entry is the epoch-ms timestamps of every open, pruned to the
 * last `USAGE_WINDOW_MS`. Ranking on a rolling window rather than a lifetime total is the point: a
 * tool opened fifty times last year and never since should not outrank one opened three times this
 * week.
 */
export type ToolUsage = Record<string, number[]>;

/** The rolling window ranking looks at — 30 days. */
export const USAGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A usage record read from disk, kept to only what still counts.
 *
 * Not trusting a field: `tool-usage.json` is a file a person can open and edit, and entries older
 * than the window, or simply malformed, are dropped rather than crashing the read.
 */
export function sanitizeUsage(raw: unknown, now: number = Date.now()): ToolUsage {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const result: ToolUsage = {};
  for (const [id, value] of Object.entries(record)) {
    if (id === "" || !Array.isArray(value)) continue;
    const kept = value.filter(
      (entry): entry is number =>
        typeof entry === "number" && Number.isFinite(entry) && entry <= now && now - entry < USAGE_WINDOW_MS,
    );
    if (kept.length > 0) result[id] = kept;
  }
  return result;
}

/** One more open for `toolId`, on top of a record already pruned to the window. */
export function recordUse(usage: ToolUsage, toolId: string, now: number = Date.now()): ToolUsage {
  const pruned = sanitizeUsage(usage, now);
  return { ...pruned, [toolId]: [...(pruned[toolId] ?? []), now] };
}

/** Drops every recorded open of `toolId`, so it falls out of the frequent ranking until it is
 *  opened again — the tool itself is untouched, only its recent-use history. */
export function clearUse(usage: ToolUsage, toolId: string, now: number = Date.now()): ToolUsage {
  const pruned = sanitizeUsage(usage, now);
  const { [toolId]: _removed, ...rest } = pruned;
  return rest;
}

/**
 * The `limit` tools opened most within the window, most-used first.
 *
 * Ties go to whichever was opened more recently — "frequent" here means recently frequent, not a
 * lifetime count, so two tools tied on count should still order by which one is still in rotation.
 */
export function rankFrequentTools(
  usage: ToolUsage,
  limit: number,
  now: number = Date.now(),
): string[] {
  return Object.entries(sanitizeUsage(usage, now))
    .map(([id, times]) => ({ id, count: times.length, last: Math.max(...times) }))
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, limit)
    .map((entry) => entry.id);
}
