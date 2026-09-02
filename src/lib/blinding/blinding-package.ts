import { createBlindingAuditArtifacts } from "./audit-artifacts";
import { parseCsvBytes, serializeCsvDataset } from "./csv";
import { sha256Hex } from "./hashing";
import { createTransformationIdentity } from "./identity";
import { createBlindingMapping } from "./mapping";
import { applyBlindingMapping } from "./transform";
import type {
  BlindingKey,
  BlindingReceipt,
  DatasetRow,
} from "./types";

const UTF8_ENCODER = new TextEncoder();

export type SerializedJsonArtifact = {
  text: string;
  bytes: Uint8Array;
};

export type BlindedPackage = {
  source: {
    columns: string[];
    rowCount: number;
    columnCount: number;
    sha256: string;
  };
  blinded: {
    columns: string[];
    rows: DatasetRow[];
    text: string;
    bytes: Uint8Array;
    sha256: string;
  };
  receipt: BlindingReceipt;
  key: BlindingKey;
  receiptArtifact: SerializedJsonArtifact;
  keyArtifact: SerializedJsonArtifact;
};

function serializeJsonArtifact(value: unknown): SerializedJsonArtifact {
  const text = `${JSON.stringify(value, null, 2)}\n`;

  return {
    text,
    bytes: UTF8_ENCODER.encode(text),
  };
}

export async function createBlindedPackage(
  sourceBytes: Uint8Array,
  selectedColumn: string,
  createdAt: Date = new Date(),
): Promise<BlindedPackage> {
  const parsed = parseCsvBytes(sourceBytes);

  if (!parsed.columns.includes(selectedColumn)) {
    throw new Error(
      `Selected blinding column "${selectedColumn}" does not exist in the source dataset.`,
    );
  }

  const selectedValues = parsed.rows.map((row) => row[selectedColumn]);
  const mapping = createBlindingMapping(selectedValues);
  const blindedRows = applyBlindingMapping(
    parsed.rows,
    selectedColumn,
    mapping,
  );
  const serializedBlinded = serializeCsvDataset(
    parsed.columns,
    blindedRows,
  );

  const [sourceSha256, blindedSha256] = await Promise.all([
    sha256Hex(sourceBytes),
    sha256Hex(serializedBlinded.bytes),
  ]);

  const identity = createTransformationIdentity(createdAt);
  const { receipt, key } = createBlindingAuditArtifacts({
    identity,
    selectedColumn,
    mapping,
    rowCount: parsed.rows.length,
    columnCount: parsed.columns.length,
    sourceArtifactSha256: sourceSha256,
    blindedArtifactSha256: blindedSha256,
  });

  return {
    source: {
      columns: [...parsed.columns],
      rowCount: parsed.rows.length,
      columnCount: parsed.columns.length,
      sha256: sourceSha256,
    },
    blinded: {
      columns: [...parsed.columns],
      rows: blindedRows,
      text: serializedBlinded.text,
      bytes: serializedBlinded.bytes,
      sha256: blindedSha256,
    },
    receipt,
    key,
    receiptArtifact: serializeJsonArtifact(receipt),
    keyArtifact: serializeJsonArtifact(key),
  };
}
