import { parseJsonArtifactBytes } from "./artifact-validation";
import { parseBlindingReceiptBytes } from "./blinding-receipt";
import { parseMultiBlindingReceiptBytes } from "./multi-blinding";
import type { BlindingReceipt } from "./types";
import type { MultiBlindingReceipt } from "./multi-types";

export type SupportedBlindingReceipt = BlindingReceipt | MultiBlindingReceipt;

export function parseSupportedBlindingReceiptBytes(
  bytes: Uint8Array,
): SupportedBlindingReceipt {
  const receipt = parseJsonArtifactBytes(bytes, "Public blinding receipt");
  if (receipt.schemaVersion === "0.3") {
    return parseBlindingReceiptBytes(bytes);
  }
  if (receipt.schemaVersion === "0.4") {
    return parseMultiBlindingReceiptBytes(bytes);
  }
  throw new Error("Unsupported public blinding receipt schema version.");
}

export function registrationRpcForBlindingReceipt(
  receipt: SupportedBlindingReceipt,
): "register_blinding_transformation" | "register_multi_blinding_transformation" {
  return receipt.schemaVersion === "0.4"
    ? "register_multi_blinding_transformation"
    : "register_blinding_transformation";
}
