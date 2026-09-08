import {
  parseJsonArtifactBytes,
  requireCanonicalTimestamp,
  requireExactKeys,
  requireNonblankString,
  requirePositiveInteger,
  requireRecord,
  requireSha256,
} from "./artifact-validation";
import {
  BLINDING_SCHEMA_VERSION,
  type AnalysisLockReceipt,
} from "./types";

export function parseAnalysisLockReceiptBytes(
  bytes: Uint8Array,
): AnalysisLockReceipt {
  const receipt = parseJsonArtifactBytes(
    bytes,
    "Analysis-lock receipt",
  );

  requireExactKeys(
    receipt,
    [
      "schemaVersion",
      "receiptType",
      "lockId",
      "createdAt",
      "blinding",
      "analysisArtifact",
    ],
    "Analysis-lock receipt",
  );

  if (receipt.schemaVersion !== BLINDING_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported analysis-lock receipt schema version "${String(receipt.schemaVersion)}".`,
    );
  }

  if (receipt.receiptType !== "analysis_lock") {
    throw new Error(
      "Analysis-lock receipt has an unsupported receipt type.",
    );
  }

  const blinding = requireRecord(
    receipt.blinding,
    "Analysis-lock blinding reference",
  );
  requireExactKeys(
    blinding,
    [
      "transformationId",
      "blindingReceiptSha256",
      "blindedArtifactSha256",
    ],
    "Analysis-lock blinding reference",
  );

  const analysisArtifact = requireRecord(
    receipt.analysisArtifact,
    "Locked analysis artifact",
  );
  requireExactKeys(
    analysisArtifact,
    ["filename", "sha256", "byteLength"],
    "Locked analysis artifact",
  );

  return {
    schemaVersion: BLINDING_SCHEMA_VERSION,
    receiptType: "analysis_lock",
    lockId: requireNonblankString(
      receipt,
      "lockId",
      "Analysis-lock identifier",
    ),
    createdAt: requireCanonicalTimestamp(
      receipt.createdAt,
      "Analysis-lock receipt creation time",
    ),
    blinding: {
      transformationId: requireNonblankString(
        blinding,
        "transformationId",
        "Analysis-lock transformation identifier",
      ),
      blindingReceiptSha256: requireSha256(
        blinding.blindingReceiptSha256,
        "Analysis-lock blinding receipt hash",
      ),
      blindedArtifactSha256: requireSha256(
        blinding.blindedArtifactSha256,
        "Analysis-lock blinded artifact hash",
      ),
    },
    analysisArtifact: {
      filename: requireNonblankString(
        analysisArtifact,
        "filename",
        "Locked analysis artifact filename",
      ),
      sha256: requireSha256(
        analysisArtifact.sha256,
        "Locked analysis artifact hash",
      ),
      byteLength: requirePositiveInteger(
        analysisArtifact.byteLength,
        "Locked analysis artifact byte length",
      ),
    },
  };
}
