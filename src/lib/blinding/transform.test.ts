import { describe, expect, it } from "vitest";

import { applyBlindingMapping } from "./transform";
import type {
  BlindingMappingEntry,
  DatasetRow,
} from "./types";

const mapping: BlindingMappingEntry[] = [
  {
    original: "Treatment",
    blinded: "Group_B",
  },
  {
    original: "Control",
    blinded: "Group_A",
  },
];

describe("applyBlindingMapping", () => {
  it("applies the mapping consistently without changing row order", () => {
    const rows: DatasetRow[] = [
      {
        participant_id: "P001",
        treatment: "Treatment",
        outcome: "12.4",
      },
      {
        participant_id: "P002",
        treatment: "Control",
        outcome: "10.1",
      },
      {
        participant_id: "P003",
        treatment: "Treatment",
        outcome: "11.8",
      },
    ];

    const blinded = applyBlindingMapping(rows, "treatment", mapping);

    expect(blinded).toEqual([
      {
        participant_id: "P001",
        treatment: "Group_B",
        outcome: "12.4",
      },
      {
        participant_id: "P002",
        treatment: "Group_A",
        outcome: "10.1",
      },
      {
        participant_id: "P003",
        treatment: "Group_B",
        outcome: "11.8",
      },
    ]);
    expect(blinded.map((row) => row.participant_id)).toEqual([
      "P001",
      "P002",
      "P003",
    ]);
  });

  it("preserves missing values in the selected column", () => {
    const rows: DatasetRow[] = [
      {
        participant_id: "P001",
        treatment: null,
      },
      {
        participant_id: "P002",
        treatment: "Control",
      },
    ];

    const blinded = applyBlindingMapping(rows, "treatment", mapping);

    expect(blinded[0].treatment).toBeNull();
    expect(blinded[1].treatment).toBe("Group_A");
  });

  it("preserves column order and unrelated values", () => {
    const rows: DatasetRow[] = [
      {
        participant_id: "P001",
        treatment: "Treatment",
        site: "North",
        outcome: "12.4",
      },
    ];

    const blinded = applyBlindingMapping(rows, "treatment", mapping);

    expect(Object.keys(blinded[0])).toEqual([
      "participant_id",
      "treatment",
      "site",
      "outcome",
    ]);
    expect(blinded[0].participant_id).toBe("P001");
    expect(blinded[0].site).toBe("North");
    expect(blinded[0].outcome).toBe("12.4");
  });

  it("does not mutate the source array or source rows", () => {
    const firstRow: DatasetRow = {
      participant_id: "P001",
      treatment: "Treatment",
      outcome: "12.4",
    };
    const secondRow: DatasetRow = {
      participant_id: "P002",
      treatment: null,
      outcome: "10.1",
    };
    const rows: DatasetRow[] = [firstRow, secondRow];

    const sourceSnapshot = structuredClone(rows);
    const blinded = applyBlindingMapping(rows, "treatment", mapping);

    expect(rows).toEqual(sourceSnapshot);
    expect(blinded).not.toBe(rows);
    expect(blinded[0]).not.toBe(firstRow);
    expect(blinded[1]).not.toBe(secondRow);
  });

  it("preserves row and column counts", () => {
    const rows: DatasetRow[] = [
      {
        participant_id: "P001",
        treatment: "Treatment",
        outcome: "12.4",
      },
      {
        participant_id: "P002",
        treatment: "Control",
        outcome: "10.1",
      },
    ];

    const blinded = applyBlindingMapping(rows, "treatment", mapping);

    expect(blinded).toHaveLength(rows.length);
    expect(Object.keys(blinded[0])).toHaveLength(Object.keys(rows[0]).length);
    expect(Object.keys(blinded[1])).toHaveLength(Object.keys(rows[1]).length);
  });

  it("fails rather than exposing a nonmissing category missing from the mapping", () => {
    const rows: DatasetRow[] = [
      {
        participant_id: "P001",
        treatment: "Placebo",
      },
    ];

    expect(() => applyBlindingMapping(rows, "treatment", mapping)).toThrow(
      "not present in the blinding mapping",
    );
  });

  it("fails if a row does not contain the selected column", () => {
    const rows: DatasetRow[] = [
      {
        participant_id: "P001",
        treatment: "Treatment",
      },
      {
        participant_id: "P002",
        outcome: "10.1",
      },
    ];

    expect(() => applyBlindingMapping(rows, "treatment", mapping)).toThrow(
      "does not contain the selected blinding column",
    );
  });

  it("rejects a mapping with duplicate original categories", () => {
    const invalidMapping: BlindingMappingEntry[] = [
      {
        original: "Treatment",
        blinded: "Group_A",
      },
      {
        original: "Treatment",
        blinded: "Group_B",
      },
    ];

    expect(() =>
      applyBlindingMapping(
        [{ treatment: "Treatment" }],
        "treatment",
        invalidMapping,
      ),
    ).toThrow("duplicate original categories");
  });

  it("rejects a mapping with duplicate blinded labels", () => {
    const invalidMapping: BlindingMappingEntry[] = [
      {
        original: "Treatment",
        blinded: "Group_A",
      },
      {
        original: "Control",
        blinded: "Group_A",
      },
    ];

    expect(() =>
      applyBlindingMapping(
        [{ treatment: "Treatment" }],
        "treatment",
        invalidMapping,
      ),
    ).toThrow("duplicate blinded labels");
  });

  it("rejects a mapping with fewer than two entries", () => {
    const invalidMapping: BlindingMappingEntry[] = [
      {
        original: "Treatment",
        blinded: "Group_A",
      },
    ];

    expect(() =>
      applyBlindingMapping(
        [{ treatment: "Treatment" }],
        "treatment",
        invalidMapping,
      ),
    ).toThrow("at least two entries");
  });
});
