import { describe, expect, it } from "vitest";

import { createAnalysisLockPackage } from "./analysis-lock";
import { createBlindedPackage } from "./blinding-package";
import { sha256Hex } from "./hashing";
import { createUnblindingPackage } from "./unblinding";
import type {
  AnalysisLockReceipt,
  UnblindingSecret,
} from "./types";

const encoder = new TextEncoder();

const SOURCE_TEXT =
  "id,treatment,note\n" +
  "1,Treatment,Alpha\n" +
  "2,Control,Beta\n" +
  "3,Treatment,Gamma\n";

const ANALYSIS_TEXT =
  "Methods and results drafted under blinded labels.\n";

const BLINDING_TIME = new Date(
  "2026-09-08T23:00:00.000Z",
);
const LOCK_TIME = new Date(
  "2026-09-08T23:30:00.000Z",
);
const UNBLINDING_TIME = new Date(
  "2026-09-09T00:00:00.000Z",
);

function encodeJson(value: unknown): Uint8Array {
  return encoder.encode(
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

async function fixture() {
  const analysisBytes =
    encoder.encode(ANALYSIS_TEXT);

  const blindedPackage =
    await createBlindedPackage(
      encoder.encode(SOURCE_TEXT),
      "treatment",
      BLINDING_TIME,
    );

  const lockPackage =
    await createAnalysisLockPackage(
      blindedPackage.receiptArtifact.bytes,
      {
        filename: "analysis.docx",
        bytes: analysisBytes,
      },
      LOCK_TIME,
    );

  return {
    analysisBytes,
    blindedPackage,
    lockPackage,
  };
}

describe("createUnblindingPackage", () => {
  it("verifies the locked workflow and releases the mapping only in the final receipt", async () => {
    const {
      blindedPackage,
      lockPackage,
    } = await fixture();

    const result =
      await createUnblindingPackage(
        blindedPackage.receiptArtifact.bytes,
        blindedPackage.secretArtifact.bytes,
        lockPackage.receiptArtifact.bytes,
        UNBLINDING_TIME,
      );

    expect(result.receipt.receiptType).toBe(
      "unblinding",
    );
    expect(result.receipt.transformationId).toBe(
      blindedPackage.receipt.transformationId,
    );
    expect(result.receipt.lockId).toBe(
      lockPackage.receipt.lockId,
    );
    expect(result.receipt.selectedColumn).toBe(
      "treatment",
    );
    expect(result.receipt.releasedMapping).toHaveLength(
      2,
    );

    const receiptText =
      result.receiptArtifact.text;

    expect(receiptText).toContain("Treatment");
    expect(receiptText).toContain("Control");
  });

  it("records hashes of the exact three supplied JSON artifacts", async () => {
    const {
      blindedPackage,
      lockPackage,
    } = await fixture();

    const result =
      await createUnblindingPackage(
        blindedPackage.receiptArtifact.bytes,
        blindedPackage.secretArtifact.bytes,
        lockPackage.receiptArtifact.bytes,
        UNBLINDING_TIME,
      );

    expect(
      result.receipt.artifacts
        .blindingReceiptSha256,
    ).toBe(
      await sha256Hex(
        blindedPackage.receiptArtifact.bytes,
      ),
    );
    expect(
      result.receipt.artifacts
        .unblindingSecretSha256,
    ).toBe(
      await sha256Hex(
        blindedPackage.secretArtifact.bytes,
      ),
    );
    expect(
      result.receipt.artifacts
        .analysisLockReceiptSha256,
    ).toBe(
      await sha256Hex(
        lockPackage.receiptArtifact.bytes,
      ),
    );
  });

  it("rejects a public receipt whose exact bytes do not match the analysis lock", async () => {
    const {
      blindedPackage,
      lockPackage,
    } = await fixture();

    const reformattedReceiptBytes =
      encoder.encode(
        JSON.stringify(blindedPackage.receipt),
      );

    await expect(
      createUnblindingPackage(
        reformattedReceiptBytes,
        blindedPackage.secretArtifact.bytes,
        lockPackage.receiptArtifact.bytes,
        UNBLINDING_TIME,
      ),
    ).rejects.toThrow(
      "Public blinding receipt hash does not match the analysis-lock receipt.",
    );
  });

  it("rejects the wrong unblinding secret", async () => {
    const first = await fixture();
    const second = await createBlindedPackage(
      encoder.encode(SOURCE_TEXT),
      "treatment",
      BLINDING_TIME,
    );

    const wrongSecret: UnblindingSecret = {
      ...second.secret,
      transformationId:
        first.blindedPackage.receipt
          .transformationId,
    };

    await expect(
      createUnblindingPackage(
        first.blindedPackage.receiptArtifact
          .bytes,
        encodeJson(wrongSecret),
        first.lockPackage.receiptArtifact
          .bytes,
        UNBLINDING_TIME,
      ),
    ).rejects.toThrow(
      "could not authenticate and decrypt",
    );
  });

  it("rejects an analysis-lock receipt from a different transformation", async () => {
    const {
      blindedPackage,
      lockPackage,
    } = await fixture();

    const changedLock:
      AnalysisLockReceipt = {
        ...lockPackage.receipt,
        blinding: {
          ...lockPackage.receipt.blinding,
          transformationId:
            "999e4567-e89b-42d3-a456-426614174999",
        },
      };

    await expect(
      createUnblindingPackage(
        blindedPackage.receiptArtifact.bytes,
        blindedPackage.secretArtifact.bytes,
        encodeJson(changedLock),
        UNBLINDING_TIME,
      ),
    ).rejects.toThrow(
      "Analysis-lock receipt transformation identifier does not match",
    );
  });

  it("rejects tampering with the encrypted mapping", async () => {
    const {
      blindedPackage,
      lockPackage,
    } = await fixture();

    const ciphertext =
      blindedPackage.receipt.sealedMapping
        .ciphertextHex;
    const replacement =
      ciphertext.endsWith("0") ? "1" : "0";
    const changedReceipt = {
      ...blindedPackage.receipt,
      sealedMapping: {
        ...blindedPackage.receipt.sealedMapping,
        ciphertextHex:
          `${ciphertext.slice(0, -1)}${replacement}`,
      },
    };

    const changedReceiptBytes =
      encodeJson(changedReceipt);

    const changedLock = {
      ...lockPackage.receipt,
      blinding: {
        ...lockPackage.receipt.blinding,
        blindingReceiptSha256:
          await sha256Hex(
            changedReceiptBytes,
          ),
      },
    };

    await expect(
      createUnblindingPackage(
        changedReceiptBytes,
        blindedPackage.secretArtifact.bytes,
        encodeJson(changedLock),
        UNBLINDING_TIME,
      ),
    ).rejects.toThrow(
      "could not authenticate and decrypt",
    );
  });
});
