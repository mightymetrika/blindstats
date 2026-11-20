import { describe, expect, it } from "vitest";

import { createBlindedPackage } from "./blinding-package";
import { parseBlindingReceiptBytes } from "./blinding-receipt";
import { parseCsvBytes } from "./csv";
import { sha256Hex } from "./hashing";
import { openBlindingMapping } from "./mapping-crypto";
import {
  createMultiBlindedPackage,
  openMultiBlindingMapping,
  parseMultiBlindingReceiptBytes,
  parseMultiUnblindingSecretBytes,
} from "./multi-blinding";
import {
  createMultiAnalysisLockPackage,
  createMultiUnblindingPackage,
} from "./multi-unblinding";

const encode = (text: string) => new TextEncoder().encode(text);
const artifact = (value: unknown) => encode(`${JSON.stringify(value, null, 2)}\n`);
const SOURCE =
  "id,treatment,site,outcome,subgroup\n" +
  "1,Active,North,20,Adult\n" +
  "2,Placebo,South,18,Child\n" +
  "3,Active,,22,Child\n" +
  "4,Placebo,North,19,Adult\n";
const CREATED_AT = new Date("2026-11-19T17:00:00.000Z");

async function multiFixture() {
  return createMultiBlindedPackage(encode(SOURCE), ["site", "treatment"], CREATED_AT);
}

describe("browser-local v0.4 one-or-more-column blinding", () => {
  it("blinds selected columns independently and retains all other values, row order, and missingness", async () => {
    const pkg = await multiFixture();
    expect(pkg.receipt.schemaVersion).toBe("0.4");
    expect(pkg.secret.schemaVersion).toBe("0.4");
    expect(pkg.receipt.selectedColumns).toEqual([
      { column: "treatment", categoryCount: 2 },
      { column: "site", categoryCount: 2 },
    ]);
    expect(pkg.receipt.sourceArtifact.sha256).toBe(await sha256Hex(encode(SOURCE)));
    expect(pkg.receipt.blindedArtifact.sha256).toBe(await sha256Hex(pkg.blinded.bytes));
    const restored = await openMultiBlindingMapping(pkg.receipt, pkg.secret);
    const source = parseCsvBytes(encode(SOURCE));
    const blind = parseCsvBytes(pkg.blinded.bytes);
    const maps = new Map(restored.map(({ column, mapping }) => [
      column, new Map(mapping.map(({ original, blinded }) => [original, blinded])),
    ]));
    expect(blind.columns).toEqual(source.columns);
    source.rows.forEach((row, i) => {
      expect(blind.rows[i].id).toBe(row.id);
      expect(blind.rows[i].outcome).toBe(row.outcome);
      expect(blind.rows[i].subgroup).toBe(row.subgroup);
      for (const column of ["treatment", "site"]) {
        const value = row[column];
        expect(blind.rows[i][column]).toBe(value === null ? null : maps.get(column)?.get(value));
      }
    });
    for (const item of restored) {
      expect(new Set(item.mapping.map((entry) => entry.blinded))).toEqual(
        new Set(["Group_A", "Group_B"]),
      );
    }
  });

  it("uses the exact v0.4 artifact chain for a single selected variable", async () => {
    const sourceBytes = encode(SOURCE);
    const pkg = await createMultiBlindedPackage(sourceBytes, ["treatment"], CREATED_AT);
    expect(pkg.receipt.schemaVersion).toBe("0.4");
    expect(pkg.receipt.selectedColumns).toEqual([{ column: "treatment", categoryCount: 2 }]);
    const unblinded = await openMultiBlindingMapping(pkg.receipt, pkg.secret);
    expect(unblinded).toHaveLength(1);
    expect(unblinded[0].column).toBe("treatment");
    const source = parseCsvBytes(sourceBytes);
    const blinded = parseCsvBytes(pkg.blinded.bytes);
    const lookup = new Map(unblinded[0].mapping.map((entry) => [entry.original, entry.blinded]));
    source.rows.forEach((row, index) => {
      expect(blinded.rows[index].treatment).toBe(lookup.get(row.treatment!));
      for (const column of ["id", "site", "outcome", "subgroup"]) {
        expect(blinded.rows[index][column]).toBe(row[column]);
      }
    });
    const lock = await createMultiAnalysisLockPackage(
      pkg.receiptArtifact.bytes,
      { filename: "analysis.Rmd", bytes: encode("synthetic blinded analysis") },
      CREATED_AT,
    );
    const released = await createMultiUnblindingPackage(
      pkg.receiptArtifact.bytes,
      pkg.secretArtifact.bytes,
      lock.receiptArtifact.bytes,
      CREATED_AT,
    );
    expect(released.receipt.selectedColumns).toEqual(pkg.receipt.selectedColumns);
    expect(released.receipt.releasedMappings).toEqual(unblinded);
    expect(released.receipt.lockId).toBe(lock.receipt.lockId);
    expect(released.receipt.artifacts.blindingReceiptSha256)
      .toBe(await sha256Hex(pkg.receiptArtifact.bytes));
    const noLock = await createMultiUnblindingPackage(
      pkg.receiptArtifact.bytes, pkg.secretArtifact.bytes, null, CREATED_AT,
    );
    expect(noLock.receipt.lockId).toBeNull();
    expect(noLock.receipt.releasedMappings).toEqual(unblinded);
  });

  it("supports a CSV with only one categorical column", async () => {
    const source = encode("arm\nControl\nTreatment\nControl\n");
    const pkg = await createMultiBlindedPackage(source, ["arm"], CREATED_AT);
    expect(pkg.receipt.columnCount).toBe(1);
    expect(pkg.receipt.selectedColumns).toEqual([{ column: "arm", categoryCount: 2 }]);
    const mappings = await openMultiBlindingMapping(pkg.receipt, pkg.secret);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].column).toBe("arm");
    expect(pkg.blinded.columns).toEqual(["arm"]);
    expect(pkg.blinded.rows).toHaveLength(3);
  });

  it("keeps plaintext category values and neutral labels out of public receipt and secret", async () => {
    const pkg = await multiFixture();
    for (const label of ["Active", "Placebo", "North", "South", "Group_A", "Group_B"]) {
      expect(pkg.receiptArtifact.text).not.toContain(label);
      expect(pkg.secretArtifact.text).not.toContain(label);
    }
    expect(pkg.secret).not.toHaveProperty("mapping");
    expect(parseMultiBlindingReceiptBytes(pkg.receiptArtifact.bytes)).toEqual(pkg.receipt);
    expect(parseMultiUnblindingSecretBytes(pkg.secretArtifact.bytes)).toEqual(pkg.secret);
  });

  it("rejects empty, duplicate, unknown, and low-cardinality selections", async () => {
    await expect(createMultiBlindedPackage(encode(SOURCE), [])).rejects.toThrow("at least one");
    await expect(createMultiBlindedPackage(encode(SOURCE), ["site", "site"])).rejects.toThrow("distinct");
    await expect(createMultiBlindedPackage(encode(SOURCE), ["treatment", "not_found"])).rejects.toThrow("does not exist");
    await expect(createMultiBlindedPackage(encode(SOURCE), ["treatment", "id", "missing"])).rejects.toThrow("does not exist");
    await expect(createMultiBlindedPackage(encode("a,b,c\nx,1,2\ny,1,3\n"), ["a", "b"])).rejects.toThrow("two distinct");
  });

  it("rejects malformed public metadata and extra keys instead of quietly accepting them", async () => {
    const pkg = await multiFixture();
    expect(() => parseMultiBlindingReceiptBytes(artifact({
      ...pkg.receipt, selectedColumns: [pkg.receipt.selectedColumns[0], pkg.receipt.selectedColumns[0]],
    }))).toThrow("unique");
    expect(() => parseMultiBlindingReceiptBytes(artifact({
      ...pkg.receipt, selectedColumns: [{ ...pkg.receipt.selectedColumns[0], mapping: ["SECRET"] }, pkg.receipt.selectedColumns[1]],
    }))).toThrow("unexpected structure");
    expect(() => parseMultiUnblindingSecretBytes(artifact({ ...pkg.secret, mapping: [] }))).toThrow("unexpected structure");
    expect(() => parseMultiBlindingReceiptBytes(artifact({ ...pkg.receipt, schemaVersion: "0.3" }))).toThrow("Unsupported");
  });

  it("fails closed on swapped secrets, ciphertext changes, and authenticated metadata tampering", async () => {
    const first = await multiFixture();
    const second = await multiFixture();
    await expect(openMultiBlindingMapping(first.receipt, second.secret)).rejects.toThrow("identifier");
    const cipher = first.receipt.sealedMapping.ciphertextHex;
    const flip = cipher.endsWith("f") ? "e" : "f";
    await expect(openMultiBlindingMapping({
      ...first.receipt,
      sealedMapping: { ...first.receipt.sealedMapping, ciphertextHex: cipher.slice(0, -1) + flip },
    }, first.secret)).rejects.toThrow("could not authenticate and decrypt");
    await expect(openMultiBlindingMapping({
      ...first.receipt,
      selectedColumns: [
        { ...first.receipt.selectedColumns[0], categoryCount: 3 },
        first.receipt.selectedColumns[1],
      ],
    }, first.secret)).rejects.toThrow("could not authenticate and decrypt");
    await expect(openMultiBlindingMapping({
      ...first.receipt, sourceArtifact: { sha256: "0".repeat(64) },
    }, first.secret)).rejects.toThrow("could not authenticate and decrypt");
  });

  it("creates a linked v0.4 lock and authorized release of every mapping", async () => {
    const pkg = await multiFixture();
    const lock = await createMultiAnalysisLockPackage(pkg.receiptArtifact.bytes,
      { filename: "analysis.Rmd", bytes: encode("Blinded analysis") }, CREATED_AT);
    const released = await createMultiUnblindingPackage(
      pkg.receiptArtifact.bytes, pkg.secretArtifact.bytes, lock.receiptArtifact.bytes, CREATED_AT,
    );
    expect(released.receipt.releasedMappings.map((item) => item.column)).toEqual(["treatment", "site"]);
    expect(released.receipt.lockId).toBe(lock.receipt.lockId);
    expect(released.receipt.artifacts.blindingReceiptSha256).toBe(await sha256Hex(pkg.receiptArtifact.bytes));
    expect(released.receipt.artifacts.analysisLockReceiptSha256).toBe(await sha256Hex(lock.receiptArtifact.bytes));
    expect(released.receiptArtifact.text).toContain("Placebo");
    expect(released.receiptArtifact.text).toContain("South");
    const noLock = await createMultiUnblindingPackage(
      pkg.receiptArtifact.bytes, pkg.secretArtifact.bytes, null, CREATED_AT,
    );
    expect(noLock.receipt.lockId).toBeNull();
    expect(noLock.receipt.releasedMappings).toEqual(released.receipt.releasedMappings);
  });

  it("refuses a changed receipt after analysis lock even when underlying metadata remains the same", async () => {
    const pkg = await multiFixture();
    const lock = await createMultiAnalysisLockPackage(pkg.receiptArtifact.bytes,
      { filename: "analysis.Rmd", bytes: encode("Analysis") }, CREATED_AT);
    await expect(createMultiUnblindingPackage(
      encode(JSON.stringify(pkg.receipt)), pkg.secretArtifact.bytes,
      lock.receiptArtifact.bytes, CREATED_AT,
    )).rejects.toThrow("exact blinding receipt");
  });

  it("preserves historical v0.3 single-column generation, parsing, and decryption", async () => {
    const old = await createBlindedPackage(encode(SOURCE), "treatment", CREATED_AT);
    expect(old.receipt.schemaVersion).toBe("0.3");
    expect(parseBlindingReceiptBytes(old.receiptArtifact.bytes)).toEqual(old.receipt);
    const mapping = await openBlindingMapping(old.receipt, old.secret);
    expect(mapping).toHaveLength(2);
    expect(new Set(mapping.map((item) => item.original))).toEqual(new Set(["Active", "Placebo"]));
  });
});
