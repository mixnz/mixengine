import { stripAnsi } from "../../core/ansi";

export type LogEntry =
  | { kind: "line"; stream: "stdout" | "stderr"; at: string; text: string }
  | { kind: "historic"; text: string }
  | { kind: "gap"; missed: number };

/**
 * Một khung SSE từ `/logs/service/{id}` áp lên danh sách đang có.
 *
 * Ba biến thể, không hơn — một `type` lạ (một biến thể thêm ở phiên bản sau) bị bỏ qua chứ không ném,
 * cùng luật `daemonState.applyEvent` đã theo cho `/events`.
 */
export function applyLogFrame(entries: LogEntry[], raw: string, maxEntries: number): LogEntry[] {
  let frame: { type?: unknown; stream?: unknown; at?: unknown; text?: unknown; missed?: unknown };
  try {
    frame = JSON.parse(raw) as typeof frame;
  } catch {
    return entries;
  }

  /* Màu của terminal bị bóc ngay ở đây — một lần cho mỗi dòng, chỗ duy nhất cả hai khung log
     (`Logs`, `ApplyDialog`) cùng đi qua — chứ không phải mỗi lần render mỗi dòng đang hiện. Daemon
     giữ nguyên bản gốc là đúng; xem `core/ansi.ts`. */
  let next: LogEntry | null = null;
  if (frame.type === "line" && typeof frame.text === "string") {
    const stream = frame.stream === "stderr" ? "stderr" : "stdout";
    const at = typeof frame.at === "string" ? frame.at : "";
    next = { kind: "line", stream, at, text: stripAnsi(frame.text) };
  } else if (frame.type === "historic" && typeof frame.text === "string") {
    next = { kind: "historic", text: stripAnsi(frame.text) };
  } else if (frame.type === "gap" && typeof frame.missed === "number") {
    next = { kind: "gap", missed: frame.missed };
  }

  if (next === null) return entries;
  const combined = [...entries, next];
  return combined.length > maxEntries ? combined.slice(combined.length - maxEntries) : combined;
}

export type StreamFilter = "all" | "stdout" | "stderr";

/** How many printed lines each filter would leave. A gap is a marker, not a line, and counts nowhere. */
export interface StreamCounts {
  all: number;
  stdout: number;
  stderr: number;
  /** Lines read back from `current.log`: in `all`, and in neither stream, because none is known. */
  historic: number;
}

export function countStreams(entries: readonly LogEntry[]): StreamCounts {
  const counts: StreamCounts = { all: 0, stdout: 0, stderr: 0, historic: 0 };
  for (const entry of entries) {
    if (entry.kind === "gap") continue;
    counts.all += 1;
    if (entry.kind === "historic") counts.historic += 1;
    else counts[entry.stream] += 1;
  }
  return counts;
}

/**
 * The entries a stream filter leaves on screen.
 *
 * A historic line is not known to be on either stream, so a stream filter hides it rather than
 * claiming it — showing it under both is what made the filter look like it did nothing. A gap stays:
 * it says where lines were lost, whichever stream they were on.
 */
export function filterByStream(entries: readonly LogEntry[], filter: StreamFilter): LogEntry[] {
  if (filter === "all") return [...entries];
  return entries.filter((entry) => entry.kind === "gap" || (entry.kind === "line" && entry.stream === filter));
}
