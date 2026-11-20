import { describe, expect, it } from "vitest";
import { createBlindedPackage } from "./blinding-package";
import { createMultiBlindedPackage } from "./multi-blinding";
import { createSupportedUnblindingPackage } from "./supported-unblinding";
import { createMultiAnalysisLockPackage } from "./multi-unblinding";
import { createAnalysisLockPackage } from "./analysis-lock";

const bytes = (value: string) => new TextEncoder().encode(value);
const source = bytes("id,arm,site,outcome\n1,Control,North,12\n2,Treatment,South,19\n3,Control,North,14\n");

 describe("version-aware browser-local unblinding", () => {
  it("releases multiple columns with the exact v0.4 lock and refuses a mismatched secret", async () => {
    const multi = await createMultiBlindedPackage(source, ["arm", "site"]);
    const lock = await createMultiAnalysisLockPackage(multi.receiptArtifact.bytes,
      { filename: "analysis.Rmd", bytes: bytes("blinded analysis") });
    const released = await createSupportedUnblindingPackage(
      multi.receiptArtifact.bytes, multi.secretArtifact.bytes, lock.receiptArtifact.bytes);
    expect(released.receipt.schemaVersion).toBe("0.4");
    if (released.receipt.schemaVersion !== "0.4") throw new Error("Expected multi receipt");
    expect(released.receipt.releasedMappings.map((item) => item.column)).toEqual(["arm", "site"]);
    const wrong = await createMultiBlindedPackage(source, ["arm", "site"]);
    await expect(createSupportedUnblindingPackage(
      multi.receiptArtifact.bytes, wrong.secretArtifact.bytes, lock.receiptArtifact.bytes,
    )).rejects.toThrow("identifier");
  });
  it("retains v0.3 release of one column", async () => {
    const old = await createBlindedPackage(source, "arm");
    const lock = await createAnalysisLockPackage(old.receiptArtifact.bytes,
      { filename: "analysis.Rmd", bytes: bytes("blinded analysis") });
    const released = await createSupportedUnblindingPackage(
      old.receiptArtifact.bytes, old.secretArtifact.bytes, lock.receiptArtifact.bytes);
    expect(released.receipt.schemaVersion).toBe("0.3");
    if (released.receipt.schemaVersion !== "0.3") throw new Error("Expected historical receipt");
    expect(released.receipt.selectedColumn).toBe("arm");
  });
  it("rejects unsupported public receipt versions", async () => {
    await expect(createSupportedUnblindingPackage(
      bytes('{"schemaVersion":"9"}'), bytes("secret"), null,
    )).rejects.toThrow("Unsupported");
  });
});
