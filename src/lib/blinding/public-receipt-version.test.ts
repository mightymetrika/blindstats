import { describe, expect, it } from "vitest";

import { createBlindedPackage } from "./blinding-package";
import { createMultiBlindedPackage } from "./multi-blinding";
import {
  parseSupportedBlindingReceiptBytes,
  registrationRpcForBlindingReceipt,
} from "./public-receipt-version";

const encode = (text: string) => new TextEncoder().encode(text);
const SOURCE = encode("id,treatment,site\n1,Active,North\n2,Control,South\n");
const DATE = new Date("2026-11-19T18:00:00.000Z");

function bytes(value: unknown): Uint8Array {
  return encode(`${JSON.stringify(value, null, 2)}\n`);
}

describe("public receipt registration dispatch", () => {
  it("continues routing validated historical 0.3 receipts to the original RPC", async () => {
    const pkg = await createBlindedPackage(SOURCE, "treatment", DATE);
    const receipt = parseSupportedBlindingReceiptBytes(pkg.receiptArtifact.bytes);
    expect(receipt.schemaVersion).toBe("0.3");
    expect(registrationRpcForBlindingReceipt(receipt)).toBe("register_blinding_transformation");
  });

  it("routes validated 0.4 multi-column receipts to the separate RPC", async () => {
    const pkg = await createMultiBlindedPackage(SOURCE, ["treatment", "site"], DATE);
    const receipt = parseSupportedBlindingReceiptBytes(pkg.receiptArtifact.bytes);
    expect(receipt.schemaVersion).toBe("0.4");
    expect(registrationRpcForBlindingReceipt(receipt)).toBe("register_multi_blinding_transformation");
  });

  it("rejects unknown versions, malformed 0.4 selection, and secret fields", async () => {
    const pkg = await createMultiBlindedPackage(SOURCE, ["treatment", "site"], DATE);
    expect(() => parseSupportedBlindingReceiptBytes(bytes({
      ...pkg.receipt, schemaVersion: "0.5",
    }))).toThrow("Unsupported");
    expect(() => parseSupportedBlindingReceiptBytes(bytes({
      ...pkg.receipt, selectedColumns: [pkg.receipt.selectedColumns[0]],
    }))).toThrow("two or more");
    expect(() => parseSupportedBlindingReceiptBytes(bytes({
      ...pkg.receipt, keyHex: pkg.secret.keyHex,
    }))).toThrow("unexpected structure");
    expect(() => parseSupportedBlindingReceiptBytes(bytes({
      ...pkg.receipt, selectedColumns: [
        pkg.receipt.selectedColumns[0], pkg.receipt.selectedColumns[0],
      ],
    }))).toThrow("unique");
  });
});
