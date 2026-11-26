import { describe, expect, it } from "vitest";
import { delimitedAdapter } from "./delimited";
import { adapterForFilename } from "../formats";
import { createDatasetPackage, openDatasetPackageMapping } from "../../blinding/package-v05/package";
const bytes = (text: string) => new TextEncoder().encode(text);

describe("CSV and TSV research adapters", () => {
  it("preserves textual identifiers, missingness and quoted fields", async () => {
    for (const format of ["csv", "tsv"] as const) {
      const a = delimitedAdapter(format);
      const sep = format === "csv" ? "," : "\t";
      const data = await a.parse(bytes(`id${sep}note\n001${sep}"two${sep}values"\n002${sep}\n`));
      expect(data.rows).toEqual([["001", `two${sep}values`], ["002", null]]);
      expect(await a.parse(await a.serialize(data))).toEqual(data);
    }
  });
  it("preserves trailing missing observations in one-column files", async () => {
    const a = delimitedAdapter("csv");
    const data = { variables: [{ id: "v1", name: "arm" }], rows: [["A"], ["B"], [null]] };
    expect(await a.parse(await a.serialize(data))).toEqual(data);
  });
  it("rejects formula-like output without altering values", async () => {
    const a = delimitedAdapter("csv");
    const data = await a.parse(bytes("arm,notes\nA,=1+1\nB,normal\n"));
    expect(() => a.serialize(data)).toThrow(/formula-like/);
    const numeric = await a.parse(bytes("score\n-1.5\n+2\n"));
    expect(await a.parse(await a.serialize(numeric))).toEqual(numeric);
  });
  it("links selected variables across CSV and TSV in a single package", async () => {
    const p = await createDatasetPackage([
      { datasetId: "baseline", bytes: bytes("arm,id\nA,001\nB,002\n"), adapter: adapterForFilename("baseline.csv") },
      { datasetId: "followup", bytes: bytes("study_arm\tvisit\nB\t2\n"), adapter: adapterForFilename("followup.TSV") },
    ], [{ members: [{ datasetId: "baseline", variableId: "v1" }, { datasetId: "followup", variableId: "v1" }] }]);
    const a = await delimitedAdapter("csv").parse(p.files[0].bytes);
    const b = await delimitedAdapter("tsv").parse(p.files[1].bytes);
    expect(a.rows[1][0]).toBe(b.rows[0][0]);
    expect(a.rows[0][1]).toBe("001");
    expect(await openDatasetPackageMapping(p.receiptArtifact.bytes, p.secretArtifact.bytes)).toHaveLength(1);
    expect(adapterForFilename("example.xlsx").format).toBe("xlsx");
    expect(() => adapterForFilename("unsupported.xlsm")).toThrow(/Only CSV/);
  });
});
