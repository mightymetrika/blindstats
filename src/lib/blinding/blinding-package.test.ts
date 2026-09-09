import { describe, expect, it } from "vitest";

import { createBlindedPackage } from "./blinding-package";
import { parseCsvBytes } from "./csv";
import { sha256Hex } from "./hashing";
import { openBlindingMapping } from "./mapping-crypto";

const encoder = new TextEncoder();

const sourceText =
  "id,treatment,outcome\n" +
  "1,Treatment,12\n" +
  "2,Control,10\n" +
  "3,Treatment,11\n";

const createdAt = new Date(
  "2026-09-08T23:00:00.000Z",
);

describe("createBlindedPackage", () => {
  it("creates a linked blinded CSV, public receipt, and mapping-free unblinding secret", async () => {
    const sourceBytes = encoder.encode(sourceText);

    const result = await createBlindedPackage(
      sourceBytes,
      "treatment",
      createdAt,
    );

    expect(result.receipt.schemaVersion).toBe("0.3");
    expect(result.secret.schemaVersion).toBe("0.3");
    expect(result.receipt.transformationId).toBe(
      result.secret.transformationId,
    );
    expect(result.source.sha256).toBe(
      await sha256Hex(sourceBytes),
    );
    expect(result.blinded.sha256).toBe(
      await sha256Hex(result.blinded.bytes),
    );
    expect(result.receipt.sourceArtifact.sha256).toBe(
      result.source.sha256,
    );
    expect(
      result.receipt.blindedArtifact.sha256,
    ).toBe(result.blinded.sha256);
    expect(result.secret).not.toHaveProperty("mapping");
  });

  it("never serializes plaintext mapping values into either generated JSON artifact", async () => {
    const result = await createBlindedPackage(
      encoder.encode(sourceText),
      "treatment",
      createdAt,
    );

    for (const value of ["Treatment", "Control"]) {
      expect(result.receiptArtifact.text).not.toContain(
        value,
      );
      expect(result.secretArtifact.text).not.toContain(
        value,
      );
    }

    for (const label of ["Group_A", "Group_B"]) {
      expect(result.receiptArtifact.text).not.toContain(
        label,
      );
      expect(result.secretArtifact.text).not.toContain(
        label,
      );
    }
  });

  it("allows the sealed mapping to be recovered only with the matching generated secret", async () => {
    const result = await createBlindedPackage(
      encoder.encode(sourceText),
      "treatment",
      createdAt,
    );

    const mapping = await openBlindingMapping(
      result.receipt,
      result.secret,
    );

    expect(
      new Set(mapping.map((entry) => entry.original)),
    ).toEqual(new Set(["Treatment", "Control"]));
    expect(
      new Set(mapping.map((entry) => entry.blinded)),
    ).toEqual(new Set(["Group_A", "Group_B"]));
    expect(mapping).toHaveLength(2);
  });

  it("applies the encrypted private mapping consistently to the selected column", async () => {
    const result = await createBlindedPackage(
      encoder.encode(sourceText),
      "treatment",
      createdAt,
    );
    const mapping = await openBlindingMapping(
      result.receipt,
      result.secret,
    );
    const mappingMap = new Map(
      mapping.map((entry) => [
        entry.original,
        entry.blinded,
      ]),
    );

    const source = parseCsvBytes(
      encoder.encode(sourceText),
    );
    const blinded = parseCsvBytes(result.blinded.bytes);

    source.rows.forEach((row, index) => {
      expect(blinded.rows[index].treatment).toBe(
        mappingMap.get(row.treatment as string),
      );
      expect(blinded.rows[index].id).toBe(row.id);
      expect(blinded.rows[index].outcome).toBe(
        row.outcome,
      );
    });
  });

  it("preserves missing selected-column values", async () => {
    const result = await createBlindedPackage(
      encoder.encode(
        "id,treatment\n1,Treatment\n2,\n3,Control\n",
      ),
      "treatment",
      createdAt,
    );

    expect(
      parseCsvBytes(result.blinded.bytes).rows[1]
        .treatment,
    ).toBeNull();
  });

  it("rejects a selected column that does not exist", async () => {
    await expect(
      createBlindedPackage(
        encoder.encode(sourceText),
        "missing_column",
        createdAt,
      ),
    ).rejects.toThrow(
      'Selected blinding column "missing_column" does not exist',
    );
  });

  it("rejects selected columns with fewer than two nonmissing categories", async () => {
    await expect(
      createBlindedPackage(
        encoder.encode(
          "id,treatment\n1,Treatment\n2,Treatment\n",
        ),
        "treatment",
        createdAt,
      ),
    ).rejects.toThrow();
  });

  it("serializes generated JSON artifacts deterministically", async () => {
    const result = await createBlindedPackage(
      encoder.encode(sourceText),
      "treatment",
      createdAt,
    );

    expect(result.receiptArtifact.text).toBe(
      `${JSON.stringify(result.receipt, null, 2)}\n`,
    );
    expect(result.secretArtifact.text).toBe(
      `${JSON.stringify(result.secret, null, 2)}\n`,
    );
    expect(result.receiptArtifact.bytes).toEqual(
      encoder.encode(result.receiptArtifact.text),
    );
    expect(result.secretArtifact.bytes).toEqual(
      encoder.encode(result.secretArtifact.text),
    );
  });
});
