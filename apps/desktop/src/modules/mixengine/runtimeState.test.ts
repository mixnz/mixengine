import { describe, expect, it } from "vitest";

import { formatInstalledAt, jobFinished, jobFor, poolBanner, versionKey } from "./runtimeState";
import type { JobRow } from "./daemonState";

describe("versionKey", () => {
  it("joins kind and version with @", () => {
    expect(versionKey("php", "8.3.12")).toBe("php@8.3.12");
  });
});

describe("poolBanner", () => {
  it("maps reloaded to no banner", () => {
    expect(poolBanner("reloaded")).toBe("none");
  });
  it("maps restart_required to a restart banner", () => {
    expect(poolBanner("restart_required")).toBe("restartRequired");
  });
  it("maps pool_not_running to an apply-next-start message, not an error", () => {
    expect(poolBanner("pool_not_running")).toBe("appliesNextStart");
  });
});

describe("formatInstalledAt", () => {
  it("turns an epoch-millisecond Timestamp into the machine's own date/time, not a raw number", () => {
    const ms = Date.UTC(2026, 0, 15, 12, 0, 0);
    const formatted = formatInstalledAt(ms);
    expect(formatted).not.toBe(String(ms));
    expect(formatted).toBe(new Date(ms).toLocaleString());
  });
});

describe("jobFor", () => {
  const jobs: JobRow[] = [{ id: 1, kind: "runtime.install", percent: 40, message: "downloading" }];

  it("finds the job tracked for a version", () => {
    expect(jobFor(jobs, 1)).toEqual(jobs[0]);
  });

  it("returns undefined when nothing is tracked yet", () => {
    expect(jobFor(jobs, undefined)).toBeUndefined();
  });

  it("returns undefined once the job has finished and left the list", () => {
    expect(jobFor(jobs, 2)).toBeUndefined();
  });
});

describe("jobFinished", () => {
  it("reads the job id off a job_finished message", () => {
    expect(jobFinished(JSON.stringify({ type: "job_finished", job: 7, ending: "succeeded" }))?.id).toBe(
      7,
    );
  });

  it("carries no error for a job that succeeded", () => {
    const finished = jobFinished(
      JSON.stringify({ type: "job_finished", job: 7, ending: "succeeded", result: null }),
    );
    expect(finished?.error).toBeNull();
  });

  // Một job hỏng là toàn bộ lý do hàm này đọc `ending`: đây là chỗ duy nhất câu của daemon tới
  // được người dùng, và bản trước bỏ nó đi — thanh tiến độ biến mất, danh sách không đổi, không
  // một chữ nào giải thích.
  it("turns a failed job into the same refusal a rejected call would have carried", () => {
    const finished = jobFinished(
      JSON.stringify({
        type: "job_finished",
        job: 7,
        ending: "failed",
        error: {
          code: "precondition_failed",
          message: "archive contains ./, which is not inside it",
          hint: "nothing was unpacked",
        },
      }),
    );
    expect(finished?.error).toEqual({
      code: "error.mixengineRefused",
      params: {
        code: "precondition_failed",
        message: "archive contains ./, which is not inside it",
        hint: "nothing was unpacked",
      },
    });
  });

  it("leaves out the hint a failure did not carry, rather than sending an empty one", () => {
    const finished = jobFinished(
      JSON.stringify({
        type: "job_finished",
        job: 7,
        ending: "failed",
        error: { code: "io", message: "disk full" },
      }),
    );
    expect(finished?.error?.params).not.toHaveProperty("hint");
  });

  // Người dùng tự huỷ thì không có gì để báo — banner đỏ cho một việc họ vừa yêu cầu là nhiễu.
  it("carries no error for a cancelled job", () => {
    expect(
      jobFinished(JSON.stringify({ type: "job_finished", job: 7, ending: "cancelled" }))?.error,
    ).toBeNull();
  });

  it("returns null for a job_progress message", () => {
    expect(jobFinished(JSON.stringify({ type: "job_progress", job: 7, percent: 40 }))).toBeNull();
  });

  it("returns null for an unrelated message", () => {
    expect(jobFinished(JSON.stringify({ type: "service_state_changed" }))).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(jobFinished("not json")).toBeNull();
  });
});
