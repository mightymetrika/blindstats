import { TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js";
import { validateDataset, type DatasetCell, type DatasetFormatAdapter, type ResearchDataset } from "../types";

// Deliberately small OOXML subset, not a general workbook editor. ZIP handling
// belongs to zip.js; XML parsing belongs to the browser's XML parser.
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const MAX_ARCHIVE = 16 * 1024 * 1024;
const MAX_XML = 24 * 1024 * 1024;
const MAX_CELLS = 200_000;
const MAX_ROWS = 50_000;
const MAX_COLS = 256;
const allowedParts = new Set([
  "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels",
  "xl/worksheets/sheet1.xml", "xl/sharedStrings.xml", "xl/styles.xml", "xl/theme/theme1.xml",
  "docProps/core.xml", "docProps/app.xml",
]);
function fail(detail: string): never { throw new Error(`Unsupported or unsafe Excel workbook: ${detail}`); }
const children = (node: Element) => Array.from(node.children);
function only(node: Element, names: readonly string[], ns = NS) {
  for (const child of children(node)) if (child.namespaceURI !== ns || !names.includes(child.localName)) fail(`unexpected ${child.localName}`);
}
function named(node: Element, name: string) { return children(node).filter((c) => c.namespaceURI === NS && c.localName === name); }
function one(node: Element, name: string): Element {
  const matches = named(node, name);
  if (matches.length !== 1) fail(`expected exactly one ${name}`);
  return matches[0];
}
function xml(text: string, root: string, namespace = NS): Element {
  if (/<!DOCTYPE|<!ENTITY|<\?(?!xml\s)/i.test(text)) fail("DTD, entities or processing instructions");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const element = doc.documentElement;
  if (doc.getElementsByTagName("parsererror").length || doc.doctype || element.localName !== root || element.namespaceURI !== namespace) fail(`invalid ${root} XML`);
  return element;
}
async function readParts(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > MAX_ARCHIVE) fail("compressed size limit exceeded");
  const reader = new ZipReader(new Uint8ArrayReader(bytes), { useWebWorkers: false, strictness: "strict" });
  try {
    const entries = await reader.getEntries();
    if (entries.length > allowedParts.size) fail("unexpected ZIP parts");
    const result = new Map<string, string>();
    let total = 0;
    for (const entry of entries) {
      if (entry.directory || entry.encrypted || !allowedParts.has(entry.filename) || result.has(entry.filename) || !entry.getData) fail("unexpected, encrypted or duplicate ZIP part");
      const size = entry.uncompressedSize;
      if (!Number.isSafeInteger(size) || size < 0 || total + size > MAX_XML) fail("expanded size limit exceeded");
      const chunks: Uint8Array[] = [];
      let actual = 0;
      const sink = new WritableStream<Uint8Array>({ write(chunk) {
        actual += chunk.length;
        if (actual > size || total + actual > MAX_XML) fail("expanded size limit exceeded");
        chunks.push(new Uint8Array(chunk));
      } });
      await entry.getData(sink, { checkCrc32: true, useWebWorkers: false, checkOverlappingEntry: true, strictness: "strict" });
      if (actual !== size) fail("ZIP length mismatch");
      total += actual;
      const merged = new Uint8Array(actual);
      let offset = 0;
      for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
      result.set(entry.filename, new TextDecoder("utf-8", { fatal: true }).decode(merged));
    }
    return result;
  } finally { await reader.close(); }
}
function required(parts: Map<string, string>, name: string): string {
  const part = parts.get(name);
  if (part === undefined) return fail(`missing ${name}`);
  return part;
}
function checkRelationships(text: string, base: "root" | "workbook") {
  const root = xml(text, "Relationships", PKG);
  only(root, ["Relationship"], PKG);
  const entries = new Map<string, { type: string; target: string }>();
  const targets = base === "root" ? new Map([
    [`${REL}/officeDocument`, "xl/workbook.xml"], [`${REL}/extended-properties`, "docProps/app.xml"],
    ["http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"],
  ]) : new Map([
    [`${REL}/worksheet`, "xl/worksheets/sheet1.xml"], [`${REL}/styles`, "xl/styles.xml"],
    [`${REL}/sharedStrings`, "xl/sharedStrings.xml"], [`${REL}/theme`, "xl/theme/theme1.xml"],
  ]);
  for (const child of children(root)) {
    const id = child.getAttribute("Id") ?? "", type = child.getAttribute("Type") ?? "";
    const raw = child.getAttribute("Target") ?? "";
    const target = raw.startsWith("/") ? raw.slice(1) : base === "workbook" ? `xl/${raw}` : raw;
    if (!id || entries.has(id) || child.hasAttribute("TargetMode") || targets.get(type) !== target || [...entries.values()].some((e) => e.type === type)) fail("external, duplicate or unsupported relationship");
    entries.set(id, { type, target });
  }
  return entries;
}
function plainText(node: Element): string {
  only(node, ["t"]);
  const t = one(node, "t");
  if (t.children.length) fail("rich text");
  const value = t.textContent ?? "";
  // OOXML escape sequences can encode control characters or change literal text.
  if (/_x[0-9a-f]{4}_/i.test(value)) fail("OOXML escaped text");
  return value;
}
function index(value: string, max: number): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return fail("invalid index");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n > max) return fail("index out of range");
  return n;
}
function address(value: string) {
  const match = /^([A-Z]{1,3})([1-9][0-9]*)$/.exec(value);
  if (!match) return fail("invalid cell address");
  let column = 0;
  for (const c of match[1]) column = column * 26 + c.charCodeAt(0) - 64;
  if (column > MAX_COLS) fail("column limit exceeded");
  return { column: column - 1, row: index(match[2], MAX_ROWS) };
}
function parseCell(cell: Element, strings: string[]): DatasetCell {
  // Reject styled cells: this avoids silent interpretation of Excel serial dates,
  // percentages, currency and other display-dependent numbers.
  if (cell.hasAttribute("s") && cell.getAttribute("s") !== "0") fail("nondefault cell style (including dates)");
  for (const attr of Array.from(cell.attributes)) if (!["r", "s", "t"].includes(attr.name)) fail("unsupported cell metadata");
  const type = cell.getAttribute("t") ?? "n";
  if (type === "inlineStr") { only(cell, ["is"]); return plainText(one(cell, "is")); }
  only(cell, ["v"]); // formulas, errors, rich objects are never interpreted
  if (!children(cell).length && type === "n") return null;
  const valueNode = one(cell, "v");
  if (valueNode.children.length) fail("invalid cell value");
  const value = valueNode.textContent ?? "";
  if (type === "s") {
    const n = index(value, strings.length - 1);
    return strings[n];
  }
  if (type === "b" && (value === "0" || value === "1")) return value === "1";
  if (type === "n") {
    if (!value) return null;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) fail("invalid number");
    const n = Number(value);
    if (n === 0 && /[1-9]/.test(value.split(/[eE]/)[0])) fail("number underflow");
    if (Number.isFinite(n) && !Object.is(n, -0) && (!Number.isInteger(n) || Number.isSafeInteger(n))) return n;
  }
  return fail("unsupported cell type or value");
}
function checkDefaultStyle(parts: Map<string, string>) {
  const text = parts.get("xl/styles.xml");
  if (!text) return;
  const root = xml(text, "styleSheet");
  const formats = one(root, "cellXfs");
  const first = children(formats)[0];
  if (!first || first.namespaceURI !== NS || first.localName !== "xf" || first.getAttribute("numFmtId") !== "0" || first.getAttribute("applyNumberFormat") === "1") fail("non-general default number format");
  const styleId = first.getAttribute("xfId");
  if (styleId !== null) {
    const parent = children(one(root, "cellStyleXfs"))[index(styleId, 10000)];
    if (!parent || parent.getAttribute("numFmtId") !== "0") fail("non-general inherited number format");
  }
}
async function parse(bytes: Uint8Array): Promise<ResearchDataset> {
  const parts = await readParts(bytes);
  const types = xml(required(parts, "[Content_Types].xml"), "Types", CT);
  only(types, ["Default", "Override"], CT);
  const workbookType = children(types).filter((c) => c.getAttribute("PartName") === "/xl/workbook.xml");
  if (workbookType.length !== 1 || workbookType[0].getAttribute("ContentType") !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml") fail("not an ordinary .xlsx workbook");
  const rootRels = checkRelationships(required(parts, "_rels/.rels"), "root");
  if (![...rootRels.values()].some((r) => r.type === `${REL}/officeDocument`)) fail("missing workbook relationship");
  const rels = checkRelationships(required(parts, "xl/_rels/workbook.xml.rels"), "workbook");
  const related = [...rootRels.values(), ...rels.values()];
  for (const r of related) required(parts, r.target);
  for (const name of parts.keys()) {
    if (!["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels"].includes(name) && !related.some((r) => r.target === name)) fail("unreferenced workbook part");
  }
  const workbook = xml(required(parts, "xl/workbook.xml"), "workbook");
  only(workbook, ["fileVersion", "workbookPr", "workbookProtection", "bookViews", "sheets", "calcPr", "definedNames"]);
  // Some plain workbooks (including openpyxl output) include an empty
  // protection placeholder. Accept only that inert form, not actual protection
  // settings, passwords, nested elements or duplicate placeholders.
  const protection = named(workbook, "workbookProtection");
  if (protection.length > 1 || protection.some((n) => n.attributes.length || n.children.length || n.textContent?.trim())) fail("unsupported workbookProtection settings");
  if (named(workbook, "definedNames").some((n) => n.children.length || n.textContent?.trim())) fail("defined names");
  const sheets = one(workbook, "sheets");
  only(sheets, ["sheet"]);
  const sheet = one(sheets, "sheet");
  if ((sheet.getAttribute("state") ?? "visible") !== "visible" || rels.get(sheet.getAttributeNS(REL, "id") ?? "")?.type !== `${REL}/worksheet`) fail("hidden or invalid worksheet");
  checkDefaultStyle(parts);
  const stringsText = parts.get("xl/sharedStrings.xml");
  const strings = stringsText ? (() => { const sst = xml(stringsText, "sst"); only(sst, ["si"]); return children(sst).map(plainText); })() : [];
  const worksheet = xml(required(parts, "xl/worksheets/sheet1.xml"), "worksheet");
  only(worksheet, ["sheetPr", "dimension", "sheetViews", "sheetFormatPr", "cols", "sheetData", "pageMargins"]);
  for (const cols of named(worksheet, "cols")) {
    only(cols, ["col"]);
    for (const col of children(cols)) if (col.hasAttribute("hidden") && !["0", "false"].includes(col.getAttribute("hidden")!) || col.hasAttribute("style") && col.getAttribute("style") !== "0" || col.hasAttribute("width") && !(Number(col.getAttribute("width")) > 0)) fail("hidden or styled column");
  }
  for (const format of named(worksheet, "sheetFormatPr")) if ((format.hasAttribute("zeroHeight") && !["0", "false"].includes(format.getAttribute("zeroHeight")!)) || (format.hasAttribute("defaultRowHeight") && Number(format.getAttribute("defaultRowHeight")) <= 0)) fail("hidden default rows");
  const data = one(worksheet, "sheetData"); only(data, ["row"]);
  const rows = new Map<number, Map<number, DatasetCell>>();
  let lastRow = 0, width = 0;
  for (const row of children(data)) {
    if (row.hasAttribute("hidden") && !["0", "false"].includes(row.getAttribute("hidden")!) || row.hasAttribute("s") && row.getAttribute("s") !== "0" || row.hasAttribute("ht") && !(Number(row.getAttribute("ht")) > 0)) fail("hidden or styled row");
    const r = index(row.getAttribute("r") ?? "", MAX_ROWS);
    if (!r || r <= lastRow) fail("duplicate or unordered rows");
    lastRow = r;
    only(row, ["c"]);
    const cells = new Map<number, DatasetCell>(); rows.set(r, cells);
    for (const cell of children(row)) {
      const a = address(cell.getAttribute("r") ?? "");
      if (a.row !== r || cells.has(a.column)) fail("duplicate or misplaced cell");
      cells.set(a.column, parseCell(cell, strings)); width = Math.max(width, a.column + 1);
    }
    if (lastRow * width > MAX_CELLS) fail("cell limit exceeded");
  }
  if (!width || lastRow < 2 || !rows.has(1)) fail("header and data rows are required");
  const header = rows.get(1)!;
  const variables = Array.from({ length: width }, (_, i) => {
    const name = header.get(i);
    if (typeof name !== "string" || !name.trim()) return fail("headers must be nonblank text");
    return { id: `v${i + 1}`, name };
  });
  const dataset = { variables, rows: Array.from({ length: lastRow - 1 }, (_, i) => Array.from({ length: width }, (_, j) => rows.get(i + 2)?.get(j) ?? null)) };
  validateDataset(dataset);
  return dataset;
}
function escapeXml(value: string): string {
  if (Array.from(value).some((c) => { const cp = c.codePointAt(0)!; return cp < 32 && ![9, 10, 13].includes(cp) || cp >= 0xd800 && cp <= 0xdfff || cp === 0xfffe || cp === 0xffff; }) || /_x[0-9a-f]{4}_/i.test(value)) fail("text cannot be safely represented in OOXML");
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#13;");
}
function colName(i: number): string { let out = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) out = String.fromCharCode(65 + (i - 1) % 26) + out; return out; }
const declaration = '<?xml version="1.0" encoding="UTF-8"?>';
async function serialize(dataset: ResearchDataset): Promise<Uint8Array> {
  validateDataset(dataset);
  const width = dataset.variables.length, height = dataset.rows.length + 1;
  if (width > MAX_COLS || height > MAX_ROWS || width * height > MAX_CELLS) fail("dataset exceeds Excel limits");
  const rows = [dataset.variables.map((v) => v.name), ...dataset.rows].map((row, i) => `<row r="${i + 1}">${row.map((value, j) => {
    const r = `${colName(j)}${i + 1}`;
    if (value === null) return `<c r="${r}"/>`;
    if (typeof value === "string") return `<c r="${r}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) fail("unsafe integer");
    return `<c r="${r}" t="${typeof value === "boolean" ? "b" : "n"}"><v>${typeof value === "boolean" ? Number(value) : value}</v></c>`;
  }).join("")}</row>`).join("");
  const files = {
    "[Content_Types].xml": `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${NS}"><sheetData>${rows}</sheetData></worksheet>`,
  };
  let total = 0;
  const output = new Uint8ArrayWriter();
  const writer = new ZipWriter(output, { useWebWorkers: false });
  try {
    for (const [name, text] of Object.entries(files)) {
      total += new TextEncoder().encode(declaration + text).length;
      if (total > MAX_XML) fail("expanded output limit exceeded");
      await writer.add(name, new TextReader(declaration + text));
    }
  } finally { await writer.close(); }
  const result = await output.getData();
  if (result.length > MAX_ARCHIVE) fail("compressed output limit exceeded");
  return result;
}
export const xlsxAdapter: DatasetFormatAdapter = { format: "xlsx", extension: "xlsx", parse, serialize };
