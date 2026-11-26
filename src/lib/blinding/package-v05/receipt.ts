import { parseJsonArtifactBytes, requireArray, requireCanonicalTimestamp, requireExactKeys, requireNonblankString, requireRecord, requireSha256 } from "../artifact-validation";
import { sha256Hex } from "../hashing";
import { canonicalBytes, parseFileReference, requireHex, safeInteger, unique, verifyFiles, type FileInput, type FileReference } from "./artifacts";
import type { MappingGroup } from "./mappings";

export const PACKAGE_VERSION = "0.5" as const;
export const PACKAGE_AAD = "blindstats_package_mapping_aad_v1" as const;
export type ManifestDataset = {
  datasetId: string;
  format: string;
  rowCount: number;
  columnCount: number;
  selectedVariables: { id: string; name: string }[];
  source: { sha256: string; byteLength: number };
  blinded: FileReference;
};
export type PackageManifest = { datasets: ManifestDataset[]; mappingGroups: MappingGroup[] };
export type PackageHeader = {
  schemaVersion: typeof PACKAGE_VERSION;
  receiptType: "blinding_package";
  transformationId: string;
  createdAt: string;
  manifest: PackageManifest;
  manifestSha256: string;
};
export type PackageReceipt = PackageHeader & {
  sealedMapping: { algorithm: "AES-GCM"; aadScheme: typeof PACKAGE_AAD; ivHex: string; ciphertextHex: string };
};
export type PackageSecret = {
  schemaVersion: typeof PACKAGE_VERSION;
  secretType: "unblinding_secret";
  transformationId: string;
  keyHex: string;
};

function parseManifest(value: unknown): PackageManifest {
  const manifest = requireRecord(value, "Dataset manifest");
  requireExactKeys(manifest, ["datasets", "mappingGroups"], "Dataset manifest");
  const datasets = requireArray(manifest.datasets, "Datasets").map((item): ManifestDataset => {
    const d = requireRecord(item, "Dataset reference");
    requireExactKeys(d, ["datasetId", "format", "rowCount", "columnCount", "selectedVariables", "source", "blinded"], "Dataset reference");
    const selectedVariables = requireArray(d.selectedVariables, "Selected dataset variables").map((item) => {
      const v = requireRecord(item, "Variable");
      requireExactKeys(v, ["id", "name"], "Variable");
      return { id: requireNonblankString(v, "id", "Variable ID"), name: requireNonblankString(v, "name", "Variable name") };
    });
    unique(selectedVariables.map((v) => v.id), "Variable IDs");
    unique(selectedVariables.map((v) => v.name), "Variable names");
    const columnCount = safeInteger(d.columnCount, "Column count");
    if (!selectedVariables.length || selectedVariables.length > columnCount) throw new Error("Manifest selected variable count is invalid.");
    const source = requireRecord(d.source, "Source reference");
    requireExactKeys(source, ["sha256", "byteLength"], "Source reference");
    const blinded = parseFileReference(d.blinded);
    if (!blinded.byteLength) throw new Error("Blinded dataset cannot be empty.");
    const format = requireNonblankString(d, "format", "Dataset format");
    if (!/^[a-z0-9]+$/.test(format)) throw new Error("Invalid dataset format identifier.");
    return {
      datasetId: requireNonblankString(d, "datasetId", "Dataset ID"), format,
      rowCount: safeInteger(d.rowCount, "Row count"), columnCount, selectedVariables,
      source: { sha256: requireSha256(source.sha256, "Source hash"), byteLength: safeInteger(source.byteLength, "Source byte length") },
      blinded,
    };
  });
  if (!datasets.length) throw new Error("Manifest requires datasets.");
  unique(datasets.map((d) => d.datasetId), "Dataset IDs");
  unique(datasets.map((d) => d.blinded.filename), "Blinded filenames");
  const byId = new Map(datasets.map((d) => [d.datasetId, d]));
  const allMembers: string[] = [];
  const usedDatasets = new Set<string>();
  const mappingGroups = requireArray(manifest.mappingGroups, "Mapping groups").map((item): MappingGroup => {
    const g = requireRecord(item, "Mapping group");
    requireExactKeys(g, ["groupId", "members", "categoryCount"], "Mapping group");
    const members = requireArray(g.members, "Group members").map((item) => {
      const m = requireRecord(item, "Group member");
      requireExactKeys(m, ["datasetId", "variableId"], "Group member");
      const datasetId = requireNonblankString(m, "datasetId", "Dataset ID");
      const variableId = requireNonblankString(m, "variableId", "Variable ID");
      if (!byId.get(datasetId)?.selectedVariables.some((v) => v.id === variableId)) throw new Error("Manifest group refers to an unknown variable.");
      allMembers.push(JSON.stringify([datasetId, variableId]));
      usedDatasets.add(datasetId);
      return { datasetId, variableId };
    });
    if (!members.length) throw new Error("Manifest group cannot be empty.");
    return { groupId: requireNonblankString(g, "groupId", "Group ID"), members, categoryCount: safeInteger(g.categoryCount, "Category count", 2) };
  });
  unique(mappingGroups.map((g) => g.groupId), "Group IDs");
  unique(allMembers, "Mapping group members");
  if (usedDatasets.size !== datasets.length || allMembers.length !== datasets.reduce((n, d) => n + d.selectedVariables.length, 0)) throw new Error("Manifest mapping groups do not cover the selected variables exactly.");
  return { datasets, mappingGroups };
}
export function packageHeader(receipt: PackageReceipt): PackageHeader {
  const { schemaVersion, receiptType, transformationId, createdAt, manifest, manifestSha256 } = receipt;
  return { schemaVersion, receiptType, transformationId, createdAt, manifest, manifestSha256 };
}
export function mappingAad(header: PackageHeader): Uint8Array {
  return canonicalBytes({ domain: PACKAGE_AAD, ...header });
}
export async function parsePackageReceipt(bytes: Uint8Array): Promise<PackageReceipt> {
  const r = parseJsonArtifactBytes(bytes, "Package receipt");
  requireExactKeys(r, ["schemaVersion", "receiptType", "transformationId", "createdAt", "manifest", "manifestSha256", "sealedMapping"], "Package receipt");
  if (r.schemaVersion !== PACKAGE_VERSION || r.receiptType !== "blinding_package") throw new Error("Unsupported package receipt.");
  const manifest = parseManifest(r.manifest);
  const manifestSha256 = requireSha256(r.manifestSha256, "Manifest hash");
  if (await sha256Hex(canonicalBytes(manifest)) !== manifestSha256) throw new Error("Manifest hash does not match.");
  const sealed = requireRecord(r.sealedMapping, "Sealed mapping");
  requireExactKeys(sealed, ["algorithm", "aadScheme", "ivHex", "ciphertextHex"], "Sealed mapping");
  if (sealed.algorithm !== "AES-GCM" || sealed.aadScheme !== PACKAGE_AAD) throw new Error("Unsupported package encryption parameters.");
  const ciphertextHex = requireHex(sealed.ciphertextHex, null, "ciphertext");
  if (ciphertextHex.length < 32) throw new Error("Invalid mapping ciphertext length.");
  return {
    schemaVersion: PACKAGE_VERSION, receiptType: "blinding_package",
    transformationId: requireNonblankString(r, "transformationId", "Transformation ID"),
    createdAt: requireCanonicalTimestamp(r.createdAt, "Creation time"), manifest, manifestSha256,
    sealedMapping: { algorithm: "AES-GCM", aadScheme: PACKAGE_AAD, ivHex: requireHex(sealed.ivHex, 24, "IV"), ciphertextHex },
  };
}
export function parsePackageSecret(bytes: Uint8Array): PackageSecret {
  const s = parseJsonArtifactBytes(bytes, "Package secret");
  requireExactKeys(s, ["schemaVersion", "secretType", "transformationId", "keyHex"], "Package secret");
  if (s.schemaVersion !== PACKAGE_VERSION || s.secretType !== "unblinding_secret") throw new Error("Unsupported package secret.");
  return { schemaVersion: PACKAGE_VERSION, secretType: "unblinding_secret", transformationId: requireNonblankString(s, "transformationId", "Transformation ID"), keyHex: requireHex(s.keyHex, 64, "key") };
}
export async function verifyBlindedPackage(receiptBytes: Uint8Array, files: readonly FileInput[]) {
  const receipt = await parsePackageReceipt(receiptBytes);
  await verifyFiles(receipt.manifest.datasets.map((d) => d.blinded), files);
  return receipt;
}
