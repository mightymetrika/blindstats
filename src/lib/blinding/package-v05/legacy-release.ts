import { createMultiUnblindingPackage } from "../multi-unblinding";
import { createUnblindingPackage } from "../unblinding";
import { sha256Hex } from "../hashing";
import { artifact, type FileReference } from "./artifacts";
import { parsePackageAnalysisLock, requireMatchingBlindingReference } from "./analysis-lock";
import { supportedBlindingReference } from "./legacy-lock";

/** The existing completion RPC columns identify the actual downloaded lock
 * manifest for v0.5 locks, not an arbitrary member of the file set. */
export async function legacyLockManifestReference(lockBytes: Uint8Array): Promise<FileReference> {
  return { filename: "analysis-lock-receipt.json", sha256: await sha256Hex(lockBytes), byteLength: lockBytes.byteLength };
}

/** Validate the entire historical chain before opening the mapping. The
 * downloaded receipt is explicitly v0.5, with the real file set. The legacy
 * projection is used ONLY for existing completion RPC metadata and mapping UI. */
export async function createLegacyReleaseWithPackageLock(publicBytes: Uint8Array, secretBytes: Uint8Array, lockBytes: Uint8Array, createdAt = new Date()) {
  const stablePublic = new Uint8Array(publicBytes);
  const stableSecret = new Uint8Array(secretBytes);
  const stableLock = new Uint8Array(lockBytes);
  try {
    const reference = await supportedBlindingReference(stablePublic);
    if (reference.schemaVersion === "0.5") throw new Error("Expected historical blinding receipt.");
    const lock = parsePackageAnalysisLock(stableLock);
    requireMatchingBlindingReference(lock, reference);
    const released = reference.schemaVersion === "0.4"
      ? await createMultiUnblindingPackage(stablePublic, stableSecret, null, createdAt)
      : await createUnblindingPackage(stablePublic, stableSecret, null, createdAt);
    const manifest = await legacyLockManifestReference(stableLock);
    const completion = {
      ...released.receipt,
      lockId: lock.lockId,
      artifacts: { ...released.receipt.artifacts, analysisLockReceiptSha256: manifest.sha256, analysisArtifact: manifest },
    };
    const { analysisArtifact: analysisLockManifest, ...refs } = completion.artifacts;
    const receipt = {
      ...completion,
      schemaVersion: "0.5" as const,
      blindingSchemaVersion: completion.schemaVersion,
      artifacts: { ...refs, analysisLockManifest, analysisArtifacts: lock.analysisArtifacts },
    };
    return { receipt, completion, receiptArtifact: artifact(receipt) };
  } finally { stableSecret.fill(0); }
}
