import { describe, expect, it } from "vitest";
import { createBlindedPackage } from "../blinding-package";
import { createMultiBlindedPackage } from "../multi-blinding";
import { createSupportedUnblindingPackage } from "../supported-unblinding";
import { sha256Hex } from "../hashing";
import { artifact } from "./artifacts";
import { createResearchAnalysisLock } from "./legacy-lock";

const bytes = (text: string) => new TextEncoder().encode(text);
const data = bytes("arm,id\nControl,1\nTreatment,2\n");
const files = [{ filename: "analysis.R", bytes: bytes("mean(x)") }, { filename: "report.md", bytes: bytes("Result") }, { filename: "empty.txt", bytes: new Uint8Array() }];

describe("v0.5 multi-artifact release of historical transformations", () => {
  it.each(["0.3", "0.4"] as const)("retains the exact %s artifact chain and complete lock file set", async (version) => {
    const p = version === "0.3" ? await createBlindedPackage(data, "arm") : await createMultiBlindedPackage(data, ["arm"]);
    const lock = await createResearchAnalysisLock(p.receiptArtifact.bytes, files);
    const released = await createSupportedUnblindingPackage(p.receiptArtifact.bytes, p.secretArtifact.bytes, lock.receiptArtifact.bytes);
    if (!("completion" in released)) throw new Error("Expected new lock receipt.");
    expect(released.receipt.schemaVersion).toBe("0.5");
    expect(released.receipt.blindingSchemaVersion).toBe(version);
    expect(released.receipt.lockId).toBe(lock.receipt.lockId);
    expect(released.receipt.artifacts.analysisArtifacts).toEqual(lock.receipt.analysisArtifacts);
    expect(released.receipt.artifacts.analysisLockReceiptSha256).toBe(await sha256Hex(lock.receiptArtifact.bytes));
    expect(released.receipt.artifacts.analysisLockManifest).toEqual({ filename: "analysis-lock-receipt.json", sha256: await sha256Hex(lock.receiptArtifact.bytes), byteLength: lock.receiptArtifact.bytes.length });
    expect(released.completion.artifacts.analysisArtifact).toEqual(released.receipt.artifacts.analysisLockManifest);
    expect(JSON.parse(released.receiptArtifact.text)).toEqual(released.receipt);
    expect(released.receipt.artifacts).not.toHaveProperty("analysisArtifact");
  });
  it("rejects wrong lock commitment, version and secret without release", async () => {
    const p = await createMultiBlindedPackage(data, ["arm"]);
    const other = await createMultiBlindedPackage(data, ["arm"]);
    const lock = await createResearchAnalysisLock(p.receiptArtifact.bytes, files);
    const wrongCommitment = artifact({ ...lock.receipt, blinding: { ...lock.receipt.blinding, datasetCommitmentSha256: "0".repeat(64) } });
    const wrongVersion = artifact({ ...lock.receipt, blinding: { ...lock.receipt.blinding, schemaVersion: "0.3" } });
    for (const bad of [wrongCommitment, wrongVersion]) {
      await expect(createSupportedUnblindingPackage(p.receiptArtifact.bytes, p.secretArtifact.bytes, bad.bytes)).rejects.toThrow(/exact/);
    }
    await expect(createSupportedUnblindingPackage(p.receiptArtifact.bytes, other.secretArtifact.bytes, lock.receiptArtifact.bytes)).rejects.toThrow();
    await expect(createSupportedUnblindingPackage(bytes(JSON.stringify(p.receipt)), p.secretArtifact.bytes, lock.receiptArtifact.bytes)).rejects.toThrow(/exact/);
  });
});
