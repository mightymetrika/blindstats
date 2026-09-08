import { parseAnalysisLockReceiptBytes } from "./analysis-lock-receipt";
import { parseBlindingKeyBytes } from "./blinding-key";
import { parseBlindingReceiptBytes } from "./blinding-receipt";
import { parseCsvBytes, serializeCsvDataset } from "./csv";
import { sha256Hex } from "./hashing";
import { createUnblindingIdentity } from "./identity";
import { getDistinctNonmissingCategories } from "./mapping";
import { applyBlindingMapping } from "./transform";
import {
  BLINDING_SCHEMA_VERSION,
  type DatasetRow,
  type UnblindingReceipt,
} from "./types";

const UTF8_ENCODER = new TextEncoder();

export type SerializedUnblindingReceipt = {
  text: string;
  bytes: Uint8Array;
};

export type UnblindingPackage = {
  unblinded: {
    columns: string[];
    rows: DatasetRow[];
    bytes: Uint8Array;
    sha256: string;
  };
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
  actual: string | number,
  expected: string | number,
  message: string,
): void {
  if (actual !== expected) {
    throw new Error(message);
  }
}

function requireSourceMappingAgreement(
  sourceCategories: readonly string[],
  mappingOriginals: readonly string[],
): void {
  if (sourceCategories.length !== mappingOriginals.length) {
    throw new Error(
      "Private blinding key mapping does not match the source dataset categories.",
    );
  }

  const mappingOriginalSet = new Set(mappingOriginals);

  if (
    sourceCategories.some(
      (category) => !mappingOriginalSet.has(category),
    )
  ) {
    throw new Error(
      "Private blinding key mapping does not match the source dataset categories.",
    );
  }
}

export async function createUnblindingPackage(
  sourceBytes: Uint8Array,
  blindingReceiptBytes: Uint8Array,
  blindingKeyBytes: Uint8Array,
  analysisLockReceiptBytes: Uint8Array,
  lockedAnalysisArtifactBytes: Uint8Array,
  createdAt: Date = new Date(),
): Promise<UnblindingPackage> {
  if (lockedAnalysisArtifactBytes.length === 0) {
    throw new Error("Locked analysis artifact file cannot be empty.");
  }

  const blindingReceipt =
    parseBlindingReceiptBytes(blindingReceiptBytes);
  const blindingKey = parseBlindingKeyBytes(blindingKeyBytes);
  const analysisLockReceipt =
    parseAnalysisLockReceiptBytes(analysisLockReceiptBytes);

  requireEqual(
    blindingKey.transformationId,
    blindingReceipt.transformationId,
    "Private blinding key transformation identifier does not match the public blinding receipt.",
  );
  requireEqual(
    blindingKey.createdAt,
    blindingReceipt.createdAt,
    "Private blinding key creation time does not match the public blinding receipt.",
  );
  requireEqual(
    blindingKey.selectedColumn,
    blindingReceipt.selectedColumn,
    "Private blinding key selected column does not match the public blinding receipt.",
  );
  requireEqual(
    blindingKey.sourceArtifactSha256,
    blindingReceipt.sourceArtifact.sha256,
    "Private blinding key source artifact hash does not match the public blinding receipt.",
  );
  requireEqual(
    blindingKey.blindedArtifactSha256,
    blindingReceipt.blindedArtifact.sha256,
    "Private blinding key blinded artifact hash does not match the public blinding receipt.",
  );
  requireEqual(
    blindingKey.mapping.length,
    blindingReceipt.categoryCount,
    "Private blinding key mapping size does not match the public blinding receipt category count.",
  );

  requireEqual(
    analysisLockReceipt.blinding.transformationId,
    blindingReceipt.transformationId,
    "Analysis-lock receipt transformation identifier does not match the public blinding receipt.",
  );
  requireEqual(
    analysisLockReceipt.blinding.blindedArtifactSha256,
    blindingReceipt.blindedArtifact.sha256,
    "Analysis-lock receipt blinded artifact hash does not match the public blinding receipt.",
  );

  const [
    sourceSha256,
    blindingReceiptSha256,
    blindingKeySha256,
    analysisLockReceiptSha256,
    analysisArtifactSha256,
  ] = await Promise.all([
    sha256Hex(sourceBytes),
    sha256Hex(blindingReceiptBytes),
    sha256Hex(blindingKeyBytes),
    sha256Hex(analysisLockReceiptBytes),
    sha256Hex(lockedAnalysisArtifactBytes),
  ]);

  requireEqual(
    sourceSha256,
    blindingReceipt.sourceArtifact.sha256,
    "Source artifact hash does not match the public blinding receipt.",
  );
  requireEqual(
    sourceSha256,
    blindingKey.sourceArtifactSha256,
    "Source artifact hash does not match the private blinding key.",
  );
  requireEqual(
    blindingReceiptSha256,
    analysisLockReceipt.blinding.blindingReceiptSha256,
    "Public blinding receipt hash does not match the analysis-lock receipt.",
  );
  requireEqual(
    analysisArtifactSha256,
    analysisLockReceipt.analysisArtifact.sha256,
    "Locked analysis artifact hash does not match the analysis-lock receipt.",
  );
  requireEqual(
    lockedAnalysisArtifactBytes.length,
    analysisLockReceipt.analysisArtifact.byteLength,
    "Locked analysis artifact byte length does not match the analysis-lock receipt.",
  );

  const parsedSource = parseCsvBytes(sourceBytes);

  requireEqual(
    parsedSource.rows.length,
    blindingReceipt.rowCount,
    "Source dataset row count does not match the public blinding receipt.",
  );
  requireEqual(
    parsedSource.columns.length,
    blindingReceipt.columnCount,
    "Source dataset column count does not match the public blinding receipt.",
  );

  if (!parsedSource.columns.includes(blindingReceipt.selectedColumn)) {
    throw new Error(
      `Selected blinding column "${blindingReceipt.selectedColumn}" does not exist in the source dataset.`,
    );
  }

  const sourceCategories = getDistinctNonmissingCategories(
    parsedSource.rows.map(
      (row) => row[blindingReceipt.selectedColumn],
    ),
  );

  requireEqual(
    sourceCategories.length,
    blindingReceipt.categoryCount,
    "Source dataset category count does not match the public blinding receipt.",
  );

  requireSourceMappingAgreement(
    sourceCategories,
    blindingKey.mapping.map((entry) => entry.original),
  );

  const regeneratedBlindedRows = applyBlindingMapping(
    parsedSource.rows,
    blindingReceipt.selectedColumn,
    blindingKey.mapping,
  );
  const regeneratedBlindedArtifact = serializeCsvDataset(
    parsedSource.columns,
    regeneratedBlindedRows,
  );
  const regeneratedBlindedSha256 = await sha256Hex(
    regeneratedBlindedArtifact.bytes,
  );

  requireEqual(
    regeneratedBlindedSha256,
    blindingReceipt.blindedArtifact.sha256,
    "Private blinding key mapping does not reproduce the blinded artifact recorded in the public blinding receipt.",
  );
  requireEqual(
    regeneratedBlindedSha256,
    blindingKey.blindedArtifactSha256,
    "Private blinding key mapping does not reproduce its recorded blinded artifact hash.",
  );
  requireEqual(
    regeneratedBlindedSha256,
    analysisLockReceipt.blinding.blindedArtifactSha256,
    "Private blinding key mapping does not reproduce the blinded artifact recorded in the analysis-lock receipt.",
  );

  const identity = createUnblindingIdentity(createdAt);
  const unblindedBytes = new Uint8Array(sourceBytes);

  const receipt: UnblindingReceipt = {
    schemaVersion: BLINDING_SCHEMA_VERSION,
    receiptType: "unblinding",
    unblindingId: identity.unblindingId,
    createdAt: identity.createdAt,
    transformationId: blindingReceipt.transformationId,
    lockId: analysisLockReceipt.lockId,
    selectedColumn: blindingReceipt.selectedColumn,
    artifacts: {
      sourceArtifactSha256: sourceSha256,
      blindingReceiptSha256,
      blindedArtifactSha256: regeneratedBlindedSha256,
      blindingKeySha256,
      analysisLockReceiptSha256,
      analysisArtifact: {
        ...analysisLockReceipt.analysisArtifact,
      },
      unblindedArtifactSha256: sourceSha256,
    },
    releasedMapping: blindingKey.mapping.map((entry) => ({
      ...entry,
    })),
  };

  return {
    unblinded: {
      columns: [...parsedSource.columns],
      rows: parsedSource.rows.map((row) => ({ ...row })),
      bytes: unblindedBytes,
      sha256: sourceSha256,
    },
    receipt,
    receiptArtifact: serializeReceipt(receipt),
  };
}
