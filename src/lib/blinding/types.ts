export const BLINDING_SCHEMA_VERSION = "0.1" as const;

export type BlindingSchemaVersion = typeof BLINDING_SCHEMA_VERSION;

export type TransformationType = "categorical_label_permutation";

export type NeutralLabelScheme = "Group_<letters>";

export type MappingAssignmentMethod = "web_crypto_random_permutation";

export type BlindingMappingEntry = {
  original: string;
  blinded: string;
};

export type ArtifactHash = {
  sha256: string;
};

export type BlindingAlgorithm = {
  neutralLabelScheme: NeutralLabelScheme;
  mappingAssignment: MappingAssignmentMethod;
};

export type BlindingPlan = {
  transformationId: string;
  selectedColumn: string;
  mapping: BlindingMappingEntry[];
};

export type BlindingReceipt = {
  schemaVersion: BlindingSchemaVersion;
  transformationId: string;
  createdAt: string;
  transformationType: TransformationType;
  selectedColumn: string;
  categoryCount: number;
  rowCount: number;
  columnCount: number;
  sourceArtifact: ArtifactHash;
  blindedArtifact: ArtifactHash;
  algorithm: BlindingAlgorithm;
};

export type BlindingKey = {
  schemaVersion: BlindingSchemaVersion;
  transformationId: string;
  createdAt: string;
  transformationType: TransformationType;
  selectedColumn: string;
  sourceArtifactSha256: string;
  blindedArtifactSha256: string;
  mapping: BlindingMappingEntry[];
};
