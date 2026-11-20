import { describe, expect, it } from "vitest";

import { createAnalysisLockPackage } from "./analysis-lock";
import { createBlindedPackage } from "./blinding-package";
import { createMultiBlindedPackage } from "./multi-blinding";
import {
  parseSupportedAnalysisLockReceiptBytes,
  registrationRpcForAnalysisLockReceipt,
} from "./supported-analysis-lock";
import { sha256Hex } from "./hashing";

const encode = (text: string) => new TextEncoder().encode(text);
const artifact = (value: unknown) => encode(`${JSON.stringify(value, null, 2)}\n`);
const data = encode("id,treatment,site\n1,A,North\n2,B,South\n3,A,South\n");
const analysis = { filename: "analysis.Rmd", bytes: encode("analysis under blind") };
const createdAt = new Date("2026-11-20T18:00:00.000Z");

describe("supported analysis-lock registration", () => {
  it("preserves the v0.3 creation and registration contract", async () => {
    const source = await createBlindedPackage(data, "treatment", createdAt);
    const result = await createAnalysisLockPackage(source.receiptArtifact.bytes, analysis, createdAt);
    expect(result.receipt.schemaVersion).toBe("0.3");
    const parsed = parseSupportedAnalysisLockReceiptBytes(result.receiptArtifact.bytes);
    expect(registrationRpcForAnalysisLockReceipt(parsed)).toBe("register_analysis_lock");
    expect(parsed.blinding.blindingReceiptSha256).toBe(await sha256Hex(source.receiptArtifact.bytes));
  });

  it("creates and routes a v0.4 lock to the separate authenticated RPC", async () => {
    const source = await createMultiBlindedPackage(data, ["treatment", "site"], createdAt);
    const result = await createAnalysisLockPackage(source.receiptArtifact.bytes, analysis, createdAt);
    expect(result.receipt.schemaVersion).toBe("0.4");
    const parsed = parseSupportedAnalysisLockReceiptBytes(result.receiptArtifact.bytes);
    expect(parsed).toEqual(result.receipt);
    expect(registrationRpcForAnalysisLockReceipt(parsed)).toBe("register_multi_analysis_lock");
    expect(parsed.blinding.transformationId).toBe(source.receipt.transformationId);
    expect(parsed.blinding.blindingReceiptSha256).toBe(await sha256Hex(source.receiptArtifact.bytes));
    expect(parsed.blinding.blindedArtifactSha256).toBe(source.blinded.sha256);
    expect(parsed.analysisArtifact.sha256).toBe(await sha256Hex(analysis.bytes));
  });

  it("rejects invalid, secret-bearing, and unknown-version lock receipts", async () => {
    const source = await createMultiBlindedPackage(data, ["treatment", "site"], createdAt);
    const result = await createAnalysisLockPackage(source.receiptArtifact.bytes, analysis, createdAt);
    expect(() => parseSupportedAnalysisLockReceiptBytes(artifact({
      ...result.receipt, unblindingSecret: "not-safe",
    }))).toThrow("unexpected structure");
    expect(() => parseSupportedAnalysisLockReceiptBytes(artifact({
      ...result.receipt, schemaVersion: "0.5",
    }))).toThrow("Unsupported");
    expect(() => parseSupportedAnalysisLockReceiptBytes(artifact({
      ...result.receipt, schemaVersion: "0.3",
    }))).not.toThrow();
    // The v0.3 format has identical lock fields; the database's new composite
    // foreign key rejects this downgrade for a registered v0.4 transformation.
  });

  it("rejects malformed v0.4 references and noncanonical input", async () => {
    const source = await createMultiBlindedPackage(data, ["treatment", "site"], createdAt);
    const result = await createAnalysisLockPackage(source.receiptArtifact.bytes, analysis, createdAt);
    expect(() => parseSupportedAnalysisLockReceiptBytes(artifact({
      ...result.receipt,
      blinding: { ...result.receipt.blinding, blindingReceiptSha256: "not-a-hash" },
    }))).toThrow("hash");
    expect(() => parseSupportedAnalysisLockReceiptBytes(encode("not-json"))).toThrow();
  });
});
