import { describe, expect, it } from "vitest";
import { safeTransferCsvFilename } from "./filename";

describe("safeTransferCsvFilename", () => {
  it("leaves ordinary filenames unchanged", () => {
    expect(safeTransferCsvFilename("study-blinded_file 01.csv"))
      .toBe("study-blinded_file 01.csv");
  });

  it("accepts the usual downloaded copy filename without changing file bytes", () => {
    expect(safeTransferCsvFilename("synthetic_blinded(1).csv"))
      .toBe("synthetic_blinded_1_.csv");
  });

  it("neutralizes traversal and preserves a safe CSV extension", () => {
    expect(safeTransferCsvFilename("../../test.csv")).toBe("test.csv");
    expect(safeTransferCsvFilename("analysis.CSV")).toBe("analysis.csv");
  });

  it("rejects a non-CSV selection", () => {
    expect(() => safeTransferCsvFilename("secret.json")).toThrow("Choose a CSV file");
  });
});
