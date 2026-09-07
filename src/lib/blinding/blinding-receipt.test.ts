import { describe, expect, it } from "vitest";

import { parseBlindingReceiptBytes } from "./blinding-receipt";
import type { BlindingReceipt } from "./types";

const encoder = new TextEncoder();

function validReceipt(): BlindingReceipt {
  return {
    schemaVersion: "0.1",
    transformationId: "123e4567-e89b-42d3-a456-426614174000",
    createdAt: "2026-09-07T21:00:00.000Z",
    transformationType: "categorical_label_permutation",
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
    algorithm: {
      neutralLabelScheme: "Group_<letters>",
      mappingAssignment: "web_crypto_random_permutation",
    },
  };
}

function encodeReceipt(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

describe("parseBlindingReceiptBytes", () => {
  it("parses and validates a canonical public blinding receipt", () => {
    const receipt = validReceipt();

    expect(parseBlindingReceiptBytes(encodeReceipt(receipt))).toEqual(
      receipt,
    );
  });

  it("rejects malformed JSON and unsupported schema versions", () => {
    expect(() =>
      parseBlindingReceiptBytes(
        encoder.encode('{"schemaVersion":'),
      ),
    ).toThrow("valid JSON");

    expect(() =>
      parseBlindingReceiptBytes(
        encodeReceipt({
          ...validReceipt(),
          schemaVersion: "9.9",
        }),
      ),
    ).toThrow("Unsupported blinding receipt schema version");
  });

  it("rejects unexpected top-level fields such as an exposed mapping", () => {
    expect(() =>
      parseBlindingReceiptBytes(
        encodeReceipt({
          ...validReceipt(),
          mapping: [
            {
              original: "Treatment",
              blinded: "Group_A",
            },
          ],
        }),
      ),
    ).toThrow("unexpected structure");
  });

  it("rejects invalid artifact hashes and invalid category counts", () => {
    expect(() =>
      parseBlindingReceiptBytes(
        encodeReceipt({
          ...validReceipt(),
          blindedArtifact: {
            sha256: "not-a-sha256",
          },
        }),
      ),
    ).toThrow("Blinded artifact hash");

    expect(() =>
      parseBlindingReceiptBytes(
        encodeReceipt({
          ...validReceipt(),
          categoryCount: 1,
        }),
      ),
    ).toThrow("Category count");
  });

  it("rejects noncanonical creation timestamps", () => {
    expect(() =>
      parseBlindingReceiptBytes(
        encodeReceipt({
          ...validReceipt(),
          createdAt: "2026-09-07",
        }),
      ),
    ).toThrow("canonical ISO-8601");
  });
});
