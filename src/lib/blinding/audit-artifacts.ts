import {
  BLINDING_SCHEMA_VERSION,
  type BlindingReceipt,
  type SealedMapping,
  type UnblindingSecret,
} from "./types";
import type { TransformationIdentity } from "./identity";

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export type CreateBlindingAuditArtifactsInput = {
  identity: TransformationIdentity;
  selectedColumn: string;
  categoryCount: number;
  rowCount: number;
  columnCount: number;
  sourceArtifactSha256: string;
  blindedArtifactSha256: string;
  sealedMapping: SealedMapping;
  secret: UnblindingSecret;
};

export type BlindingAuditArtifacts = {
  receipt: BlindingReceipt;
  secret: UnblindingSecret;
};

function validatePositiveInteger(
  value: number,
  fieldName: string,
): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(
      `${fieldName} must be a positive integer.`,
    );
  }
}

function validateSha256(
  value: string,
  fieldName: string,
): void {
  if (!SHA256_HEX_PATTERN.test(value)) {
    throw new Error(
      `${fieldName} must be a lowercase 64-character SHA-256 hexadecimal digest.`,
    );
  }
}

function validateIdentity(
  identity: TransformationIdentity,
): void {
  if (identity.transformationId.trim().length === 0) {
    throw new Error(
      "Transformation identifier cannot be blank.",
    );
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

export function createBlindingAuditArtifacts(
  input: CreateBlindingAuditArtifactsInput,
): BlindingAuditArtifacts {
  validateIdentity(input.identity);

  if (input.selectedColumn.trim().length === 0) {
    throw new Error(
      "Selected blinding column cannot be blank.",
    );
  }

  validatePositiveInteger(
    input.categoryCount,
    "Category count",
  );
  if (input.categoryCount < 2) {
    throw new RangeError(
      "Category count must be at least 2.",
    );
  }

  validatePositiveInteger(input.rowCount, "Row count");
  validatePositiveInteger(
    input.columnCount,
    "Column count",
  );
  validateSha256(
    input.sourceArtifactSha256,
    "Source artifact hash",
  );
  validateSha256(
    input.blindedArtifactSha256,
    "Blinded artifact hash",
  );

  if (
    input.secret.transformationId !==
    input.identity.transformationId
  ) {
    throw new Error(
      "Unblinding secret transformation identifier must match the blinding transformation.",
    );
  }

  const receipt: BlindingReceipt = {
    schemaVersion: BLINDING_SCHEMA_VERSION,
    transformationId: input.identity.transformationId,
    createdAt: input.identity.createdAt,
    transformationType:
      "categorical_label_permutation",
    selectedColumn: input.selectedColumn,
    categoryCount: input.categoryCount,
    rowCount: input.rowCount,
    columnCount: input.columnCount,
    sourceArtifact: {
      sha256: input.sourceArtifactSha256,
    },
    blindedArtifact: {
      sha256: input.blindedArtifactSha256,
    },
    sealedMapping: {
      ...input.sealedMapping,
    },
    algorithm: {
      neutralLabelScheme: "Group_<letters>",
      mappingAssignment:
        "web_crypto_random_permutation",
    },
  };

  const secret: UnblindingSecret = {
    ...input.secret,
  };

  return {
    receipt,
    secret,
  };
}
