// The one shape every failure takes (D4a), and the handful of answers that are not a record.

export interface ErrorMembers {
  [member: string]: unknown;
}

export function fail(
  status: number,
  code: string,
  message: string,
  members: ErrorMembers = {},
  headers: Record<string, string> = {},
): Response {
  return json(status, { error: { code, message, ...members } }, headers);
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

export const notFound = (): Response => fail(404, "not-found", "No such route.");

export const methodNotAllowed = (): Response =>
  fail(405, "method-not-allowed", "That route does not answer this method.");

export const invalidRequest = (message: string): Response => fail(400, "invalid-request", message);

/**
 * The refusal a misconfigured deployment gives to everything, including `/v1/capabilities`:
 * answering that one while unable to send a letter would tell a client the server is ready.
 */
export function misconfigured(missing: string[]): Response {
  return fail(
    503,
    "server-misconfigured",
    `This server is missing configuration and will not serve until it has it: ${missing.join(", ")}.`,
    { missing },
  );
}
