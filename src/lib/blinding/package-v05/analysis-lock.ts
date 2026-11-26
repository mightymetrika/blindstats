import { parseJsonArtifactBytes, requireArray, requireCanonicalTimestamp, requireExactKeys, requireNonblankString, requireRecord, requireSha256 } from "../artifact-validation";
import { sha256Hex } from "../hashing";
import { createAnalysisLockIdentity } from "../identity";
import { artifact, describeFile, parseFileReference, unique, verifyFiles, type FileInput, type FileReference } from "./artifacts";
import { PACKAGE_VERSION, parsePackageReceipt } from "./receipt";

export type BlindingReference = {
  schemaVersion: "0.3" | "0.4" | "0.5";
  transformationId: string;
  blindingReceiptSha256: string;
  datasetCommitmentSha256: string;
};
export type PackageAnalysisLock = {
  schemaVersion: "0.5";
  receiptType: "analysis_lock";
  lockId: string;
  createdAt: string;
  blinding: BlindingReference;
  analysisArtifacts: (FileReference & { artifactId: string })[];
};

export function parsePackageAnalysisLock(bytes: Uint8Array): PackageAnalysisLock {
  const r = parseJsonArtifactBytes(bytes, "Package analysis lock");
  requireExactKeys(r, ["schemaVersion", "receiptType", "lockId", "createdAt", "blinding", "analysisArtifacts"], "Package analysis lock");
  if (r.schemaVersion !== PACKAGE_VERSION || r.receiptType !== "analysis_lock") throw new Error("Unsupported package analysis lock.");
  const b = requireRecord(r.blinding, "Blinding reference");
  requireExactKeys(b, ["schemaVersion", "transformationId", "blindingReceiptSha256", "datasetCommitmentSha256"], "Blinding reference");
  if (b.schemaVersion !== "0.3" && b.schemaVersion !== "0.4" && b.schemaVersion !== "0.5") throw new Error("Unsupported referenced blinding receipt.");
  const analysisArtifacts = requireArray(r.analysisArtifacts, "Analysis artifacts").map((item) => {
    const a = requireRecord(item, "Analysis artifact");
    requireExactKeys(a, ["artifactId", "filename", "sha256", "byteLength"], "Analysis artifact");
    return { artifactId: requireNonblankString(a, "artifactId", "Artifact ID"), ...parseFileReference({ filename: a.filename, sha256: a.sha256, byteLength: a.byteLength }) };
  });
  if (!analysisArtifacts.length) throw new Error("An analysis lock requires at least one artifact.");
  unique(analysisArtifacts.map((a) => a.artifactId), "Artifact IDs");
  unique(analysisArtifacts.map((a) => a.filename), "Analysis filenames");
  return {
    schemaVersion: PACKAGE_VERSION, receiptType: "analysis_lock",
    lockId: requireNonblankString(r, "lockId", "Lock ID"), createdAt: requireCanonicalTimestamp(r.createdAt, "Lock creation time"),
    blinding: { schemaVersion: b.schemaVersion, transformationId: requireNonblankString(b, "transformationId", "Transformation ID"), blindingReceiptSha256: requireSha256(b.blindingReceiptSha256, "Receipt hash"), datasetCommitmentSha256: requireSha256(b.datasetCommitmentSha256, "Dataset commitment") },
    analysisArtifacts,
  };
}
export async function packageBlindingReference(receiptBytes: Uint8Array): Promise<BlindingReference> {
  const stable = new Uint8Array(receiptBytes);
  const r = await parsePackageReceipt(stable);
  return { schemaVersion: PACKAGE_VERSION, transformationId: r.transformationId, blindingReceiptSha256: await sha256Hex(stable), datasetCommitmentSha256: r.manifestSha256 };
}
/** The reference must come from a validated exact blinding receipt, never arbitrary form data. */
export async function lockReferencedArtifacts(reference: BlindingReference, files: readonly FileInput[], createdAt = new Date()) {
  const blinding = { ...reference };
  const stable = files.map(({ filename, bytes }) => ({ filename, bytes: new Uint8Array(bytes) }));
  const analysisArtifacts = await Promise.all(stable.map(async (file, i) => ({ artifactId: `a${i + 1}`, ...await describeFile(file) })));
  const receipt: PackageAnalysisLock = { schemaVersion: PACKAGE_VERSION, receiptType: "analysis_lock", ...createAnalysisLockIdentity(createdAt), blinding, analysisArtifacts };
  const receiptArtifact = artifact(receipt);
  parsePackageAnalysisLock(receiptArtifact.bytes);
  return { receipt, receiptArtifact };
}
export async function createPackageAnalysisLock(receiptBytes: Uint8Array, files: readonly FileInput[], createdAt = new Date()) {
  return lockReferencedArtifacts(await packageBlindingReference(receiptBytes), files, createdAt);
}
export function requireMatchingBlindingReference(lock: PackageAnalysisLock, expected: BlindingReference): void {
  const actual = lock.blinding;
  if (actual.schemaVersion !== expected.schemaVersion || actual.transformationId !== expected.transformationId ||
      actual.blindingReceiptSha256 !== expected.blindingReceiptSha256 || actual.datasetCommitmentSha256 !== expected.datasetCommitmentSha256) throw new Error("Analysis lock does not match the exact blinding receipt and dataset commitment.");
}
export async function verifyLockedArtifacts(lockBytes: Uint8Array, files: readonly FileInput[], expected: BlindingReference) {
  const lock = parsePackageAnalysisLock(lockBytes);
  requireMatchingBlindingReference(lock, expected);
  await verifyFiles(lock.analysisArtifacts, files);
  return lock;
}
