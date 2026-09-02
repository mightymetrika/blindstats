import { describe, expect, it } from "vitest";

import {
  createBlindingMapping,
  getDistinctNonmissingCategories,
  secureRandomInt,
  secureShuffle,
  type ObservedCategoryValue,
} from "./mapping";

describe("getDistinctNonmissingCategories", () => {
  it("keeps one copy of each nonmissing category in first-observed order", () => {
    const values: ObservedCategoryValue[] = [
      "Treatment",
      null,
      "Control",
      "Treatment",
      "Placebo",
      null,
      "Control",
    ];

    expect(getDistinctNonmissingCategories(values)).toEqual([
      "Treatment",
      "Control",
      "Placebo",
    ]);
  });
});

describe("secureRandomInt", () => {
  it("returns integers inside the requested range", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const value = secureRandomInt(7);

      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
    }
  });

  it("rejects invalid bounds", () => {
    expect(() => secureRandomInt(0)).toThrow(RangeError);
    expect(() => secureRandomInt(-1)).toThrow(RangeError);
    expect(() => secureRandomInt(1.5)).toThrow(RangeError);
    expect(() => secureRandomInt(0x1_0000_0001)).toThrow(RangeError);
  });
});

describe("secureShuffle", () => {
  it("preserves values without mutating the input array", () => {
    const input = ["Group_A", "Group_B", "Group_C", "Group_D"] as const;
    const original = [...input];

    const shuffled = secureShuffle(input);

    expect(input).toEqual(original);
    expect(shuffled).toHaveLength(input.length);
    expect([...shuffled].sort()).toEqual([...input].sort());
    expect(new Set(shuffled).size).toBe(input.length);
  });
});

describe("createBlindingMapping", () => {
  it("creates one unique neutral label per distinct nonmissing category", () => {
    const values: ObservedCategoryValue[] = [
      "Treatment",
      "Control",
      "Treatment",
      null,
      "Placebo",
      "Control",
    ];
    const originalValues = [...values];

    const mapping = createBlindingMapping(values);

    expect(values).toEqual(originalValues);
    expect(mapping.map((entry) => entry.original)).toEqual([
      "Treatment",
      "Control",
      "Placebo",
    ]);
    expect(mapping.map((entry) => entry.blinded).sort()).toEqual([
      "Group_A",
      "Group_B",
      "Group_C",
    ]);
    expect(new Set(mapping.map((entry) => entry.original)).size).toBe(
      mapping.length,
    );
    expect(new Set(mapping.map((entry) => entry.blinded)).size).toBe(
      mapping.length,
    );
  });

  it("supports mappings with more than 26 categories", () => {
    const values = Array.from({ length: 28 }, (_, index) => `Category_${index}`);

    const mapping = createBlindingMapping(values);
    const blindedLabels = new Set(mapping.map((entry) => entry.blinded));

    expect(mapping).toHaveLength(28);
    expect(blindedLabels.size).toBe(28);
    expect(blindedLabels.has("Group_Z")).toBe(true);
    expect(blindedLabels.has("Group_AA")).toBe(true);
    expect(blindedLabels.has("Group_AB")).toBe(true);
  });

  it("rejects inputs with fewer than two distinct nonmissing categories", () => {
    expect(() => createBlindingMapping([])).toThrow(
      "at least two distinct nonmissing categories",
    );
    expect(() => createBlindingMapping([null, null])).toThrow(
      "at least two distinct nonmissing categories",
    );
    expect(() => createBlindingMapping(["Control", "Control", null])).toThrow(
      "at least two distinct nonmissing categories",
    );
  });
});
