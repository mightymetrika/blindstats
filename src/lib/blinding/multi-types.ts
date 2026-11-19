import type {
  AnalysisArtifactReference,
  BlindingAlgorithm,
  BlindingMappingEntry,
  SealedMapping,
  UnblindingArtifactReferences,
  UnblindingSecret,
} from "./types";

// v0.3 remains the supported single-column artifact format.
// v0.4 is intentionally separate until persistent registration is upgraded.
export const MULTI_BLINDING_SCHEMA_VERSION = "0.4" as const;
export const MULTI_MAPPING_AAD_SCHEME =
  "blindstats_blinding_mapping_aad_v2" as const;

export type SelectedBlindingColumn = {
  column: string;
  categoryCount: number;
};

export type ColumnBlindingMapping = {
  column: string;
  mapping: BlindingMappingEntry[];
};

export type MultiSealedMapping = Omit<SealedMapping, "aadScheme"> & {
  aadScheme: typeof MULTI_MAPPING_AAD_SCHEME;
};

export type MultiBlindingReceipt = {
  schemaVersion: typeof MULTI_BLINDING_SCHEMA_VERSION;
  transformationId: string;
  createdAt: string;
  transformationType: "categorical_label_permutation";
  selectedColumns: SelectedBlindingColumn[];
  rowCount: number;
  columnCount: number;
  sourceArtifact: { sha256: string };
  blindedArtifact: { sha256: string };
  sealedMapping: MultiSealedMapping;
  algorithm: BlindingAlgorithm;
};

export type MultiUnblindingSecret = Omit<UnblindingSecret, "schemaVersion"> & {
  schemaVersion: typeof MULTI_BLINDING_SCHEMA_VERSION;
};

export type MultiAnalysisLockReceipt = {
  schemaVersion: typeof MULTI_BLINDING_SCHEMA_VERSION;
  receiptType: "analysis_lock";
  lockId: string;
  createdAt: string;
  blinding: {
    transformationId: string;
    blindingReceiptSha256: string;
    blindedArtifactSha256: string;
  };
  analysisArtifact: AnalysisArtifactReference;
};

export type MultiUnblindingReceipt = {
  schemaVersion: typeof MULTI_BLINDING_SCHEMA_VERSION;
  receiptType: "unblinding";
  unblindingId: string;
  createdAt: string;
  transformationId: string;
  lockId: string | null;
  selectedColumns: SelectedBlindingColumn[];
  artifacts: UnblindingArtifactReferences;
  releasedMappings: ColumnBlindingMapping[];
};
