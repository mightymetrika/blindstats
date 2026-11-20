import { parseJsonArtifactBytes } from "./artifact-validation";
import { parseAnalysisLockReceiptBytes } from "./analysis-lock-receipt";
import { parseMultiAnalysisLockReceiptBytes } from "./multi-unblinding";
import type { AnalysisLockReceipt } from "./types";
import type { MultiAnalysisLockReceipt } from "./multi-types";

export type SupportedAnalysisLockReceipt =
  | AnalysisLockReceipt
  | MultiAnalysisLockReceipt;

// Keep the historical v0.3 validator untouched. Every version is checked
// against its exact schema before the server accepts a registration.
export function parseSupportedAnalysisLockReceiptBytes(
  bytes: Uint8Array,
): SupportedAnalysisLockReceipt {
  const value = parseJsonArtifactBytes(bytes, "Analysis-lock receipt");

  if (value.schemaVersion === "0.3") {
    return parseAnalysisLockReceiptBytes(bytes);
  }
  if (value.schemaVersion === "0.4") {
    return parseMultiAnalysisLockReceiptBytes(bytes);
  }

  throw new Error("Unsupported analysis-lock receipt schema version.");
}

export function registrationRpcForAnalysisLockReceipt(
  receipt: SupportedAnalysisLockReceipt,
): "register_analysis_lock" | "register_multi_analysis_lock" {
  return receipt.schemaVersion === "0.4"
    ? "register_multi_analysis_lock"
    : "register_analysis_lock";
}
