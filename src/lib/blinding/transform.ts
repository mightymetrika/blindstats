import type {
  BlindingMappingEntry,
  DatasetRow,
} from "./types";

function buildMappingLookup(
  mapping: readonly BlindingMappingEntry[],
): Map<string, string> {
  if (mapping.length < 2) {
    throw new Error("A blinding mapping requires at least two entries.");
  }

  const lookup = new Map<string, string>();
  const blindedLabels = new Set<string>();

  for (const entry of mapping) {
    if (lookup.has(entry.original)) {
      throw new Error(
        "A blinding mapping cannot contain duplicate original categories.",
      );
    }

    if (blindedLabels.has(entry.blinded)) {
      throw new Error(
        "A blinding mapping cannot contain duplicate blinded labels.",
      );
    }

    lookup.set(entry.original, entry.blinded);
    blindedLabels.add(entry.blinded);
  }

  return lookup;
}

export function applyBlindingMapping(
  rows: readonly DatasetRow[],
  selectedColumn: string,
  mapping: readonly BlindingMappingEntry[],
): DatasetRow[] {
  const lookup = buildMappingLookup(mapping);

  return rows.map((sourceRow, rowIndex) => {
    if (!Object.hasOwn(sourceRow, selectedColumn)) {
      throw new Error(
        `Row ${rowIndex + 1} does not contain the selected blinding column.`,
      );
    }

    const sourceValue = sourceRow[selectedColumn];
    const blindedRow = { ...sourceRow };

    if (sourceValue === null) {
      return blindedRow;
    }

    const blindedValue = lookup.get(sourceValue);

    if (blindedValue === undefined) {
      throw new Error(
        `Row ${rowIndex + 1} contains a nonmissing selected-column value that is not present in the blinding mapping.`,
      );
    }

    blindedRow[selectedColumn] = blindedValue;

    return blindedRow;
  });
}
