import { describe, expect, it } from "vitest";

import {
  BLINDING_SCHEMA_VERSION,
  type BlindingKey,
  type BlindingReceipt,
} from "./types";

describe("blinding core types", () => {
  it("supports linked public receipt and private key metadata", () => {
    const transformationId = "test-transformation-id";
    const createdAt = "2026-09-01T23:00:00.000Z";
    const sourceHash = "source-sha256";
    const blindedHash = "blinded-sha256";

    const receipt: BlindingReceipt = {
      schemaVersion: BLINDING_SCHEMA_VERSION,
      transformationId,
      createdAt,
      transformationType: "categorical_label_permutation",
      selectedColumn: "treatment",
      categoryCount: 2,
      rowCount: 4,
      columnCount: 2,
      sourceArtifact: {
        sha256: sourceHash,
      },
      blindedArtifact: {
        sha256: blindedHash,
      },
      algorithm: {
        neutralLabelScheme: "Group_<letters>",
        mappingAssignment: "web_crypto_random_permutation",
      },
    };

    const key: BlindingKey = {
      schemaVersion: BLINDING_SCHEMA_VERSION,
      transformationId,
      createdAt,
      transformationType: "categorical_label_permutation",
      selectedColumn: "treatment",
      sourceArtifactSha256: sourceHash,
      blindedArtifactSha256: blindedHash,
      mapping: [
        {
          original: "Treatment",
          blinded: "Group_B",
        },
        {
          original: "Control",
          blinded: "Group_A",
        },
      ],
    };

    expect(key.transformationId).toBe(receipt.transformationId);
    expect(key.sourceArtifactSha256).toBe(receipt.sourceArtifact.sha256);
    expect(key.blindedArtifactSha256).toBe(receipt.blindedArtifact.sha256);
    expect(receipt).not.toHaveProperty("mapping");
  });
});
