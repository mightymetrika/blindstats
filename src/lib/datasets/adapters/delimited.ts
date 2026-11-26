import { parseDelimitedBytes, serializeDelimitedDataset } from "../../blinding/csv";
import type { DatasetRow } from "../../blinding/types";
import { validateDataset, type DatasetFormatAdapter } from "../types";

// Reject spreadsheet-interpretable text rather than escape/alter research values.
// Plain signed numeric literals are allowed; they contain no executable expression.
function requireSafeDelimitedValue(value: string): void {
  const trimmed = value.trimStart();
  if (/^\s*[\t\r\n]/.test(value) || (/^[=+@\-＝＋＠－]/u.test(trimmed) &&
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed))) {
    throw new Error("Delimited output contains spreadsheet formula-like text; remove or recode it explicitly before export.");
  }
}

export function delimitedAdapter(format: "csv" | "tsv"): DatasetFormatAdapter {
  const delimiter = format === "csv" ? "," : "\t";
  return {
    format, extension: format,
    parse(bytes) {
      const { columns, rows } = parseDelimitedBytes(bytes, delimiter);
      return {
        variables: columns.map((name, index) => ({ id: `v${index + 1}`, name })),
        rows: rows.map((row) => columns.map((name) => row[name])),
      };
    },
    serialize(dataset) {
      validateDataset(dataset);
      const columns = dataset.variables.map(({ name }) => name);
      columns.forEach(requireSafeDelimitedValue);
      const rows = dataset.rows.map((row) => Object.fromEntries(row.map((cell, index) => {
        if (cell !== null && (typeof cell !== "string" || cell === "")) {
          throw new Error("Delimited output requires nonempty text or missing values; implicit type conversion is not supported.");
        }
        if (cell !== null) requireSafeDelimitedValue(cell);
        return [columns[index], cell];
      })) as DatasetRow);
      const { text } = serializeDelimitedDataset(columns, rows, delimiter);
      // Terminate the final record, including a single-column missing observation.
      return new TextEncoder().encode(`${text}\n`);
    },
  };
}
