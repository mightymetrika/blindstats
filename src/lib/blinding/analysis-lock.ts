import { parseBlindingReceiptBytes } from "./blinding-receipt";
import { sha256Hex } from "./hashing";
import { createAnalysisLockIdentity } from "./identity";
import {
  BLINDING_SCHEMA_VERSION,
  type AnalysisLockReceipt,
} from "./types";

const UTF8_ENCODER = new TextEncoder();

export type AnalysisArtifactInput = {
  filename: string;
  bytes: Uint8Array;
};

export type SerializedAnalysisLockReceipt = {
  text: string;
  bytes: Uint8Array;
};

export type AnalysisLockPackage = {
  receipt: AnalysisLockReceipt;
  receiptArtifact: SerializedAnalysisLockReceipt;
};

function serializeReceipt(
  receipt: AnalysisLockReceipt,
): SerializedAnalysisLockReceipt {
  const text = `${JSON.stringify(receipt, null, 2)}\n`;

  return {
    text,
    bytes: UTF8_ENCODER.encode(text),
  };
}

export async function createAnalysisLockPackage(
  blindingReceiptBytes: Uint8Array,
  analysisArtifact: AnalysisArtifactInput,
  createdAt: Date = new Date(),
): Promise<AnalysisLockPackage> {
  if (analysisArtifact.filename.trim().length === 0) {
    throw new Error("Analysis artifact filename cannot be blank.");
  }

  if (analysisArtifact.bytes.length === 0) {
    throw new Error("Analysis artifact file cannot be empty.");
  }

  const blindingReceipt =
    parseBlindingReceiptBytes(blindingReceiptBytes);

  const [blindingReceiptSha256, analysisArtifactSha256] =
    await Promise.all([
      sha256Hex(blindingReceiptBytes),
      sha256Hex(analysisArtifact.bytes),
    ]);

  const identity = createAnalysisLockIdentity(createdAt);

  const receipt: AnalysisLockReceipt = {
    schemaVersion: BLINDING_SCHEMA_VERSION,
    receiptType: "analysis_lock",
    lockId: identity.lockId,
    createdAt: identity.createdAt,
    blinding: {
      transformationId: blindingReceipt.transformationId,
      blindingReceiptSha256,
      blindedArtifactSha256:
        blindingReceipt.blindedArtifact.sha256,
    },
    analysisArtifact: {
      filename: analysisArtifact.filename,
      sha256: analysisArtifactSha256,
      byteLength: analysisArtifact.bytes.length,
    },
  };

  return {
    receipt,
    receiptArtifact: serializeReceipt(receipt),
  };
}
