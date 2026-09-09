import { parseAnalysisLockReceiptBytes } from "./analysis-lock-receipt";
import { parseBlindingReceiptBytes } from "./blinding-receipt";
import { sha256Hex } from "./hashing";
import { createUnblindingIdentity } from "./identity";
import { openBlindingMapping } from "./mapping-crypto";
import { parseUnblindingSecretBytes } from "./unblinding-secret";
import {
  BLINDING_SCHEMA_VERSION,
  type UnblindingReceipt,
} from "./types";

const UTF8_ENCODER = new TextEncoder();

export type SerializedUnblindingReceipt = {
  text: string;
  bytes: Uint8Array;
};

export type UnblindingPackage = {
  receipt: UnblindingReceipt;
  receiptArtifact: SerializedUnblindingReceipt;
};

function serializeReceipt(
  receipt: UnblindingReceipt,
): SerializedUnblindingReceipt {
  const text = `${JSON.stringify(receipt, null, 2)}\n`;

  return {
    text,
    bytes: UTF8_ENCODER.encode(text),
  };
}

function requireEqual(
  actual: string,
  expected: string,
  message: string,
): void {
  if (actual !== expected) {
    throw new Error(message);
  }
}

export async function createUnblindingPackage(
  blindingReceiptBytes: Uint8Array,
  unblindingSecretBytes: Uint8Array,
  analysisLockReceiptBytes: Uint8Array,
  createdAt: Date = new Date(),
): Promise<UnblindingPackage> {
  const blindingReceipt =
    parseBlindingReceiptBytes(
      blindingReceiptBytes,
    );
  const unblindingSecret =
    parseUnblindingSecretBytes(
      unblindingSecretBytes,
    );
  const analysisLockReceipt =
    parseAnalysisLockReceiptBytes(
      analysisLockReceiptBytes,
    );

  requireEqual(
    unblindingSecret.transformationId,
    blindingReceipt.transformationId,
    "Unblinding secret transformation identifier does not match the public blinding receipt.",
  );

  requireEqual(
    analysisLockReceipt.blinding
      .transformationId,
    blindingReceipt.transformationId,
    "Analysis-lock receipt transformation identifier does not match the public blinding receipt.",
  );

  requireEqual(
    analysisLockReceipt.blinding
      .blindedArtifactSha256,
    blindingReceipt.blindedArtifact.sha256,
    "Analysis-lock receipt blinded artifact hash does not match the public blinding receipt.",
  );

  const [
    blindingReceiptSha256,
    unblindingSecretSha256,
    analysisLockReceiptSha256,
  ] = await Promise.all([
    sha256Hex(blindingReceiptBytes),
    sha256Hex(unblindingSecretBytes),
    sha256Hex(analysisLockReceiptBytes),
  ]);

  requireEqual(
    blindingReceiptSha256,
    analysisLockReceipt.blinding
      .blindingReceiptSha256,
    "Public blinding receipt hash does not match the analysis-lock receipt.",
  );

  const releasedMapping =
    await openBlindingMapping(
      blindingReceipt,
      unblindingSecret,
    );

  const identity =
    createUnblindingIdentity(createdAt);

  const receipt: UnblindingReceipt = {
    schemaVersion: BLINDING_SCHEMA_VERSION,
    receiptType: "unblinding",
    unblindingId: identity.unblindingId,
    createdAt: identity.createdAt,
    transformationId:
      blindingReceipt.transformationId,
    lockId: analysisLockReceipt.lockId,
    selectedColumn:
      blindingReceipt.selectedColumn,
    artifacts: {
      sourceArtifactSha256:
        blindingReceipt.sourceArtifact.sha256,
      blindingReceiptSha256,
      blindedArtifactSha256:
        blindingReceipt.blindedArtifact.sha256,
      unblindingSecretSha256,
      analysisLockReceiptSha256,
      analysisArtifact: {
        ...analysisLockReceipt.analysisArtifact,
      },
    },
    releasedMapping: releasedMapping.map(
      (entry) => ({ ...entry }),
    ),
  };

  return {
    receipt,
    receiptArtifact:
      serializeReceipt(receipt),
  };
}
