// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TextReader, TextWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js";
import { xlsxAdapter } from "./xlsx";
import { delimitedAdapter } from "./delimited";
import { createDatasetPackage, openDatasetPackageMapping } from "../../blinding/package-v05/package";
import type { ResearchDataset } from "../types";

const data: ResearchDataset = { variables: [{ id: "v1", name: "arm" }, { id: "v2", name: "score" }, { id: "v3", name: "flag" }], rows: [["A", 1.5, true], ["B", 0, false], [null, null, null]] };
const worksheet = "xl/worksheets/sheet1.xml";
async function parts(bytes: Uint8Array) {
  const zip = new ZipReader(new Uint8ArrayReader(bytes), { useWebWorkers: false });
  const map = new Map<string, string>();
  try { for (const e of await zip.getEntries()) if (!e.directory) map.set(e.filename, await e.getData(new TextWriter())); }
  finally { await zip.close(); }
  return map;
}
async function zipParts(map: Map<string, string>) {
  const out = new Uint8ArrayWriter();
  const zip = new ZipWriter(out, { useWebWorkers: false });
  try { for (const [name, content] of map) await zip.add(name, new TextReader(content)); }
  finally { await zip.close(); }
  return out.getData();
}
async function change(part: string, transform: (s: string) => string) {
  const map = await parts(await xlsxAdapter.serialize(data));
  map.set(part, transform(map.get(part) ?? ""));
  return zipParts(map);
}
describe("restricted XLSX dataset adapter", () => {
  it("round trips typed values and trailing missing observations in a new workbook", async () => {
    const source = await xlsxAdapter.serialize(data);
    expect(await xlsxAdapter.parse(source)).toEqual(data);
    const map = await parts(source);
    expect(map.size).toBe(5);
    expect(map.get(worksheet)).toContain('t="b"');
  });
  it("imports an independently generated plain workbook and discards its metadata on export", async () => {
    const fixture = new Uint8Array(readFileSync(join(process.cwd(), "src/lib/datasets/adapters/fixtures/synthetic-plain.xlsx")));
    const parsed = await xlsxAdapter.parse(fixture);
    expect(parsed).toEqual({ ...data, rows: data.rows.slice(0, 2) });
    const exported = await parts(await xlsxAdapter.serialize(parsed));
    expect(exported.has("docProps/core.xml")).toBe(false);
    expect(exported.get("xl/workbook.xml")).not.toContain("Synthetic");
  });
  it("accepts only an empty workbook protection placeholder and never copies it", async () => {
    const workbook = "xl/workbook.xml";
    const withProtection = (markup: string) => change(workbook, (s) => s.replace("<sheets>", `${markup}<sheets>`));
    const parsed = await xlsxAdapter.parse(await withProtection("<workbookProtection/>"));
    expect(parsed).toEqual(data);
    expect((await parts(await xlsxAdapter.serialize(parsed))).get(workbook)).not.toContain("workbookProtection");
    for (const markup of [
      '<workbookProtection lockStructure="1"/>',
      '<workbookProtection workbookPassword="ABCD"/>',
      '<workbookProtection><unexpected/></workbookProtection>',
      '<workbookProtection>unexpected</workbookProtection>',
      '<workbookProtection/><workbookProtection/>',
    ]) await expect(xlsxAdapter.parse(await withProtection(markup))).rejects.toThrow(/workbookProtection/);
  });
  it("writes literal formula-like text as text, not formulas", async () => {
    const d = { ...data, rows: [["=1+1", 1, true], [" <&>\r\n ", 0, false]] };
    const source = await xlsxAdapter.serialize(d);
    expect(await xlsxAdapter.parse(source)).toEqual(d);
    expect((await parts(source)).get(worksheet)).not.toContain("<f>");
  });
  it("links textual categories across CSV and XLSX while retaining native numeric and Boolean cells", async () => {
    const p = await createDatasetPackage([{ datasetId: "csv", adapter: delimitedAdapter("csv"), bytes: new TextEncoder().encode("arm\nA\nB\n") }, { datasetId: "excel", adapter: xlsxAdapter, bytes: await xlsxAdapter.serialize(data) }], [{ members: [{ datasetId: "csv", variableId: "v1" }, { datasetId: "excel", variableId: "v1" }] }]);
    const excel = await xlsxAdapter.parse(p.files[1].bytes);
    const csv = await delimitedAdapter("csv").parse(p.files[0].bytes);
    expect(excel.rows[0]).toEqual([csv.rows[0][0], 1.5, true]);
    expect(excel.rows[2]).toEqual([null, null, null]);
    expect(await openDatasetPackageMapping(p.receiptArtifact.bytes, p.secretArtifact.bytes)).toHaveLength(1);
  });
  it("rejects formulas even with cached values", async () => {
    await expect(xlsxAdapter.parse(await change(worksheet, (s) => s.replace("<v>1.5</v>", "<f>1+0.5</f><v>1.5</v>")))).rejects.toThrow(/unexpected f/);
  });
  it("rejects hidden sheets, rows, columns and styled cells", async () => {
    for (const [part, fn] of [
      ["xl/workbook.xml", (s: string) => s.replace('name="Data"', 'name="Data" state="hidden"')],
      [worksheet, (s: string) => s.replace('<row r="2">', '<row r="2" hidden="1">')],
      [worksheet, (s: string) => s.replace("<sheetData>", '<cols><col min="1" max="1" hidden="1"/></cols><sheetData>')],
      [worksheet, (s: string) => s.replace('r="B2"', 'r="B2" s="1"')],
    ] as const) await expect(xlsxAdapter.parse(await change(part, fn))).rejects.toThrow(/hidden|style/);
  });
  it("rejects external relationships, extra parts and XML entity declarations", async () => {
    await expect(xlsxAdapter.parse(await change("xl/_rels/workbook.xml.rels", (s) => s.replace("Target=", 'TargetMode="External" Target=')))).rejects.toThrow(/relationship/);
    await expect(xlsxAdapter.parse(await change("xl/vbaProject.bin", () => "not a macro"))).rejects.toThrow(/ZIP part/);
    await expect(xlsxAdapter.parse(await change(worksheet, (s) => s.replace("<worksheet", '<!DOCTYPE worksheet [<!ENTITY x "abc">]><worksheet')))).rejects.toThrow(/DTD/);
  });
  it("rejects oversized archives, merged cells, duplicate cells and invalid headers", async () => {
    await expect(xlsxAdapter.parse(new Uint8Array(16 * 1024 * 1024 + 1))).rejects.toThrow(/size limit/);
    await expect(xlsxAdapter.parse(await change(worksheet, (s) => s.replace("</worksheet>", '<mergeCells><mergeCell ref="A1:B1"/></mergeCells></worksheet>')))).rejects.toThrow(/mergeCells/);
    await expect(xlsxAdapter.parse(await change(worksheet, (s) => s.replace('r="B2"', 'r="A2"')))).rejects.toThrow(/duplicate/);
    await expect(xlsxAdapter.parse(await change(worksheet, (s) => s.replace(">score<", ">arm<")))).rejects.toThrow(/unique/);
  });
  it("rejects unsupported default number formats and accepts ordinary shared strings", async () => {
    const map = await parts(await xlsxAdapter.serialize(data));
    const rels = "xl/_rels/workbook.xml.rels";
    const originalRels = map.get(rels)!;
    const related = (type: string, target: string) => originalRels.replace("</Relationships>", `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`);
    map.set(rels, related("styles", "styles.xml"));
    map.set("xl/styles.xml", '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs><xf numFmtId="14"/></cellXfs></styleSheet>');
    await expect(xlsxAdapter.parse(await zipParts(map))).rejects.toThrow(/default number format/);
    map.delete("xl/styles.xml");
    map.set(rels, related("sharedStrings", "sharedStrings.xml"));
    map.set("xl/sharedStrings.xml", '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>A</t></si></sst>');
    map.set(worksheet, map.get(worksheet)!.replace('r="A2" t="inlineStr"><is><t xml:space="preserve">A</t></is>', 'r="A2" t="s"><v>0</v>'));
    expect(await xlsxAdapter.parse(await zipParts(map))).toEqual(data);
  });
});
