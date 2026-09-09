import { describe, expect, it } from "vitest";

import { parseAnalysisLockReceiptBytes } from "./analysis-lock-receipt";
import type { AnalysisLockReceipt } from "./types";

const encoder = new TextEncoder();

function validReceipt(): AnalysisLockReceipt {
  return {
    schemaVersion: "0.3",
    receiptType: "analysis_lock",
    lockId: "7d5a4f1f-59d7-4c62-9821-3e2ae6a1bf33",
    createdAt: "2026-09-08T01:30:00.000Z",
    blinding: {
      transformationId: "123e4567-e89b-42d3-a456-426614174000",
      blindingReceiptSha256: "a".repeat(64),
      blindedArtifactSha256: "b".repeat(64),
    },
    analysisArtifact: {
      filename: "analysis.docx",
      sha256: "c".repeat(64),
      byteLength: 1234,
    },
  };
}

function encode(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

describe("parseAnalysisLockReceiptBytes", () => {
  it("parses and validates a canonical analysis-lock receipt", () => {
    const receipt = validReceipt();

    expect(parseAnalysisLockReceiptBytes(encode(receipt))).toEqual(
      receipt,
    );
  });

  it("rejects malformed JSON, unsupported schemas, and wrong receipt types", () => {
    expect(() =>
      parseAnalysisLockReceiptBytes(
        encoder.encode('{"schemaVersion":'),
      ),
    ).toThrow("valid JSON");

    expect(() =>
      parseAnalysisLockReceiptBytes(
        encode({
          ...validReceipt(),
          schemaVersion: "9.9",
        }),
      ),
    ).toThrow("Unsupported analysis-lock receipt schema version");

    expect(() =>
      parseAnalysisLockReceiptBytes(
        encode({
          ...validReceipt(),
          receiptType: "unblinding",
        }),
      ),
    ).toThrow("unsupported receipt type");
  });

  it("rejects unexpected nested fields and invalid hashes", () => {
    expect(() =>
      parseAnalysisLockReceiptBytes(
        encode({
          ...validReceipt(),
          blinding: {
            ...validReceipt().blinding,
            mapping: [],
          },
        }),
      ),
    ).toThrow("unexpected structure");

    expect(() =>
      parseAnalysisLockReceiptBytes(
        encode({
          ...validReceipt(),
          analysisArtifact: {
            ...validReceipt().analysisArtifact,
            sha256: "not-a-hash",
          },
        }),
      ),
    ).toThrow("Locked analysis artifact hash");
  });

  it("rejects blank analysis filenames and invalid byte lengths", () => {
    expect(() =>
      parseAnalysisLockReceiptBytes(
        encode({
          ...validReceipt(),
          analysisArtifact: {
            ...validReceipt().analysisArtifact,
            filename: "   ",
          },
        }),
      ),
    ).toThrow("filename cannot be blank");

    expect(() =>
      parseAnalysisLockReceiptBytes(
        encode({
          ...validReceipt(),
          analysisArtifact: {
            ...validReceipt().analysisArtifact,
            byteLength: 0,
          },
        }),
      ),
    ).toThrow("byte length");
  });

  it("rejects noncanonical timestamps and blank identifiers", () => {
    expect(() =>
      parseAnalysisLockReceiptBytes(
        encode({
          ...validReceipt(),
          createdAt: "2026-09-08",
        }),
      ),
    ).toThrow("canonical ISO-8601");

    expect(() =>
      parseAnalysisLockReceiptBytes(
        encode({
          ...validReceipt(),
          lockId: " ",
        }),
      ),
    ).toThrow("identifier cannot be blank");
  });
});
