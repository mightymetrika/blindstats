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
  return publicReceipt.schemaVersion === "0.4"
    ? createMultiUnblindingPackage(
        blindingReceiptBytes, unblindingSecretBytes, analysisLockReceiptBytes, createdAt,
      )
    : createUnblindingPackage(
        blindingReceiptBytes, unblindingSecretBytes, analysisLockReceiptBytes, createdAt,
      );
}
