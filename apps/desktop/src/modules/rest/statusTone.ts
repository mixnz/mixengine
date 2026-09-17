import type { StatusTone } from "../../components/StatusPill";

/**
 * The pill tone a response's status code is drawn in — its class, which is all the colour is about:
 * 2xx went through, 3xx sent somewhere else, 4xx was the request's fault and 5xx the server's.
 * Anything under 200 is informational and takes no colour.
 */
export function statusTone(status: number): StatusTone {
  if (status >= 500) return "danger";
  if (status >= 400) return "warning";
  if (status >= 300) return "neutral";
  if (status >= 200) return "success";
  return "neutral";
}
