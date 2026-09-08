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

  let next: LogEntry | null = null;
  if (frame.type === "line" && typeof frame.text === "string") {
    const stream = frame.stream === "stderr" ? "stderr" : "stdout";
    next = { kind: "line", stream, at: typeof frame.at === "string" ? frame.at : "", text: frame.text };
  } else if (frame.type === "historic" && typeof frame.text === "string") {
    next = { kind: "historic", text: frame.text };
  } else if (frame.type === "gap" && typeof frame.missed === "number") {
    next = { kind: "gap", missed: frame.missed };
  }

  if (next === null) return entries;
  const combined = [...entries, next];
  return combined.length > maxEntries ? combined.slice(combined.length - maxEntries) : combined;
}
