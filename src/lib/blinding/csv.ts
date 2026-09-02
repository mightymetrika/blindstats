import Papa from "papaparse";

import type { DatasetCell, DatasetRow } from "./types";

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const UTF8_ENCODER = new TextEncoder();

export type ParsedCsvDataset = {
  columns: string[];
  rows: DatasetRow[];
};

export type SerializedCsvArtifact = {
  text: string;
  bytes: Uint8Array;
};

function decodeUtf8(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) {
    throw new Error("CSV source file is empty.");
  }

  try {
    return UTF8_DECODER.decode(bytes);
  } catch {
    throw new Error("CSV source file must contain valid UTF-8 text.");
  }
}

function removeTerminalParserRecord(
  records: string[][],
  sourceText: string,
): string[][] {
  if (!sourceText.endsWith("\n") && !sourceText.endsWith("\r")) {
    return records;
  }

  const lastRecord = records.at(-1);

  if (
    lastRecord?.length === 1 &&
    lastRecord[0] === ""
  ) {
    return records.slice(0, -1);
  }

  return records;
}

function validateColumns(columns: readonly string[]): void {
  if (columns.length === 0) {
    throw new Error("CSV dataset must contain at least one column.");
  }

  const observedColumns = new Set<string>();

  for (const column of columns) {
    if (column.trim().length === 0) {
      throw new Error("CSV column names cannot be blank.");
    }

    if (observedColumns.has(column)) {
      throw new Error(`CSV contains a duplicate column name: ${column}`);
    }

    observedColumns.add(column);
  }
}

function normalizeCell(value: string): DatasetCell {
  return value === "" ? null : value;
}

function validateDatasetForSerialization(
  columns: readonly string[],
  rows: readonly DatasetRow[],
): void {
  validateColumns(columns);

  if (rows.length === 0) {
    throw new Error("CSV dataset must contain at least one data row.");
  }

  const expectedColumns = new Set(columns);

  rows.forEach((row, rowIndex) => {
    const rowColumns = Object.keys(row);

    if (
      rowColumns.length !== columns.length ||
      rowColumns.some((column) => !expectedColumns.has(column))
    ) {
      throw new Error(
        `Row ${rowIndex + 1} does not match the declared CSV columns.`,
      );
    }

    for (const column of columns) {
      if (!Object.hasOwn(row, column)) {
        throw new Error(
          `Row ${rowIndex + 1} does not match the declared CSV columns.`,
        );
      }

      const value = row[column];

      if (value !== null && typeof value !== "string") {
        throw new Error(
          `Row ${rowIndex + 1} contains a non-string CSV cell value.`,
        );
      }
    }
  });
}

export function parseCsvBytes(bytes: Uint8Array): ParsedCsvDataset {
  const sourceText = decodeUtf8(bytes);

  const result = Papa.parse<string[]>(sourceText, {
    delimiter: ",",
    dynamicTyping: false,
    header: false,
    skipEmptyLines: false,
  });

  if (result.errors.length > 0) {
    throw new Error(`CSV parse failed: ${result.errors[0].message}`);
  }

  const records = removeTerminalParserRecord(result.data, sourceText);

  if (records.length === 0) {
    throw new Error("CSV dataset must contain a header row.");
  }

  const [columns, ...dataRecords] = records;

  validateColumns(columns);

  if (dataRecords.length === 0) {
    throw new Error("CSV dataset must contain at least one data row.");
  }

  const rows = dataRecords.map((record, rowIndex) => {
    if (record.length !== columns.length) {
      throw new Error(
        `CSV row ${rowIndex + 1} has ${record.length} fields; expected ${columns.length}.`,
      );
    }

    return Object.fromEntries(
      columns.map((column, columnIndex) => [
        column,
        normalizeCell(record[columnIndex]),
      ]),
    ) as DatasetRow;
  });

  return {
    columns: [...columns],
    rows,
  };
}

export function serializeCsvDataset(
  columns: readonly string[],
  rows: readonly DatasetRow[],
): SerializedCsvArtifact {
  validateDatasetForSerialization(columns, rows);

  const records: string[][] = [
    [...columns],
    ...rows.map((row) =>
      columns.map((column) => row[column] ?? ""),
    ),
  ];

  const text = Papa.unparse(records, {
    delimiter: ",",
    escapeChar: '"',
    header: false,
    newline: "\n",
    quoteChar: '"',
  });

  const bytes = UTF8_ENCODER.encode(text);

  return {
    text,
    bytes,
  };
}
