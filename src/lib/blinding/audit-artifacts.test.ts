import { describe, expect, it } from "vitest";

import { createBlindingAuditArtifacts } from "./audit-artifacts";
import type { TransformationIdentity } from "./identity";
import type {
  SealedMapping,
  UnblindingSecret,
} from "./types";

const sourceHash = "a".repeat(64);
const blindedHash = "b".repeat(64);

const identity: TransformationIdentity = {
  transformationId:
    "123e4567-e89b-42d3-a456-426614174000",
  createdAt: "2026-09-08T23:00:00.000Z",
};

const sealedMapping: SealedMapping = {
  algorithm: "AES-GCM",
  keyLength: 256,
  tagLength: 128,
  encoding: "hex",
  aadScheme: "blindstats_blinding_mapping_aad_v1",
  ivHex: "01".repeat(12),
  ciphertextHex: "02".repeat(48),
};

const secret: UnblindingSecret = {
  schemaVersion: "0.3",
  secretType: "unblinding_secret",
  transformationId: identity.transformationId,
  keyAlgorithm: "AES-GCM",
  keyLength: 256,
  encoding: "hex",
  keyHex: "03".repeat(32),
};

function validInput() {
  return {
    identity,
    selectedColumn: "treatment",
    categoryCount: 2,
    rowCount: 100,
    columnCount: 12,
    sourceArtifactSha256: sourceHash,
    blindedArtifactSha256: blindedHash,
    sealedMapping,
    secret,
  };
}

describe("createBlindingAuditArtifacts", () => {
  it("creates linked public receipt and unblinding-secret metadata", () => {
    const { receipt, secret: generatedSecret } =
      createBlindingAuditArtifacts(validInput());

    expect(receipt.schemaVersion).toBe("0.3");
    expect(generatedSecret.schemaVersion).toBe("0.3");
    expect(receipt.transformationId).toBe(
      identity.transformationId,
    );
    expect(generatedSecret.transformationId).toBe(
      identity.transformationId,
    );
    expect(receipt.sourceArtifact.sha256).toBe(sourceHash);
    expect(receipt.blindedArtifact.sha256).toBe(
      blindedHash,
    );
  });

  it("places encrypted mapping material only in the public receipt and decryption key material only in the secret", () => {
    const { receipt, secret: generatedSecret } =
      createBlindingAuditArtifacts(validInput());

    expect(receipt.sealedMapping).toEqual(sealedMapping);
    expect(receipt).not.toHaveProperty("keyHex");
    expect(generatedSecret.keyHex).toBe(secret.keyHex);
    expect(generatedSecret).not.toHaveProperty("mapping");
    expect(generatedSecret).not.toHaveProperty(
      "ciphertextHex",
    );
  });

  it("rejects invalid transformation linkage and counts", () => {
    expect(() =>
      createBlindingAuditArtifacts({
        ...validInput(),
        categoryCount: 1,
      }),
    ).toThrow("at least 2");

    expect(() =>
      createBlindingAuditArtifacts({
        ...validInput(),
        secret: {
          ...secret,
          transformationId: "different",
        },
      }),
    ).toThrow(
      "Unblinding secret transformation identifier",
    );
  });

  it("rejects malformed hashes and blank selected columns", () => {
    expect(() =>
      createBlindingAuditArtifacts({
        ...validInput(),
        sourceArtifactSha256: "not-a-hash",
      }),
    ).toThrow("Source artifact hash");

    expect(() =>
      createBlindingAuditArtifacts({
        ...validInput(),
        selectedColumn: " ",
      }),
    ).toThrow("cannot be blank");
  });
});
