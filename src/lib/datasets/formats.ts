import { delimitedAdapter } from "./adapters/delimited";
import { xlsxAdapter } from "./adapters/xlsx";
import type { DatasetFormatAdapter } from "./types";

export function adapterForFilename(filename: string): DatasetFormatAdapter {
  const extension = filename.split(".").at(-1)?.toLowerCase();
  if (extension === "csv" || extension === "tsv") return delimitedAdapter(extension);
  if (extension === "xlsx") return xlsxAdapter;
  throw new Error("Only CSV, TSV and supported XLSX workbooks are accepted.");
}
