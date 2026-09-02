import { describe, expect, it } from "vitest";

import { parseCsvBytes } from "./csv";
import { sha256Hex } from "./hashing";
import { createBlindedPackage } from "./blinding-package";

const encoder = new TextEncoder();

const sourceText =
  "participant_id,treatment,outcome,note\n" +
  'P001,Treatment,12.4,"first, participant"\n' +
  "P002,Control,10.1,\n" +
  "P003,Treatment,11.8,follow-up\n" +
  "P004,Control,9.9,complete\n";

const createdAt = new Date("2026-09-02T02:30:00.000Z");

describe("createBlindedPackage", () => {
  it("runs the complete CSV-to-blinded-package workflow", async () => {
    const sourceBytes = encoder.encode(sourceText);

    const result = await createBlindedPackage(
      sourceBytes,
      "treatment",
      createdAt,
    );

    expect(result.source.columns).toEqual([
      "participant_id",
      "treatment",
      "outcome",
      "note",
    ]);
    expect(result.source.rowCount).toBe(4);
    expect(result.source.columnCount).toBe(4);

    expect(result.blinded.rows).toHaveLength(4);
    expect(result.receipt.selectedColumn).toBe("treatment");
    expect(result.receipt.categoryCount).toBe(2);
    expect(result.receipt.createdAt).toBe(createdAt.toISOString());
    expect(result.key.mapping).toHaveLength(2);
  });

  it("applies the private key mapping consistently to every selected-column value", async () => {
    const sourceBytes = encoder.encode(sourceText);
    const source = parseCsvBytes(sourceBytes);

    const result = await createBlindedPackage(
      sourceBytes,
      "treatment",
      createdAt,
    );

    const lookup = new Map(
      result.key.mapping.map((entry) => [
        entry.original,
        entry.blinded,
      ]),
    );

    source.rows.forEach((sourceRow, index) => {
      const originalValue = sourceRow.treatment;

      expect(originalValue).not.toBeNull();
      expect(result.blinded.rows[index].treatment).toBe(
        lookup.get(originalValue as string),
      );
    });

    expect(
      new Set(result.key.mapping.map((entry) => entry.blinded)),
    ).toEqual(new Set(["Group_A", "Group_B"]));
  });

  it("preserves row order, unrelated values, and missing cells", async () => {
    const sourceBytes = encoder.encode(sourceText);
    const source = parseCsvBytes(sourceBytes);

    const result = await createBlindedPackage(
      sourceBytes,
      "treatment",
      createdAt,
    );

    expect(
      result.blinded.rows.map((row) => row.participant_id),
    ).toEqual(
      source.rows.map((row) => row.participant_id),
    );

    result.blinded.rows.forEach((row, index) => {
      expect(row.participant_id).toBe(
        source.rows[index].participant_id,
      );
      expect(row.outcome).toBe(source.rows[index].outcome);
      expect(row.note).toBe(source.rows[index].note);
    });

    expect(result.blinded.rows[1].note).toBeNull();
  });

  it("hashes the exact original source bytes and exact blinded download bytes", async () => {
    const sourceBytes = encoder.encode(sourceText);

    const result = await createBlindedPackage(
      sourceBytes,
      "treatment",
      createdAt,
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
    expect(result.receipt.blindedArtifact.sha256).toBe(
      result.blinded.sha256,
    );
    expect(result.key.sourceArtifactSha256).toBe(
      result.source.sha256,
    );
    expect(result.key.blindedArtifactSha256).toBe(
      result.blinded.sha256,
    );
  });

  it("returns blinded bytes that exactly match the returned blinded text", async () => {
    const result = await createBlindedPackage(
      encoder.encode(sourceText),
      "treatment",
      createdAt,
    );

    expect(result.blinded.bytes).toEqual(
      encoder.encode(result.blinded.text),
    );
  });

  it("links receipt and private key with one transformation identity", async () => {
    const result = await createBlindedPackage(
      encoder.encode(sourceText),
      "treatment",
      createdAt,
    );

    expect(result.receipt.transformationId).toBe(
      result.key.transformationId,
    );
    expect(result.receipt.createdAt).toBe(result.key.createdAt);
    expect(result.receipt.createdAt).toBe(
      "2026-09-02T02:30:00.000Z",
    );
  });

  it("serializes a public receipt that does not reveal mapping values", async () => {
    const result = await createBlindedPackage(
      encoder.encode(sourceText),
      "treatment",
      createdAt,
    );

    for (const entry of result.key.mapping) {
      expect(result.receiptArtifact.text).not.toContain(
        entry.original,
      );
      expect(result.receiptArtifact.text).not.toContain(
        entry.blinded,
      );
    }

    expect(result.receiptArtifact.text).not.toContain(
      '"mapping"',
    );
  });

  it("serializes the complete mapping only into the private key artifact", async () => {
    const result = await createBlindedPackage(
      encoder.encode(sourceText),
      "treatment",
      createdAt,
    );

    const serializedKey = JSON.parse(result.keyArtifact.text);

    expect(serializedKey.mapping).toEqual(result.key.mapping);
    expect(result.keyArtifact.bytes).toEqual(
      encoder.encode(result.keyArtifact.text),
    );
  });

  it("produces deterministic JSON serialization for the generated receipt and key objects", async () => {
    const result = await createBlindedPackage(
      encoder.encode(sourceText),
      "treatment",
      createdAt,
    );

    expect(result.receiptArtifact.text).toBe(
      `${JSON.stringify(result.receipt, null, 2)}\n`,
    );
    expect(result.keyArtifact.text).toBe(
      `${JSON.stringify(result.key, null, 2)}\n`,
    );
  });

  it("does not mutate the caller's source bytes", async () => {
    const sourceBytes = encoder.encode(sourceText);
    const snapshot = new Uint8Array(sourceBytes);

    await createBlindedPackage(
      sourceBytes,
      "treatment",
      createdAt,
    );

    expect(sourceBytes).toEqual(snapshot);
  });

  it("rejects a selected column that is absent from the source dataset", async () => {
    await expect(
      createBlindedPackage(
        encoder.encode(sourceText),
        "not_a_column",
        createdAt,
      ),
    ).rejects.toThrow(
      'Selected blinding column "not_a_column" does not exist',
    );
  });

  it("rejects a selected column with fewer than two distinct nonmissing categories", async () => {
    const singleCategorySource = encoder.encode(
      "id,treatment\n" +
        "P001,Treatment\n" +
        "P002,Treatment\n",
    );

    await expect(
      createBlindedPackage(
        singleCategorySource,
        "treatment",
        createdAt,
      ),
    ).rejects.toThrow(
      "at least two distinct nonmissing categories",
    );
  });

  it("preserves selected-column missingness while blinding observed categories", async () => {
    const sourceBytes = encoder.encode(
      "id,treatment,outcome\n" +
        "P001,Treatment,12.4\n" +
        "P002,,10.1\n" +
        "P003,Control,11.2\n",
    );

    const result = await createBlindedPackage(
      sourceBytes,
      "treatment",
      createdAt,
    );

    expect(result.blinded.rows[1].treatment).toBeNull();
    expect(result.key.mapping).toHaveLength(2);
    expect(
      result.key.mapping.some(
        (entry) => entry.original === "",
      ),
    ).toBe(false);
  });
});
