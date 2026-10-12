/** Safe, structured diagnostics for failed Studies-area PostgREST reads.
 *
 * Never log the JWT, cookies, full PostgREST error object, raw error message,
 * user identifiers, or Study records. These fields can be compared with
 * Supabase project logs if an intermittent JWT rejection recurs.
 */
export type StudiesReadOperation = "profile" | "studies";

type ReadError = {
  code?: string | null;
  message?: string | null;
};

export function summarizeStudiesReadFailure(
  operation: StudiesReadOperation,
  error: ReadError,
  httpStatus: number,
  occurredAtUtc: string = new Date().toISOString(),
) {
  // Keep arbitrary server-provided error codes out of logs unless well-formed.
  const errorCode =
    typeof error.code === "string" &&
    /^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(error.code)
      ? error.code
      : null;

  const safeStatus =
    Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599
      ? httpStatus
      : null;

  const errorCategory =
    typeof error.message === "string" &&
    /jwt issued at future/i.test(error.message)
      ? "jwt_issued_at_future"
      : "other";

  return {
    event: "studies_read_failure",
    occurredAtUtc,
    operation,
    httpStatus: safeStatus,
    errorCode,
    errorCategory,
  };
}
