import { validateDataset, type DatasetCell, type ResearchDataset } from "../../datasets/types";
import { generateNeutralLabels } from "../labels";
import { secureShuffle } from "../mapping";

export type VariableReference = { datasetId: string; variableId: string };
export type MappingGroupInput = { members: VariableReference[] };
export type MappingGroup = MappingGroupInput & { groupId: string; categoryCount: number };
export type Category = Exclude<DatasetCell, null>;
export type ReleasedGroup = { groupId: string; mapping: { original: Category; blinded: string }[] };
export type IdentifiedDataset = { datasetId: string; dataset: ResearchDataset };

/** One explicit group per selected variable; unlinked variables have singleton groups. */
export function blindDatasets(inputs: readonly IdentifiedDataset[], groups: readonly MappingGroupInput[]) {
  if (!inputs.length || !groups.length) throw new Error("Select datasets and mapping groups.");
  const sources = new Map<string, ResearchDataset>();
  for (const { datasetId, dataset } of inputs) {
    if (!datasetId.trim() || sources.has(datasetId)) throw new Error("Dataset IDs must be unique.");
    validateDataset(dataset);
    sources.set(datasetId, dataset);
  }
  const outputs = new Map(inputs.map(({ datasetId, dataset }) => [datasetId, {
    variables: dataset.variables.map((v) => ({ ...v })), rows: dataset.rows.map((row) => [...row]),
  }]));
  const seen = new Set<string>();
  const usedDatasets = new Set<string>();
  const metadata: MappingGroup[] = [];
  const released: ReleasedGroup[] = [];
  for (const [index, group] of groups.entries()) {
    if (!group.members.length) throw new Error("A mapping group cannot be empty.");
    const categories = new Set<Category>();
    const types = new Set<string>();
    const members = group.members.map(({ datasetId, variableId }) => {
      const dataset = sources.get(datasetId);
      const column = dataset?.variables.findIndex((v) => v.id === variableId) ?? -1;
      if (!dataset || column < 0) throw new Error("Unknown dataset or variable in mapping group.");
      const key = JSON.stringify([datasetId, variableId]);
      if (seen.has(key)) throw new Error("A variable may belong to only one mapping group.");
      seen.add(key);
      usedDatasets.add(datasetId);
      for (const row of dataset.rows) {
        const value = row[column];
        if (value === null) continue;
        if (typeof value === "string" && !value.trim()) throw new Error("Blank selected categories must be recoded as missing explicitly.");
        categories.add(value);
        types.add(typeof value);
      }
      return { datasetId, variableId, column };
    });
    if (types.size !== 1) throw new Error("Linked variables require a single compatible nonmissing cell type.");
    if (categories.size < 2) throw new Error("A mapping group requires at least two distinct nonmissing categories.");
    const labels = secureShuffle(generateNeutralLabels(categories.size));
    const mapping = [...categories].map((original, i) => ({ original, blinded: labels[i] }));
    const lookup = new Map(mapping.map(({ original, blinded }) => [original, blinded]));
    for (const { datasetId, column } of members) {
      const source = sources.get(datasetId)!;
      const output = outputs.get(datasetId)!;
      source.rows.forEach((row, rowIndex) => {
        const value = row[column];
        output.rows[rowIndex][column] = value === null ? null : lookup.get(value)!;
      });
    }
    const groupId = `g${index + 1}`;
    metadata.push({ groupId, members: members.map(({ datasetId, variableId }) => ({ datasetId, variableId })), categoryCount: categories.size });
    released.push({ groupId, mapping });
  }
  if (usedDatasets.size !== inputs.length) throw new Error("Each blinded dataset requires a selected variable. Share unchanged files separately.");
  return { outputs, groups: metadata, released };
}
