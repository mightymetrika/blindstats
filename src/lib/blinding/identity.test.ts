import { describe, expect, it } from "vitest";

import { createTransformationIdentity } from "./identity";

describe("createTransformationIdentity", () => {
  it("creates a Web-Crypto UUID and ISO-8601 timestamp", () => {
    const identity = createTransformationIdentity(
      new Date("2026-09-01T23:45:00.000Z"),
    );

    expect(identity.transformationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(identity.createdAt).toBe("2026-09-01T23:45:00.000Z");
  });

  it("creates a fresh transformation identifier for each operation", () => {
    const first = createTransformationIdentity(
      new Date("2026-09-01T23:45:00.000Z"),
    );
    const second = createTransformationIdentity(
      new Date("2026-09-01T23:45:00.000Z"),
    );

    expect(first.transformationId).not.toBe(second.transformationId);
  });

  it("does not use the timestamp itself as the transformation identifier", () => {
    const identity = createTransformationIdentity(
      new Date("2026-09-01T23:45:00.000Z"),
    );

    expect(identity.transformationId).not.toBe(identity.createdAt);
  });

  it("rejects an invalid timestamp", () => {
    expect(() => createTransformationIdentity(new Date("invalid"))).toThrow(
      RangeError,
    );
  });
});
