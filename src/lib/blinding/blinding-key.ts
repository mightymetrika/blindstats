import { generateNeutralLabels } from "./labels";
import {
  parseJsonArtifactBytes,
  requireArray,
  requireCanonicalTimestamp,
  requireExactKeys,
  requireNonblankString,
  requireRecord,
  requireSha256,
  requireString,
} from "./artifact-validation";
import {
  BLINDING_SCHEMA_VERSION,
  type BlindingKey,
  type BlindingMappingEntry,
} from "./types";

function parseMapping(value: unknown): BlindingMappingEntry[] {
  const rawMapping = requireArray(value, "Blinding key mapping");

  if (rawMapping.length < 2) {
    throw new Error(
      "Blinding key mapping must contain at least two entries.",
    );
  }

  const originals = new Set<string>();
  const blindedLabels = new Set<string>();

  const mapping = rawMapping.map((rawEntry, index) => {
    const entry = requireRecord(
      rawEntry,
      `Blinding key mapping entry ${index + 1}`,
    );

    requireExactKeys(
      entry,
      ["original", "blinded"],
      `Blinding key mapping entry ${index + 1}`,
    );

    const original = requireString(
      entry,
      "original",
      `Blinding key mapping entry ${index + 1} original value`,
    );
    const blinded = requireString(
      entry,
      "blinded",
      `Blinding key mapping entry ${index + 1} blinded value`,
    );

    if (original.length === 0) {
      throw new Error(
        `Blinding key mapping entry ${index + 1} original value cannot be empty.`,
      );
    }

    if (originals.has(original)) {
      throw new Error(
        "Blinding key mapping cannot contain duplicate original categories.",
      );
    }

    if (blindedLabels.has(blinded)) {
      throw new Error(
        "Blinding key mapping cannot contain duplicate blinded labels.",
      );
    }

    originals.add(original);
    blindedLabels.add(blinded);

    return {
      original,
      blinded,
    };
  });

  const expectedLabels = new Set(
    generateNeutralLabels(mapping.length),
  );

  if (
    blindedLabels.size !== expectedLabels.size ||
    [...blindedLabels].some((label) => !expectedLabels.has(label))
  ) {
    throw new Error(
      "Blinding key mapping does not use the expected neutral-label set.",
    );
  }

  return mapping;
}

export function parseBlindingKeyBytes(
  bytes: Uint8Array,
): BlindingKey {
  const key = parseJsonArtifactBytes(bytes, "Blinding key");

  requireExactKeys(
    key,
    [
      "schemaVersion",
      "transformationId",
      "createdAt",
      "transformationType",
      "selectedColumn",
      "sourceArtifactSha256",
      "blindedArtifactSha256",
      "mapping",
    ],
    "Blinding key",
  );

  if (key.schemaVersion !== BLINDING_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported blinding key schema version "${String(key.schemaVersion)}".`,
    );
  }

  if (
    key.transformationType !==
    "categorical_label_permutation"
  ) {
    throw new Error(
      "Blinding key has an unsupported transformation type.",
    );
  }

  return {
    schemaVersion: BLINDING_SCHEMA_VERSION,
    transformationId: requireNonblankString(
      key,
      "transformationId",
      "Transformation identifier",
    ),
    createdAt: requireCanonicalTimestamp(
      key.createdAt,
      "Blinding key creation time",
    ),
    transformationType: "categorical_label_permutation",
    selectedColumn: requireNonblankString(
      key,
      "selectedColumn",
      "Selected blinding column",
    ),
    sourceArtifactSha256: requireSha256(
      key.sourceArtifactSha256,
      "Blinding key source artifact hash",
    ),
    blindedArtifactSha256: requireSha256(
      key.blindedArtifactSha256,
      "Blinding key blinded artifact hash",
    ),
    mapping: parseMapping(key.mapping),
  };
}
