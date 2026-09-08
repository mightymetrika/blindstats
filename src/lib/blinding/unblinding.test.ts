import { describe, expect, it } from "vitest";

import { createAnalysisLockPackage } from "./analysis-lock";
import { createBlindedPackage } from "./blinding-package";
import { sha256Hex } from "./hashing";
import { createUnblindingPackage } from "./unblinding";
import type {
  AnalysisLockReceipt,
  BlindingKey,
} from "./types";

const encoder = new TextEncoder();

const SOURCE_TEXT =
  'id,treatment,note\r\n' +
  '1,Treatment,"Alpha, beta"\r\n' +
  "2,Control,Plain\r\n" +
  "3,Treatment,\r\n";

const ANALYSIS_TEXT =
  "Methods and results drafted under blinded labels.\n";

const BLINDING_TIME = new Date("2026-09-08T01:00:00.000Z");
const LOCK_TIME = new Date("2026-09-08T01:30:00.000Z");
const UNBLINDING_TIME = new Date("2026-09-08T02:00:00.000Z");

function encodeJson(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

async function fixture() {
  const sourceBytes = encoder.encode(SOURCE_TEXT);
  const analysisBytes = encoder.encode(ANALYSIS_TEXT);

  const blindedPackage = await createBlindedPackage(
    sourceBytes,
    "treatment",
    BLINDING_TIME,
  );

  const lockPackage = await createAnalysisLockPackage(
    blindedPackage.receiptArtifact.bytes,
    blindedPackage.blinded.bytes,
    {
      filename: "analysis.docx",
      bytes: analysisBytes,
    },
    LOCK_TIME,
  );

  return {
    sourceBytes,
    analysisBytes,
    blindedPackage,
    lockPackage,
  };
}

describe("createUnblindingPackage", () => {
  it("verifies the full chain and releases the exact original source bytes", async () => {
    const {
      sourceBytes,
      analysisBytes,
      blindedPackage,
      lockPackage,
    } = await fixture();

    const result = await createUnblindingPackage(
      sourceBytes,
      blindedPackage.receiptArtifact.bytes,
      blindedPackage.keyArtifact.bytes,
      lockPackage.receiptArtifact.bytes,
      analysisBytes,
      UNBLINDING_TIME,
    );

    expect(result.unblinded.bytes).toEqual(sourceBytes);
    expect(new TextDecoder().decode(result.unblinded.bytes)).toBe(
      SOURCE_TEXT,
    );
    expect(result.unblinded.sha256).toBe(
      await sha256Hex(sourceBytes),
    );
    expect(result.receipt.receiptType).toBe("unblinding");
    expect(result.receipt.unblindingId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(result.receipt.createdAt).toBe(
      UNBLINDING_TIME.toISOString(),
    );
    expect(result.receipt.transformationId).toBe(
      blindedPackage.receipt.transformationId,
    );
    expect(result.receipt.lockId).toBe(lockPackage.receipt.lockId);
    expect(result.receipt.selectedColumn).toBe("treatment");
    expect(result.receipt.releasedMapping).toEqual(
      blindedPackage.key.mapping,
    );
    expect(
      result.receipt.artifacts.unblindedArtifactSha256,
    ).toBe(result.receipt.artifacts.sourceArtifactSha256);
    expect(
      result.receipt.artifacts.blindedArtifactSha256,
    ).toBe(blindedPackage.blinded.sha256);
    expect(result.receipt.artifacts.analysisArtifact).toEqual(
      lockPackage.receipt.analysisArtifact,
    );
  });

  it("records hashes of the exact supplied workflow artifacts and serializes deterministically", async () => {
    const {
      sourceBytes,
      analysisBytes,
      blindedPackage,
      lockPackage,
    } = await fixture();

    const result = await createUnblindingPackage(
      sourceBytes,
      blindedPackage.receiptArtifact.bytes,
      blindedPackage.keyArtifact.bytes,
      lockPackage.receiptArtifact.bytes,
      analysisBytes,
      UNBLINDING_TIME,
    );

    expect(result.receipt.artifacts.blindingReceiptSha256).toBe(
      await sha256Hex(blindedPackage.receiptArtifact.bytes),
    );
    expect(result.receipt.artifacts.blindingKeySha256).toBe(
      await sha256Hex(blindedPackage.keyArtifact.bytes),
    );
    expect(
      result.receipt.artifacts.analysisLockReceiptSha256,
    ).toBe(await sha256Hex(lockPackage.receiptArtifact.bytes));
    expect(result.receipt.artifacts.analysisArtifact.sha256).toBe(
      await sha256Hex(analysisBytes),
    );

    const expectedText =
      `${JSON.stringify(result.receipt, null, 2)}\n`;

    expect(result.receiptArtifact.text).toBe(expectedText);
    expect(
      new TextDecoder().decode(result.receiptArtifact.bytes),
    ).toBe(expectedText);
  });

  it("rejects a source artifact that does not match the public receipt", async () => {
    const {
      analysisBytes,
      blindedPackage,
      lockPackage,
    } = await fixture();

    await expect(
      createUnblindingPackage(
        encoder.encode(`${SOURCE_TEXT}4,Control,Extra\r\n`),
        blindedPackage.receiptArtifact.bytes,
        blindedPackage.keyArtifact.bytes,
        lockPackage.receiptArtifact.bytes,
        analysisBytes,
        UNBLINDING_TIME,
      ),
    ).rejects.toThrow(
      "Source artifact hash does not match the public blinding receipt.",
    );
  });

  it("rejects a public receipt whose exact bytes do not match the analysis lock", async () => {
    const {
      sourceBytes,
      analysisBytes,
      blindedPackage,
      lockPackage,
    } = await fixture();

    const changedReceipt = {
      ...blindedPackage.receipt,
      createdAt: "2026-09-08T01:00:01.000Z",
    };
    const changedKey: BlindingKey = {
      ...blindedPackage.key,
      createdAt: changedReceipt.createdAt,
    };

    await expect(
      createUnblindingPackage(
        sourceBytes,
        encodeJson(changedReceipt),
        encodeJson(changedKey),
        lockPackage.receiptArtifact.bytes,
        analysisBytes,
        UNBLINDING_TIME,
      ),
    ).rejects.toThrow(
      "Public blinding receipt hash does not match the analysis-lock receipt.",
    );
  });

  it("rejects analysis bytes that do not match the locked analysis artifact", async () => {
    const {
      sourceBytes,
      blindedPackage,
      lockPackage,
    } = await fixture();

    await expect(
      createUnblindingPackage(
        sourceBytes,
        blindedPackage.receiptArtifact.bytes,
        blindedPackage.keyArtifact.bytes,
        lockPackage.receiptArtifact.bytes,
        encoder.encode(`${ANALYSIS_TEXT}Revision.\n`),
        UNBLINDING_TIME,
      ),
    ).rejects.toThrow(
      "Locked analysis artifact hash does not match the analysis-lock receipt.",
    );
  });

  it("rejects private-key metadata that does not match the public receipt", async () => {
    const {
      sourceBytes,
      analysisBytes,
      blindedPackage,
      lockPackage,
    } = await fixture();

    const changedKey: BlindingKey = {
      ...blindedPackage.key,
      selectedColumn: "note",
    };

    await expect(
      createUnblindingPackage(
        sourceBytes,
        blindedPackage.receiptArtifact.bytes,
        encodeJson(changedKey),
        lockPackage.receiptArtifact.bytes,
        analysisBytes,
        UNBLINDING_TIME,
      ),
    ).rejects.toThrow(
      "Private blinding key selected column does not match the public blinding receipt.",
    );
  });

  it("rejects a tampered mapping even when the key metadata and artifact hashes were left unchanged", async () => {
    const {
      sourceBytes,
      analysisBytes,
      blindedPackage,
      lockPackage,
    } = await fixture();

    const [first, second] = blindedPackage.key.mapping;
    const changedKey: BlindingKey = {
      ...blindedPackage.key,
      mapping: [
        {
          original: first.original,
          blinded: second.blinded,
        },
        {
          original: second.original,
          blinded: first.blinded,
        },
      ],
    };

    await expect(
      createUnblindingPackage(
        sourceBytes,
        blindedPackage.receiptArtifact.bytes,
        encodeJson(changedKey),
        lockPackage.receiptArtifact.bytes,
        analysisBytes,
        UNBLINDING_TIME,
      ),
    ).rejects.toThrow(
      "Private blinding key mapping does not reproduce the blinded artifact recorded in the public blinding receipt.",
    );
  });

  it("rejects an analysis-lock receipt that points to a different transformation or blinded artifact", async () => {
    const {
      sourceBytes,
      analysisBytes,
      blindedPackage,
      lockPackage,
    } = await fixture();

    const changedLock: AnalysisLockReceipt = {
      ...lockPackage.receipt,
      blinding: {
        ...lockPackage.receipt.blinding,
        transformationId:
          "999e4567-e89b-42d3-a456-426614174999",
      },
    };

    await expect(
      createUnblindingPackage(
        sourceBytes,
        blindedPackage.receiptArtifact.bytes,
        blindedPackage.keyArtifact.bytes,
        encodeJson(changedLock),
        analysisBytes,
        UNBLINDING_TIME,
      ),
    ).rejects.toThrow(
      "Analysis-lock receipt transformation identifier does not match the public blinding receipt.",
    );
  });
});
