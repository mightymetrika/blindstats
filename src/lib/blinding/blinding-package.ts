import { createBlindingAuditArtifacts } from "./audit-artifacts";
import {
  parseCsvBytes,
  serializeCsvDataset,
} from "./csv";
import { sha256Hex } from "./hashing";
import { createTransformationIdentity } from "./identity";
import { createBlindingMapping } from "./mapping";
import { sealBlindingMapping } from "./mapping-crypto";
import { applyBlindingMapping } from "./transform";
import type {
  BlindingReceipt,
  DatasetRow,
  UnblindingSecret,
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
  secret: UnblindingSecret;
  receiptArtifact: SerializedJsonArtifact;
  secretArtifact: SerializedJsonArtifact;
};

function serializeJsonArtifact(
  value: unknown,
): SerializedJsonArtifact {
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

  const selectedValues = parsed.rows.map(
    (row) => row[selectedColumn],
  );
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

  const [sourceSha256, blindedSha256] =
    await Promise.all([
      sha256Hex(sourceBytes),
      sha256Hex(serializedBlinded.bytes),
    ]);

  const identity = createTransformationIdentity(createdAt);

  const sealed = await sealBlindingMapping({
    transformationId: identity.transformationId,
    createdAt: identity.createdAt,
    selectedColumn,
    categoryCount: mapping.length,
    rowCount: parsed.rows.length,
    columnCount: parsed.columns.length,
    sourceArtifactSha256: sourceSha256,
    blindedArtifactSha256: blindedSha256,
    mapping,
  });

  const { receipt, secret } =
    createBlindingAuditArtifacts({
      identity,
      selectedColumn,
      categoryCount: mapping.length,
      rowCount: parsed.rows.length,
      columnCount: parsed.columns.length,
      sourceArtifactSha256: sourceSha256,
      blindedArtifactSha256: blindedSha256,
      sealedMapping: sealed.sealedMapping,
      secret: sealed.secret,
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
    secret,
    receiptArtifact: serializeJsonArtifact(receipt),
    secretArtifact: serializeJsonArtifact(secret),
  };
}
