export const BLINDING_SCHEMA_VERSION = "0.3" as const;

export const SEALED_MAPPING_ALGORITHM = "AES-GCM" as const;
export const SEALED_MAPPING_ENCODING = "hex" as const;
export const SEALED_MAPPING_AAD_SCHEME =
  "blindstats_blinding_mapping_aad_v1" as const;
export const UNBLINDING_SECRET_TYPE =
  "unblinding_secret" as const;

export type BlindingSchemaVersion = typeof BLINDING_SCHEMA_VERSION;

export type TransformationType = "categorical_label_permutation";

export type NeutralLabelScheme = "Group_<letters>";

export type MappingAssignmentMethod = "web_crypto_random_permutation";

export type DatasetCell = string | null;

export type DatasetRow = Record<string, DatasetCell>;

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

export type SealedMapping = {
  algorithm: typeof SEALED_MAPPING_ALGORITHM;
  keyLength: 256;
  tagLength: 128;
  encoding: typeof SEALED_MAPPING_ENCODING;
  aadScheme: typeof SEALED_MAPPING_AAD_SCHEME;
  ivHex: string;
  ciphertextHex: string;
};

export type UnblindingSecret = {
  schemaVersion: BlindingSchemaVersion;
  secretType: typeof UNBLINDING_SECRET_TYPE;
  transformationId: string;
  keyAlgorithm: typeof SEALED_MAPPING_ALGORITHM;
  keyLength: 256;
  encoding: typeof SEALED_MAPPING_ENCODING;
  keyHex: string;
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
  sealedMapping: SealedMapping;
  algorithm: BlindingAlgorithm;
};

export type AnalysisLockReceiptType = "analysis_lock";

export type AnalysisLockBlindingReference = {
  transformationId: string;
  blindingReceiptSha256: string;
  blindedArtifactSha256: string;
};

export type AnalysisArtifactReference = {
  filename: string;
  sha256: string;
  byteLength: number;
};

export type AnalysisLockReceipt = {
  schemaVersion: BlindingSchemaVersion;
  receiptType: AnalysisLockReceiptType;
  lockId: string;
  createdAt: string;
  blinding: AnalysisLockBlindingReference;
  analysisArtifact: AnalysisArtifactReference;
};

export type UnblindingReceiptType = "unblinding";

export type UnblindingArtifactReferences = {
  sourceArtifactSha256: string;
  blindingReceiptSha256: string;
  blindedArtifactSha256: string;
  unblindingSecretSha256: string;
  analysisLockReceiptSha256: string;
  analysisArtifact: AnalysisArtifactReference;
};

export type UnblindingReceipt = {
  schemaVersion: BlindingSchemaVersion;
  receiptType: UnblindingReceiptType;
  unblindingId: string;
  createdAt: string;
  transformationId: string;
  lockId: string;
  selectedColumn: string;
  artifacts: UnblindingArtifactReferences;
  releasedMapping: BlindingMappingEntry[];
};
