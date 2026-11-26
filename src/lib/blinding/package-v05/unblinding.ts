import { sha256Hex } from "../hashing";
import { createUnblindingIdentity } from "../identity";
import { artifact, type FileReference } from "./artifacts";
import { packageBlindingReference, parsePackageAnalysisLock, requireMatchingBlindingReference } from "./analysis-lock";
import { openDatasetPackageMapping } from "./package";
import { PACKAGE_VERSION, parsePackageReceipt } from "./receipt";

/** Local receipt construction, not an authorization decision. The caller must
 *  obtain the secret via the authorized Study workflow before invoking this. */
export async function createPackageUnblindingReceipt(receiptBytes: Uint8Array, secretBytes: Uint8Array, lockBytes: Uint8Array | null, createdAt = new Date()) {
  const publicBytes = new Uint8Array(receiptBytes);
  const secret = new Uint8Array(secretBytes);
  const lockArtifact = lockBytes === null ? null : new Uint8Array(lockBytes);
  try {
    const reference = await packageBlindingReference(publicBytes);
    const lock = lockArtifact ? parsePackageAnalysisLock(lockArtifact) : null;
    if (lock) requireMatchingBlindingReference(lock, reference);
    const publicReceipt = await parsePackageReceipt(publicBytes);
    const releasedMappings = await openDatasetPackageMapping(publicBytes, secret);
    const receipt = {
      schemaVersion: PACKAGE_VERSION,
      receiptType: "unblinding" as const,
      ...createUnblindingIdentity(createdAt),
      transformationId: reference.transformationId,
      lockId: lock?.lockId ?? null,
      manifest: publicReceipt.manifest,
      artifacts: {
        blindingReceiptSha256: reference.blindingReceiptSha256,
        manifestSha256: reference.datasetCommitmentSha256,
        analysisLockReceiptSha256: lockArtifact ? await sha256Hex(lockArtifact) : null,
        unblindingSecretSha256: await sha256Hex(secret),
        analysisArtifacts: lock?.analysisArtifacts ?? [],
      },
      releasedMappings,
    };
    const analysisArtifact: FileReference | null = lockArtifact ? { filename: "analysis-lock-receipt.json", sha256: await sha256Hex(lockArtifact), byteLength: lockArtifact.byteLength } : null;
    // Compatibility projection for metadata-only completion; never submit mappings or manifest text.
    const completion = { ...receipt, artifacts: { ...receipt.artifacts, analysisArtifact,
      sourceArtifactSha256: reference.datasetCommitmentSha256, blindedArtifactSha256: reference.datasetCommitmentSha256 } };
    return { receipt, completion, receiptArtifact: artifact(receipt) };
  } finally { secret.fill(0); }
}
