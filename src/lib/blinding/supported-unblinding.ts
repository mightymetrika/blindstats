import { parseJsonArtifactBytes } from "./artifact-validation";
import { createLegacyReleaseWithPackageLock } from "./package-v05/legacy-release";
import { createMultiUnblindingPackage } from "./multi-unblinding";
import { parseSupportedBlindingReceiptBytes } from "./public-receipt-version";
import { createUnblindingPackage } from "./unblinding";

export async function createSupportedUnblindingPackage(
  blindingReceiptBytes: Uint8Array,
  unblindingSecretBytes: Uint8Array,
  analysisLockReceiptBytes: Uint8Array | null,
  createdAt: Date = new Date(),
) {
  const publicReceipt = parseSupportedBlindingReceiptBytes(blindingReceiptBytes);
  if (analysisLockReceiptBytes && parseJsonArtifactBytes(analysisLockReceiptBytes, "Analysis lock").schemaVersion === "0.5") {
    return createLegacyReleaseWithPackageLock(blindingReceiptBytes, unblindingSecretBytes, analysisLockReceiptBytes, createdAt);
  }
  return publicReceipt.schemaVersion === "0.4"
    ? createMultiUnblindingPackage(
        blindingReceiptBytes, unblindingSecretBytes, analysisLockReceiptBytes, createdAt,
      )
    : createUnblindingPackage(
        blindingReceiptBytes, unblindingSecretBytes, analysisLockReceiptBytes, createdAt,
      );
}
