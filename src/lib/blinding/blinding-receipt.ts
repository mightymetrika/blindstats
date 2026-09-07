import {
  BLINDING_SCHEMA_VERSION,
  type BlindingReceipt,
} from "./types";

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

function requireRecord(
  value: unknown,
  fieldName: string,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(`${fieldName} must be a JSON object.`);
  }

  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  fieldName: string,
): void {
  const expected = new Set(expectedKeys);
  const actual = Object.keys(value);

  const missing = expectedKeys.filter((key) => !(key in value));
  const unexpected = actual.filter((key) => !expected.has(key));

  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${fieldName} has an unexpected structure.`,
    );
  }
}

function requireString(
  value: Record<string, unknown>,
  key: string,
  fieldName: string,
): string {
  const result = value[key];

  if (typeof result !== "string") {
    throw new Error(`${fieldName} must be a string.`);
  }

  return result;
}

function requirePositiveInteger(
  value: unknown,
  fieldName: string,
  minimum = 1,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum
  ) {
    throw new Error(
      `${fieldName} must be an integer greater than or equal to ${minimum}.`,
    );
  }

  return value;
}

function requireSha256(value: unknown, fieldName: string): string {
  if (
    typeof value !== "string" ||
    !SHA256_HEX_PATTERN.test(value)
  ) {
    throw new Error(
      `${fieldName} must be a lowercase 64-character SHA-256 hexadecimal digest.`,
    );
  }

  return value;
}

function requireCanonicalTimestamp(
  value: unknown,
  fieldName: string,
): string {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string.`);
  }

  const parsed = new Date(value);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== value
  ) {
    throw new Error(
      `${fieldName} must be a canonical ISO-8601 timestamp.`,
    );
  }

  return value;
}

export function parseBlindingReceiptBytes(
  bytes: Uint8Array,
): BlindingReceipt {
  if (bytes.length === 0) {
    throw new Error("Blinding receipt file cannot be empty.");
  }

  let text: string;

  try {
    text = UTF8_DECODER.decode(new Uint8Array(bytes));
  } catch {
    throw new Error("Blinding receipt must be valid UTF-8.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Blinding receipt must contain valid JSON.");
  }

  const receipt = requireRecord(parsed, "Blinding receipt");

  requireExactKeys(
    receipt,
    [
      "schemaVersion",
      "transformationId",
      "createdAt",
      "transformationType",
      "selectedColumn",
      "categoryCount",
      "rowCount",
      "columnCount",
      "sourceArtifact",
      "blindedArtifact",
      "algorithm",
    ],
    "Blinding receipt",
  );

  if (receipt.schemaVersion !== BLINDING_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported blinding receipt schema version "${String(receipt.schemaVersion)}".`,
    );
  }

  if (
    receipt.transformationType !==
    "categorical_label_permutation"
  ) {
    throw new Error(
      "Blinding receipt has an unsupported transformation type.",
    );
  }

  const transformationId = requireString(
    receipt,
    "transformationId",
    "Transformation identifier",
  );

  if (transformationId.trim().length === 0) {
    throw new Error("Transformation identifier cannot be blank.");
  }

  const selectedColumn = requireString(
    receipt,
    "selectedColumn",
    "Selected blinding column",
  );

  if (selectedColumn.trim().length === 0) {
    throw new Error("Selected blinding column cannot be blank.");
  }

  const sourceArtifact = requireRecord(
    receipt.sourceArtifact,
    "Source artifact",
  );
  requireExactKeys(
    sourceArtifact,
    ["sha256"],
    "Source artifact",
  );

  const blindedArtifact = requireRecord(
    receipt.blindedArtifact,
    "Blinded artifact",
  );
  requireExactKeys(
    blindedArtifact,
    ["sha256"],
    "Blinded artifact",
  );

  const algorithm = requireRecord(
    receipt.algorithm,
    "Blinding algorithm",
  );
  requireExactKeys(
    algorithm,
    ["neutralLabelScheme", "mappingAssignment"],
    "Blinding algorithm",
  );

  if (algorithm.neutralLabelScheme !== "Group_<letters>") {
    throw new Error(
      "Blinding receipt has an unsupported neutral-label scheme.",
    );
  }

  if (
    algorithm.mappingAssignment !==
    "web_crypto_random_permutation"
  ) {
    throw new Error(
      "Blinding receipt has an unsupported mapping-assignment method.",
    );
  }

  return {
    schemaVersion: BLINDING_SCHEMA_VERSION,
    transformationId,
    createdAt: requireCanonicalTimestamp(
      receipt.createdAt,
      "Blinding receipt creation time",
    ),
    transformationType: "categorical_label_permutation",
    selectedColumn,
    categoryCount: requirePositiveInteger(
      receipt.categoryCount,
      "Category count",
      2,
    ),
    rowCount: requirePositiveInteger(
      receipt.rowCount,
      "Row count",
    ),
    columnCount: requirePositiveInteger(
      receipt.columnCount,
      "Column count",
    ),
    sourceArtifact: {
      sha256: requireSha256(
        sourceArtifact.sha256,
        "Source artifact hash",
      ),
    },
    blindedArtifact: {
      sha256: requireSha256(
        blindedArtifact.sha256,
        "Blinded artifact hash",
      ),
    },
    algorithm: {
      neutralLabelScheme: "Group_<letters>",
      mappingAssignment: "web_crypto_random_permutation",
    },
  };
}
