import { describe, expect, it } from "vitest";

import { parseBlindingReceiptBytes } from "./blinding-receipt";
import type { BlindingReceipt } from "./types";

const encoder = new TextEncoder();

function validReceipt(): BlindingReceipt {
  return {
    schemaVersion: "0.3",
    transformationId:
      "123e4567-e89b-42d3-a456-426614174000",
    createdAt: "2026-09-08T23:00:00.000Z",
    transformationType:
      "categorical_label_permutation",
    selectedColumn: "treatment",
    categoryCount: 2,
    rowCount: 4,
    columnCount: 3,
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
}

function encode(value: unknown): Uint8Array {
  return encoder.encode(
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

describe("parseBlindingReceiptBytes", () => {
  it("parses and validates a canonical schema-0.3 receipt", () => {
    const receipt = validReceipt();

    expect(
      parseBlindingReceiptBytes(encode(receipt)),
    ).toEqual(receipt);
  });

  it("rejects older schemas and unexpected plaintext mapping fields", () => {
    expect(() =>
      parseBlindingReceiptBytes(
        encode({
          ...validReceipt(),
          schemaVersion: "0.2",
        }),
      ),
    ).toThrow(
      "Unsupported blinding receipt schema version",
    );

    expect(() =>
      parseBlindingReceiptBytes(
        encode({
          ...validReceipt(),
          mapping: [],
        }),
      ),
    ).toThrow("unexpected structure");
  });

  it("rejects malformed sealed-mapping encryption parameters", () => {
    expect(() =>
      parseBlindingReceiptBytes(
        encode({
          ...validReceipt(),
          sealedMapping: {
            ...validReceipt().sealedMapping,
            algorithm: "something-else",
          },
        }),
      ),
    ).toThrow("sealed-mapping parameters");

    expect(() =>
      parseBlindingReceiptBytes(
        encode({
          ...validReceipt(),
          sealedMapping: {
            ...validReceipt().sealedMapping,
            ivHex: "bad",
          },
        }),
      ),
    ).toThrow("IV must be 12 bytes");
  });

  it("rejects invalid artifact hashes and category counts", () => {
    expect(() =>
      parseBlindingReceiptBytes(
        encode({
          ...validReceipt(),
          blindedArtifact: {
            sha256: "not-a-sha256",
          },
        }),
      ),
    ).toThrow("Blinded artifact hash");

    expect(() =>
      parseBlindingReceiptBytes(
        encode({
          ...validReceipt(),
          categoryCount: 1,
        }),
      ),
    ).toThrow("Category count");
  });

  it("rejects noncanonical timestamps", () => {
    expect(() =>
      parseBlindingReceiptBytes(
        encode({
          ...validReceipt(),
          createdAt: "2026-09-08",
        }),
      ),
    ).toThrow("canonical ISO-8601");
  });
});
