import { parseSupportedBlindingReceiptBytes } from "../public-receipt-version";
import { sha256Hex } from "../hashing";
import { parseJsonArtifactBytes } from "../artifact-validation";
import { lockReferencedArtifacts, packageBlindingReference, type BlindingReference } from "./analysis-lock";
import type { FileInput } from "./artifacts";

/** Independent lock version: preserve exact original receipt bytes for all versions. */
export async function supportedBlindingReference(bytes: Uint8Array): Promise<BlindingReference> {
  const stable = new Uint8Array(bytes);
  if (parseJsonArtifactBytes(stable, "Blinding receipt").schemaVersion === "0.5") return packageBlindingReference(stable);
  const receipt = parseSupportedBlindingReceiptBytes(stable);
  return {
    schemaVersion: receipt.schemaVersion, transformationId: receipt.transformationId,
    blindingReceiptSha256: await sha256Hex(stable), datasetCommitmentSha256: receipt.blindedArtifact.sha256,
  };
}
export async function createResearchAnalysisLock(receiptBytes: Uint8Array, files: readonly FileInput[], createdAt = new Date()) {
  return lockReferencedArtifacts(await supportedBlindingReference(receiptBytes), files, createdAt);
}
