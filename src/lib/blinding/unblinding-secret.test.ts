import { describe, expect, it } from "vitest";

import { parseUnblindingSecretBytes } from "./unblinding-secret";
import type { UnblindingSecret } from "./types";

const encoder = new TextEncoder();

function validSecret(): UnblindingSecret {
  return {
    schemaVersion: "0.3",
    secretType: "unblinding_secret",
    transformationId:
      "123e4567-e89b-42d3-a456-426614174000",
    keyAlgorithm: "AES-GCM",
    keyLength: 256,
    encoding: "hex",
    keyHex: "01".repeat(32),
  };
}

function encode(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

describe("parseUnblindingSecretBytes", () => {
  it("parses a canonical unblinding secret that contains no mapping", () => {
    const secret = validSecret();

    expect(
      parseUnblindingSecretBytes(encode(secret)),
    ).toEqual(secret);
    expect(secret).not.toHaveProperty("mapping");
  });

  it("rejects unsupported schema versions and secret types", () => {
    expect(() =>
      parseUnblindingSecretBytes(
        encode({
          ...validSecret(),
          schemaVersion: "0.2",
        }),
      ),
    ).toThrow("Unsupported unblinding secret schema version");

    expect(() =>
      parseUnblindingSecretBytes(
        encode({
          ...validSecret(),
          secretType: "something_else",
        }),
      ),
    ).toThrow("unsupported secret type");
  });

  it("rejects malformed AES keys and unexpected fields", () => {
    expect(() =>
      parseUnblindingSecretBytes(
        encode({
          ...validSecret(),
          keyHex: "not-a-key",
        }),
      ),
    ).toThrow("64-character hexadecimal");

    expect(() =>
      parseUnblindingSecretBytes(
        encode({
          ...validSecret(),
          mapping: [],
        }),
      ),
    ).toThrow("unexpected structure");
  });
});
