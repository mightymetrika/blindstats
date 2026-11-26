/** Research data, independent of file bytes, storage location and transport. */
export type DatasetCell = string | number | boolean | null;
export type DatasetVariable = { id: string; name: string };
export type ResearchDataset = {
  variables: DatasetVariable[];
  rows: DatasetCell[][];
};

export interface DatasetFormatAdapter {
  readonly format: string;
  readonly extension: string;
  parse(bytes: Uint8Array): Promise<ResearchDataset> | ResearchDataset;
  serialize(dataset: ResearchDataset): Promise<Uint8Array> | Uint8Array;
}

export function validateDataset(dataset: ResearchDataset): void {
  if (!dataset.variables.length || !dataset.rows.length) {
    throw new Error("A dataset requires variables and observations.");
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const variable of dataset.variables) {
    if (!variable.id.trim() || !variable.name.trim() || ids.has(variable.id) || names.has(variable.name)) {
      throw new Error("Dataset variable IDs and names must be nonblank and unique.");
    }
    ids.add(variable.id);
    names.add(variable.name);
  }
  for (const row of dataset.rows) {
    if (row.length !== dataset.variables.length) throw new Error("Dataset row width does not match its variables.");
    for (const cell of row) {
      if (cell === null || typeof cell === "boolean" || typeof cell === "string" ||
          (typeof cell === "number" && Number.isFinite(cell) && !Object.is(cell, -0))) continue;
      throw new Error("Unsupported dataset cell value.");
    }
  }
}
