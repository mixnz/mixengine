import type { CertIssueReport } from "./api/types/CertIssueReport";
import type { IssueOutcome } from "./api/types/IssueOutcome";

export interface CertRow {
  domain: string;
  outcome: IssueOutcome;
  sans: string[];
  daysLeft: number | null;
}

/**
 * `cert.issue` gọi không `site` vừa vẽ bảng vừa cấp lại — đúng cách roadmap chọn cho T2.7. Chỉ
 * `state.state === "present"` mới có `cert` để đọc `sans`/`days_left`; `absent`/`unusable` không có
 * gì để đọc, không phải một lỗi.
 */
export function buildCertRows(report: CertIssueReport): CertRow[] {
  return report.sites.map(({ domain, outcome, state }) => ({
    domain,
    outcome,
    sans: state.state === "present" ? state.cert.sans : [],
    daysLeft: state.state === "present" ? state.cert.days_left : null,
  }));
}
