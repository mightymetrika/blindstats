import {
  BLINDING_SCHEMA_VERSION,
  type BlindingKey,
  type BlindingMappingEntry,
  type BlindingReceipt,
} from "./types";
import type { TransformationIdentity } from "./identity";

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export type CreateBlindingAuditArtifactsInput = {
  identity: TransformationIdentity;
  selectedColumn: string;
  mapping: readonly BlindingMappingEntry[];
  rowCount: number;
  columnCount: number;
  sourceArtifactSha256: string;
  blindedArtifactSha256: string;
};

export type BlindingAuditArtifacts = {
  receipt: BlindingReceipt;
  key: BlindingKey;
};

function validatePositiveInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${fieldName} must be a positive integer.`);
  }
}

function validateSha256(value: string, fieldName: string): void {
  if (!SHA256_HEX_PATTERN.test(value)) {
    throw new Error(
      `${fieldName} must be a lowercase 64-character SHA-256 hexadecimal digest.`,
    );
  }
}

function validateIdentity(identity: TransformationIdentity): void {
  if (identity.transformationId.trim().length === 0) {
    throw new Error("Transformation identifier cannot be blank.");
  }

  const parsedTimestamp = new Date(identity.createdAt);

  if (
    Number.isNaN(parsedTimestamp.getTime()) ||
    parsedTimestamp.toISOString() !== identity.createdAt
  ) {
    throw new Error(
      "Transformation creation time must be a canonical ISO-8601 timestamp.",
    );
  }
}

function copyValidatedMapping(
  mapping: readonly BlindingMappingEntry[],
): BlindingMappingEntry[] {
  if (mapping.length < 2) {
    throw new Error(
      "A blinding key requires at least two mapping entries.",
    );
  }

  const originals = new Set<string>();
  const blindedLabels = new Set<string>();

  return mapping.map((entry) => {
    if (originals.has(entry.original)) {
      throw new Error(
        "Blinding mapping contains duplicate original categories.",
      );
    }

    if (blindedLabels.has(entry.blinded)) {
      throw new Error(
        "Blinding mapping contains duplicate blinded labels.",
      );
    }

    originals.add(entry.original);
    blindedLabels.add(entry.blinded);

    return {
      original: entry.original,
      blinded: entry.blinded,
    };
  });
}

export function createBlindingAuditArtifacts(
  input: CreateBlindingAuditArtifactsInput,
): BlindingAuditArtifacts {
  validateIdentity(input.identity);

  if (input.selectedColumn.trim().length === 0) {
    throw new Error("Selected blinding column cannot be blank.");
  }

  validatePositiveInteger(input.rowCount, "Row count");
  validatePositiveInteger(input.columnCount, "Column count");
  validateSha256(input.sourceArtifactSha256, "Source artifact hash");
  validateSha256(input.blindedArtifactSha256, "Blinded artifact hash");

  const mapping = copyValidatedMapping(input.mapping);

  const receipt: BlindingReceipt = {
    schemaVersion: BLINDING_SCHEMA_VERSION,
    transformationId: input.identity.transformationId,
    createdAt: input.identity.createdAt,
    transformationType: "categorical_label_permutation",
    selectedColumn: input.selectedColumn,
    categoryCount: mapping.length,
    rowCount: input.rowCount,
    columnCount: input.columnCount,
    sourceArtifact: {
      sha256: input.sourceArtifactSha256,
    },
    blindedArtifact: {
      sha256: input.blindedArtifactSha256,
    },
    algorithm: {
      neutralLabelScheme: "Group_<letters>",
      mappingAssignment: "web_crypto_random_permutation",
    },
  };

  const key: BlindingKey = {
    schemaVersion: BLINDING_SCHEMA_VERSION,
    transformationId: input.identity.transformationId,
    createdAt: input.identity.createdAt,
    transformationType: "categorical_label_permutation",
    selectedColumn: input.selectedColumn,
    sourceArtifactSha256: input.sourceArtifactSha256,
    blindedArtifactSha256: input.blindedArtifactSha256,
    mapping,
  };

  return {
    receipt,
    key,
  };
}
