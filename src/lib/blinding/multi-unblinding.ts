import {
  parseJsonArtifactBytes,
  requireCanonicalTimestamp,
  requireExactKeys,
  requireNonblankString,
  requirePositiveInteger,
  requireRecord,
  requireSha256,
} from "./artifact-validation";
import { sha256Hex } from "./hashing";
import { createAnalysisLockIdentity, createUnblindingIdentity } from "./identity";
import {
  openMultiBlindingMapping,
  parseMultiBlindingReceiptBytes,
  parseMultiUnblindingSecretBytes,
} from "./multi-blinding";
import {
  MULTI_BLINDING_SCHEMA_VERSION,
  type MultiAnalysisLockReceipt,
  type MultiUnblindingReceipt,
} from "./multi-types";

const ENCODER = new TextEncoder();

function serialize(value: unknown) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  return { text, bytes: ENCODER.encode(text) };
}

export function parseMultiAnalysisLockReceiptBytes(bytes: Uint8Array): MultiAnalysisLockReceipt {
  const value = parseJsonArtifactBytes(bytes, "Multi-variable analysis-lock receipt");
  requireExactKeys(value, ["schemaVersion", "receiptType", "lockId", "createdAt", "blinding", "analysisArtifact"], "Multi-variable analysis-lock receipt");
  if (value.schemaVersion !== MULTI_BLINDING_SCHEMA_VERSION || value.receiptType !== "analysis_lock") {
    throw new Error("Unsupported multi-variable analysis-lock receipt.");
  }
  const blinding = requireRecord(value.blinding, "Analysis-lock blinding reference");
  const artifact = requireRecord(value.analysisArtifact, "Locked analysis artifact");
  requireExactKeys(blinding, ["transformationId", "blindingReceiptSha256", "blindedArtifactSha256"], "Analysis-lock blinding reference");
  requireExactKeys(artifact, ["filename", "sha256", "byteLength"], "Locked analysis artifact");
  return {
    schemaVersion: MULTI_BLINDING_SCHEMA_VERSION,
    receiptType: "analysis_lock",
    lockId: requireNonblankString(value, "lockId", "Lock identifier"),
    createdAt: requireCanonicalTimestamp(value.createdAt, "Analysis-lock creation time"),
    blinding: {
      transformationId: requireNonblankString(blinding, "transformationId", "Blinding transformation identifier"),
      blindingReceiptSha256: requireSha256(blinding.blindingReceiptSha256, "Blinding receipt hash"),
      blindedArtifactSha256: requireSha256(blinding.blindedArtifactSha256, "Blinded dataset hash"),
    },
    analysisArtifact: {
      filename: requireNonblankString(artifact, "filename", "Analysis filename"),
      sha256: requireSha256(artifact.sha256, "Analysis artifact hash"),
      byteLength: requirePositiveInteger(artifact.byteLength, "Analysis artifact length"),
    },
  };
}

export async function createMultiAnalysisLockPackage(
  blindingReceiptBytes: Uint8Array,
  analysisArtifact: { filename: string; bytes: Uint8Array },
  createdAt: Date = new Date(),
) {
  const receipt = parseMultiBlindingReceiptBytes(blindingReceiptBytes);
  if (!analysisArtifact.filename.trim() || analysisArtifact.bytes.length === 0) {
    throw new Error("Analysis artifact filename and nonempty bytes are required.");
  }
  const [blindingReceiptSha256, artifactHash] = await Promise.all([
    sha256Hex(blindingReceiptBytes), sha256Hex(analysisArtifact.bytes),
  ]);
  const identity = createAnalysisLockIdentity(createdAt);
  const lock: MultiAnalysisLockReceipt = {
    schemaVersion: MULTI_BLINDING_SCHEMA_VERSION,
    receiptType: "analysis_lock",
    lockId: identity.lockId,
    createdAt: identity.createdAt,
    blinding: {
      transformationId: receipt.transformationId,
      blindingReceiptSha256,
      blindedArtifactSha256: receipt.blindedArtifact.sha256,
    },
    analysisArtifact: {
      filename: analysisArtifact.filename,
      sha256: artifactHash,
      byteLength: analysisArtifact.bytes.length,
    },
  };
  return { receipt: lock, receiptArtifact: serialize(lock) };
}

export async function createMultiUnblindingPackage(
  blindingReceiptBytes: Uint8Array,
  unblindingSecretBytes: Uint8Array,
  analysisLockReceiptBytes: Uint8Array | null,
  createdAt: Date = new Date(),
) {
  const receipt = parseMultiBlindingReceiptBytes(blindingReceiptBytes);
  const secret = parseMultiUnblindingSecretBytes(unblindingSecretBytes);
  const lock = analysisLockReceiptBytes === null ? null :
    parseMultiAnalysisLockReceiptBytes(analysisLockReceiptBytes);
  if (secret.transformationId !== receipt.transformationId) {
    throw new Error("Unblinding secret transformation identifier does not match the receipt.");
  }
  const [blindingReceiptSha256, unblindingSecretSha256] = await Promise.all([
    sha256Hex(blindingReceiptBytes), sha256Hex(unblindingSecretBytes),
  ]);
  if (lock && (lock.blinding.transformationId !== receipt.transformationId ||
      lock.blinding.blindingReceiptSha256 !== blindingReceiptSha256 ||
      lock.blinding.blindedArtifactSha256 !== receipt.blindedArtifact.sha256)) {
    throw new Error("Analysis lock does not match the exact blinding receipt and blinded artifact.");
  }
  const mappings = await openMultiBlindingMapping(receipt, secret);
  const identity = createUnblindingIdentity(createdAt);
  const unblinding: MultiUnblindingReceipt = {
    schemaVersion: MULTI_BLINDING_SCHEMA_VERSION,
    receiptType: "unblinding",
    unblindingId: identity.unblindingId,
    createdAt: identity.createdAt,
    transformationId: receipt.transformationId,
    lockId: lock?.lockId ?? null,
    selectedColumns: receipt.selectedColumns.map((item) => ({ ...item })),
    artifacts: {
      sourceArtifactSha256: receipt.sourceArtifact.sha256,
      blindingReceiptSha256,
      blindedArtifactSha256: receipt.blindedArtifact.sha256,
      unblindingSecretSha256,
      analysisLockReceiptSha256: analysisLockReceiptBytes === null ? null :
        await sha256Hex(analysisLockReceiptBytes),
      analysisArtifact: lock ? { ...lock.analysisArtifact } : null,
    },
    releasedMappings: mappings,
  };
  return { receipt: unblinding, receiptArtifact: serialize(unblinding) };
}
