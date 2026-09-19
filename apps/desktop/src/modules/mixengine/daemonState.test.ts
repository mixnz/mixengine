import { describe, expect, it } from "vitest";

import {
  applyEvent,
  applyJob,
  movesARow,
  needsResync,
  rowsFrom,
  type JobRow,
  stoppedByReason,
  type ServiceRow,
} from "./daemonState";

const rows: ServiceRow[] = [
  { id: "mariadb@main", state: "running", port: 3306, autostart: true, stoppedBy: null },
  { id: "caddy@main", state: "stopped", port: null, autostart: false, stoppedBy: null },
];

describe("rowsFrom", () => {
  /* Cột `autostart` là **cài đặt**, không phải trạng thái: nó tới từ `service.list` và không có sự
     kiện nào đổi nó. Test này là chỗ giữ nó không bị bỏ quên khi ai đó thêm field vào `ServiceRow`. */
  it("carries a service's autostart setting onto its row", () => {
    const made = rowsFrom([
      {
        id: "redis@main",
        state: "stopped",
        supervised: false,
        pid: null,
        last_started_at: null,
        last_exit_code: null,
        depends_on: [],
        autostart: true,
      },
    ]);

    expect(made).toEqual([{ id: "redis@main", state: "stopped", port: null, autostart: true, stoppedBy: null }]);
  });
});

describe("applyEvent", () => {
  /* Trạng thái được thông báo, không bao giờ được suy ra: hàng đổi vì stream nói, không vì ai bấm. */
  it("moves a row when the stream says the service changed", () => {
    const raw = JSON.stringify({ type: "service_state_changed", service: "caddy@main", to: "starting" });
    const next = applyEvent(rows, raw);
    expect(next.rows.find((r) => r.id === "caddy@main")?.state).toBe("starting");
    expect(next.rows.find((r) => r.id === "mariadb@main")?.state).toBe("running");
    expect(next.resync).toBe(false);
  });

  /* `resync` nghĩa là bus 1024 message bên kia đã tràn. Con số `missed` chỉ để ghi log — cách xử
     lý giống nhau dù lỡ một hay một nghìn. */
  it("asks for a resync when the bus overflowed", () => {
    expect(applyEvent(rows, JSON.stringify({ type: "resync", missed: 900 })).resync).toBe(true);
  });

  it("asks for a resync when the connection dropped", () => {
    expect(applyEvent(rows, JSON.stringify({ type: "mixdb_disconnected" })).resync).toBe(true);
  });

  /* Một biến thể sinh ra ở phiên bản sau phải tới đây như một object bỏ qua được — không ném, và
     không làm mất hàng nào. Đó là toàn bộ lý do sự kiện được internally tagged. */
  it("ignores an event type it has never heard of", () => {
    const next = applyEvent(rows, JSON.stringify({ type: "quantum_flux", whatever: 1 }));
    expect(next.rows).toEqual(rows);
    expect(next.resync).toBe(false);
  });

  it("ignores something that is not even JSON", () => {
    expect(applyEvent(rows, "<html>").rows).toEqual(rows);
  });

  /* Một service chưa có trong bảng: không dựng hàng giả, đợi `service.list` nói nó là gì. */
  it("does not invent a row for a service it does not know", () => {
    const raw = JSON.stringify({ type: "service_state_changed", service: "redis@main", to: "running" });
    expect(applyEvent(rows, raw).rows).toHaveLength(2);
  });

  /* Một `service_state_changed` thiếu nửa nào cũng không được đụng vào bảng. */
  it("ignores a state change that names no service or no state", () => {
    expect(applyEvent(rows, JSON.stringify({ type: "service_state_changed", to: "running" })).rows)
      .toEqual(rows);
    expect(
      applyEvent(rows, JSON.stringify({ type: "service_state_changed", service: "caddy@main" }))
        .rows,
    ).toEqual(rows);
  });

  /* Ghim đúng cái lỗi đã mắc: `id` là tên trong bản phác kiến trúc của MixEngine, `service` là tên
     daemon thật sự gửi. Đọc nhầm thì bảng đứng im và không gì báo. */
  it("does not answer to the field name the architecture note used", () => {
    const raw = JSON.stringify({ type: "service_state_changed", id: "caddy@main", to: "running" });
    expect(applyEvent(rows, raw).rows).toEqual(rows);
  });
});

describe("applyJob", () => {
  const running: JobRow[] = [{ id: 7, kind: "elevation", percent: 20, message: "asking" }];

  it("adds a job the first time it reports", () => {
    const raw = JSON.stringify({
      type: "job_progress",
      job: 9,
      kind: "install",
      percent: 5,
      message: "downloading",
    });
    const next = applyJob([], raw);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ id: 9, percent: 5, message: "downloading" });
  });

  /* Tiến độ là thứ duy nhất trên stream được phép lặp lại — nó cập nhật hàng cũ, không đẻ hàng mới. */
  it("updates a job it already has instead of adding a second row", () => {
    const raw = JSON.stringify({ type: "job_progress", job: 7, percent: 80, message: "granted" });
    const next = applyJob(running, raw);
    expect(next).toHaveLength(1);
    expect(next[0].percent).toBe(80);
  });

  /* `kind` chỉ có ở message đầu; một message sau không được xoá nó. */
  it("keeps the kind a later message does not repeat", () => {
    const raw = JSON.stringify({ type: "job_progress", job: 7, percent: 80 });
    expect(applyJob(running, raw)[0].kind).toBe("elevation");
  });

  it("takes a finished job off the list", () => {
    expect(applyJob(running, JSON.stringify({ type: "job_finished", job: 7 }))).toHaveLength(0);
  });

  it("leaves the list alone for anything else", () => {
    expect(applyJob(running, JSON.stringify({ type: "resync", missed: 2 }))).toEqual(running);
    expect(applyJob(running, "not json")).toEqual(running);
    expect(applyJob(running, JSON.stringify({ type: "job_progress" }))).toEqual(running);
  });
});

describe("needsResync", () => {
  /* Cùng câu trả lời với `applyEvent`, nhưng gọi được ngoài updater của `setState` — React chạy
     updater hai lần trong StrictMode, nên một `reload()` đặt trong đó bắn hai lần mỗi sự kiện. */
  it("says yes to exactly what applyEvent says yes to", () => {
    for (const raw of [
      JSON.stringify({ type: "resync", missed: 1 }),
      JSON.stringify({ type: "mixdb_disconnected" }),
    ]) {
      expect(needsResync(raw)).toBe(true);
      expect(applyEvent(rows, raw).resync).toBe(true);
    }
    for (const raw of [
      JSON.stringify({ type: "service_state_changed", service: "caddy@main", to: "running" }),
      JSON.stringify({ type: "quantum_flux" }),
      "not json",
    ]) {
      expect(needsResync(raw)).toBe(false);
      expect(applyEvent(rows, raw).resync).toBe(false);
    }
  });
});

describe("movesARow", () => {
  /* Chỉ `service_state_changed` mới đổi bảng service. Câu hỏi này tồn tại để `Dashboard` biết một
     message có đua với một `service.list` đang bay hay không — hỏi **ngoài** updater của
     `setRows`, vì updater chạy hai lần trong StrictMode. */
  it("says yes to a service state change", () => {
    const raw = JSON.stringify({ type: "service_state_changed", service: "caddy@main", to: "stopped" });
    expect(movesARow(raw)).toBe(true);
  });

  /* Tiến độ job bắn liên tục suốt một lần cài runtime. Coi nó là một lý do đọc lại là biến một
     job dài thành một tràng `service.list` không ai cần. */
  it("says no to job progress", () => {
    expect(movesARow(JSON.stringify({ type: "job_progress", job: 4, percent: 10 }))).toBe(false);
  });

  it("says no to something it cannot parse", () => {
    expect(movesARow("not json")).toBe(false);
  });
});

/* T167g: who stopped a service rides on the transition's reason, by the same rule MixEngine's
   `StoppedBy::of` uses — so the Dashboard can draw an idle stop as resting without a second read. */
describe("stoppedBy from a transition", () => {
  const stop = (reason: unknown) =>
    applyEvent(
      rows,
      JSON.stringify({ type: "service_state_changed", service: "mariadb@main", to: "stopped", reason }),
    ).rows.find((row) => row.id === "mariadb@main")?.stoppedBy;

  it("is the daemon for an idle stop and a person for a requested one", () => {
    expect(stop({ kind: "idle", after: 60000 })).toBe("daemon");
    expect(stop({ kind: "requested" })).toBe("person");
    expect(stop({ kind: "credential_reset" })).toBe("person");
  });

  it("is unknown when the reason cannot be read, and cleared by a start", () => {
    expect(stop(undefined)).toBeNull();
    expect(stoppedByReason({ kind: 3 })).toBeNull();

    const started = applyEvent(
      [{ id: "caddy@main", state: "stopped", port: null, autostart: false, stoppedBy: "daemon" }],
      JSON.stringify({ type: "service_state_changed", service: "caddy@main", to: "starting", reason: { kind: "requested" } }),
    ).rows[0];
    expect(started.stoppedBy).toBeNull();
  });
});
