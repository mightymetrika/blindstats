import { describe, expect, it } from "vitest";

import { generateNeutralLabels } from "./labels";

describe("generateNeutralLabels", () => {
  it("generates the initial Group_<letters> sequence", () => {
    expect(generateNeutralLabels(4)).toEqual([
      "Group_A",
      "Group_B",
      "Group_C",
      "Group_D",
    ]);
  });

  it("supports more than 26 categories without duplicate labels", () => {
    const labels = generateNeutralLabels(28);

    expect(labels.slice(24)).toEqual([
      "Group_Y",
      "Group_Z",
      "Group_AA",
      "Group_AB",
    ]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("returns an empty label set when zero labels are requested", () => {
    expect(generateNeutralLabels(0)).toEqual([]);
  });

  it("rejects negative and non-integer counts", () => {
    expect(() => generateNeutralLabels(-1)).toThrow(RangeError);
    expect(() => generateNeutralLabels(1.5)).toThrow(RangeError);
  });
});
