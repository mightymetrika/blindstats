import { describe, expect, it } from "vitest";

import { summarizeStudiesReadFailure } from "./studies-read-diagnostics";

const timestamp = "2026-10-12T23:00:00.000Z";

describe("safe Studies read diagnostics", () => {
  it("captures the known JWT timing rejection without logging its raw details", () => {
    const diagnostic = summarizeStudiesReadFailure(
      "studies",
      {
        code: "PGRST303",
        message: "JWT issued at future: token=secret-jwt-value",
      },
      401,
      timestamp,
    );

    expect(diagnostic).toEqual({
      event: "studies_read_failure",
      occurredAtUtc: timestamp,
      operation: "studies",
      httpStatus: 401,
      errorCode: "PGRST303",
      errorCategory: "jwt_issued_at_future",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("secret-jwt-value");
    expect(JSON.stringify(diagnostic)).not.toContain("JWT issued at future:");
  });

  it("never includes raw error details or sensitive fields", () => {
    const fullError = {
      code: "PGRST116",
      message: "private email and token",
      details: "secret cookie",
      hint: "private information",
    };
    const diagnostic = summarizeStudiesReadFailure(
      "profile",
      fullError,
      406,
      timestamp,
    );

    expect(diagnostic.operation).toBe("profile");
    expect(diagnostic.errorCategory).toBe("other");
    expect(JSON.stringify(diagnostic)).not.toMatch(/private|cookie|token/);
  });

  it("rejects malformed codes and non-HTTP status values", () => {
    const diagnostic = summarizeStudiesReadFailure(
      "studies",
      { code: "bad\nsecret", message: "unexpected failure" },
      0,
      timestamp,
    );

    expect(diagnostic.errorCode).toBeNull();
    expect(diagnostic.httpStatus).toBeNull();
    expect(diagnostic.errorCategory).toBe("other");
  });
});
