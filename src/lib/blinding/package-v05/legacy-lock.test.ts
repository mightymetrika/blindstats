import { describe, expect, it } from "vitest";
import { createBlindedPackage } from "../blinding-package";
import { createMultiBlindedPackage } from "../multi-blinding";
import { sha256Hex } from "../hashing";
import { createResearchAnalysisLock, supportedBlindingReference } from "./legacy-lock";
import { verifyLockedArtifacts } from "./analysis-lock";
const bytes = (text: string) => new TextEncoder().encode(text);

describe("v0.5 locks for historical transformations", () => {
  it("retains original v0.3 and v0.4 receipt bytes and blinded hashes", async () => {
    const source = bytes("arm,id\nA,1\nB,2\n");
    const old = [await createBlindedPackage(source, "arm"), await createMultiBlindedPackage(source, ["arm"])];
    for (const p of old) {
      const artifacts = [{ filename: "analysis.R", bytes: bytes("mean(x)") }, { filename: "report.md", bytes: bytes("Result") }];
      const lock = await createResearchAnalysisLock(p.receiptArtifact.bytes, artifacts);
      expect(lock.receipt.blinding.schemaVersion).toBe(p.receipt.schemaVersion);
      expect(lock.receipt.blinding.blindingReceiptSha256).toBe(await sha256Hex(p.receiptArtifact.bytes));
      expect(lock.receipt.blinding.datasetCommitmentSha256).toBe(p.receipt.blindedArtifact.sha256);
      await expect(verifyLockedArtifacts(lock.receiptArtifact.bytes, artifacts, await supportedBlindingReference(p.receiptArtifact.bytes))).resolves.toEqual(lock.receipt);
    }
  });
});
