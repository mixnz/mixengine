import { describe, expect, it } from "vitest";

import { buildCertRows } from "./certTable";
import type { CertIssueReport } from "./api/types/CertIssueReport";

describe("buildCertRows", () => {
  it("reads sans and days_left from a present certificate", () => {
    const report: CertIssueReport = {
      sites: [
        {
          domain: "blog.test",
          outcome: { outcome: "reused" },
          state: {
            state: "present",
            cert: {
              subject: "blog.test",
              sans: ["blog.test", "www.blog.test"],
              issuer: "MixEngine Local CA",
              fingerprint: "abc",
              not_before: 0,
              not_after: 1,
              days_left: 42,
            },
          },
        },
      ],
    };
    expect(buildCertRows(report)).toEqual([
      {
        domain: "blog.test",
        outcome: { outcome: "reused" },
        sans: ["blog.test", "www.blog.test"],
        daysLeft: 42,
      },
    ]);
  });

  it("a site with no certificate on disk has no sans and no days left", () => {
    const report: CertIssueReport = {
      sites: [
        {
          domain: "shop.test",
          outcome: { outcome: "not_wanted", because: "no https" },
          state: { state: "absent" },
        },
      ],
    };
    expect(buildCertRows(report)).toEqual([
      {
        domain: "shop.test",
        outcome: { outcome: "not_wanted", because: "no https" },
        sans: [],
        daysLeft: null,
      },
    ]);
  });

  it("an unusable certificate also has no sans and no days left", () => {
    const report: CertIssueReport = {
      sites: [
        {
          domain: "api.test",
          outcome: { outcome: "refused", because: "key mismatch" },
          state: { state: "unusable", because: "key_and_certificate_disagree" },
        },
      ],
    };
    expect(buildCertRows(report)[0].daysLeft).toBeNull();
    expect(buildCertRows(report)[0].sans).toEqual([]);
  });
});
