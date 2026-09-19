import type { DatabaseClientReport, DesktopClient } from "@mixengine/api";

/**
 * The module a database service opens into.
 *
 * The one id this module names, and the frontend half of `open_in_mixdb.rs`'s `module_id: "db"` —
 * a bridge between two modules is by definition one naming the other.
 */
export const DATABASE_MODULE_ID = "db";

/** One *open* control on the Services screen. */
export type OpenChoice =
  /** Open a tab of the built-in client, which this window is already drawing. */
  | "builtIn"
  /** The same, and say first that it turns the client on. */
  | "builtInAfterEnabling";

/**
 * What the *open* affordance is, for one service — T110's D4.
 *
 * Drawn from `database.client`: `no_client` is a state and not an error, which the panel renders as
 * the sentence it always did rather than as a failure of something the person did.
 *
 * **Never another application** (T165): the only client the daemon names is this install's own
 * window, so every choice opens in-process. Handing the service back through `database.open` would
 * start a second MixLab to forward a URL to this one.
 */
export function openChoices(client: DesktopClient, builtInVisible: boolean): OpenChoice[] {
  if (client.state !== "installed") return [];
  return [builtInVisible ? "builtIn" : "builtInAfterEnabling"];
}

/**
 * Có phải một service mà một database client mở được không.
 *
 * **`protocol` là câu trả lời, và nó là một trạng thái chứ không phải một lỗi** — `database.client`
 * trả `null` cho nginx, caddy và mọi php-fpm pool, đúng như nó trả một protocol cho postgres. Chỗ
 * này biến trạng thái đó thành "không vẽ gì cả": panel ở màn Services và menu 3 chấm ở Dashboard
 * cùng hỏi một câu, nên câu ấy chỉ được định nghĩa một lần.
 *
 * Vắng mặt cũng là không, theo luật [ADR 0019]: `protocol` là member tuỳ chọn, và vắng nghĩa là
 * daemon này cũ hơn member đó — không phải "không xác định được".
 *
 * [ADR 0019]: https://github.com/mixnz/mixengine/blob/master/docs/decisions/0019-an-added-response-member-is-optional.md
 */
export function opensADatabase(report: Partial<Pick<DatabaseClientReport, "protocol">>): boolean {
  return report.protocol !== null && report.protocol !== undefined;
}

/**
 * Có vẽ form Tạo database cho service này không — roadmap task T155.
 *
 * **Câu trả lời là của daemon**: `creates_databases: false` cho Redis và MongoDB, những server không
 * tạo database kiểu này, nên form ở đó chỉ có thể bị từ chối. Vắng mặt nghĩa là daemon cũ hơn member
 * đó ([ADR 0019]) — giữ form như trước.
 *
 * [ADR 0019]: https://github.com/mixnz/mixengine/blob/master/docs/decisions/0019-an-added-response-member-is-optional.md
 */
export function createsDatabases(
  report: Partial<Pick<DatabaseClientReport, "creates_databases">>,
): boolean {
  return report.creates_databases !== false;
}
