import { describe, expect, it } from "vitest";

import {
  BLINDING_SCHEMA_VERSION,
  type BlindingReceipt,
  type UnblindingSecret,
} from "./types";

describe("blinding core types", () => {
  it("uses schema 0.3 for encrypted mapping release", () => {
    expect(BLINDING_SCHEMA_VERSION).toBe("0.3");

    const receipt: BlindingReceipt = {
      schemaVersion: "0.3",
      transformationId: "t1",
      createdAt: "2026-09-08T23:00:00.000Z",
      transformationType:
        "categorical_label_permutation",
      selectedColumn: "treatment",
      categoryCount: 2,
      rowCount: 4,
      columnCount: 2,
      sourceArtifact: {
        sha256: "a".repeat(64),
      },
      blindedArtifact: {
        sha256: "b".repeat(64),
      },
      sealedMapping: {
        algorithm: "AES-GCM",
        keyLength: 256,
        tagLength: 128,
        encoding: "hex",
        aadScheme:
          "blindstats_blinding_mapping_aad_v1",
        ivHex: "01".repeat(12),
        ciphertextHex: "02".repeat(48),
      },
      algorithm: {
        neutralLabelScheme: "Group_<letters>",
        mappingAssignment:
          "web_crypto_random_permutation",
      },
    };

    const secret: UnblindingSecret = {
      schemaVersion: "0.3",
      secretType: "unblinding_secret",
      transformationId: "t1",
      keyAlgorithm: "AES-GCM",
      keyLength: 256,
      encoding: "hex",
      keyHex: "03".repeat(32),
    };

    expect(receipt).not.toHaveProperty("mapping");
    expect(secret).not.toHaveProperty("mapping");
  });
});
