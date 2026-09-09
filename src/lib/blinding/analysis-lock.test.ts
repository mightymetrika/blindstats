import { describe, expect, it } from "vitest";

import { createAnalysisLockPackage } from "./analysis-lock";
import { sha256Hex } from "./hashing";
import type { BlindingReceipt } from "./types";

const encoder = new TextEncoder();
const createdAt = new Date("2026-09-08T22:30:00.000Z");

const analysisText =
  "Methods drafted under blinded labels.\n" +
  "Primary contrast: Group_A vs Group_B.\n";

function fixture(): {
  blindingReceiptBytes: Uint8Array;
  analysisArtifactBytes: Uint8Array;
  blindedArtifactSha256: string;
} {
  const blindedArtifactSha256 = "b".repeat(64);

  const receipt: BlindingReceipt = {
    schemaVersion: "0.3",
    transformationId: "123e4567-e89b-42d3-a456-426614174000",
    createdAt: "2026-09-08T21:00:00.000Z",
    transformationType: "categorical_label_permutation",
    selectedColumn: "treatment",
    categoryCount: 2,
    rowCount: 2,
    columnCount: 3,
    sourceArtifact: {
      sha256: "a".repeat(64),
    },
    blindedArtifact: {
      sha256: blindedArtifactSha256,
    },
    sealedMapping: {
      algorithm: "AES-GCM",
      keyLength: 256,
      tagLength: 128,
      encoding: "hex",
      aadScheme: "blindstats_blinding_mapping_aad_v1",
      ivHex: "01".repeat(12),
      ciphertextHex: "02".repeat(48),
    },
    algorithm: {
      neutralLabelScheme: "Group_<letters>",
      mappingAssignment: "web_crypto_random_permutation",
    },
  };

  return {
    blindingReceiptBytes: encoder.encode(
      `${JSON.stringify(receipt, null, 2)}\n`,
    ),
    analysisArtifactBytes: encoder.encode(analysisText),
    blindedArtifactSha256,
  };
}

describe("createAnalysisLockPackage", () => {
  it("links exact analysis bytes to the exact public receipt without requiring the blinded dataset again", async () => {
    const {
      blindingReceiptBytes,
      analysisArtifactBytes,
      blindedArtifactSha256,
    } = fixture();

    const result = await createAnalysisLockPackage(
      blindingReceiptBytes,
      {
        filename: "blinded-analysis-draft.docx",
        bytes: analysisArtifactBytes,
      },
      createdAt,
    );

    expect(result.receipt.receiptType).toBe("analysis_lock");
    expect(result.receipt.lockId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(result.receipt.createdAt).toBe(
      createdAt.toISOString(),
    );
    expect(result.receipt.blinding.transformationId).toBe(
      "123e4567-e89b-42d3-a456-426614174000",
    );
    expect(
      result.receipt.blinding.blindingReceiptSha256,
    ).toBe(await sha256Hex(blindingReceiptBytes));
    expect(
      result.receipt.blinding.blindedArtifactSha256,
    ).toBe(blindedArtifactSha256);
    expect(result.receipt.analysisArtifact).toEqual({
      filename: "blinded-analysis-draft.docx",
      sha256: await sha256Hex(analysisArtifactBytes),
      byteLength: analysisArtifactBytes.length,
    });
  });

  it("serializes the receipt once into the exact downloadable receipt bytes", async () => {
    const {
      blindingReceiptBytes,
      analysisArtifactBytes,
    } = fixture();

    const result = await createAnalysisLockPackage(
      blindingReceiptBytes,
      {
        filename: "analysis.zip",
        bytes: analysisArtifactBytes,
      },
      createdAt,
    );

    const expectedText =
      `${JSON.stringify(result.receipt, null, 2)}\n`;

    expect(result.receiptArtifact.text).toBe(expectedText);
    expect(
      new TextDecoder().decode(result.receiptArtifact.bytes),
    ).toBe(expectedText);
  });

  it("rejects blank filenames and empty analysis artifacts", async () => {
    const {
      blindingReceiptBytes,
      analysisArtifactBytes,
    } = fixture();

    await expect(
      createAnalysisLockPackage(
        blindingReceiptBytes,
        {
          filename: "   ",
          bytes: analysisArtifactBytes,
        },
        createdAt,
      ),
    ).rejects.toThrow("filename cannot be blank");

    await expect(
      createAnalysisLockPackage(
        blindingReceiptBytes,
        {
          filename: "analysis.docx",
          bytes: new Uint8Array(),
        },
        createdAt,
      ),
    ).rejects.toThrow("Analysis artifact file cannot be empty");
  });

  it("changes the locked analysis hash when the analysis bytes change", async () => {
    const {
      blindingReceiptBytes,
      analysisArtifactBytes,
    } = fixture();

    const first = await createAnalysisLockPackage(
      blindingReceiptBytes,
      {
        filename: "analysis.docx",
        bytes: analysisArtifactBytes,
      },
      createdAt,
    );

    const second = await createAnalysisLockPackage(
      blindingReceiptBytes,
      {
        filename: "analysis.docx",
        bytes: encoder.encode(`${analysisText}Revision.\n`),
      },
      createdAt,
    );

    expect(first.receipt.analysisArtifact.sha256).not.toBe(
      second.receipt.analysisArtifact.sha256,
    );
  });
});
