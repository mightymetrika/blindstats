import { describe, expect, it } from "vitest";
import type { DatasetFormatAdapter, ResearchDataset } from "../../datasets/types";
import { sha256Hex } from "../hashing";
import { artifact, canonicalBytes } from "./artifacts";
import { blindDatasets } from "./mappings";
import { createDatasetPackage, openDatasetPackageMapping } from "./package";
import { parsePackageReceipt, verifyBlindedPackage } from "./receipt";
import { createPackageAnalysisLock, packageBlindingReference, parsePackageAnalysisLock, verifyLockedArtifacts } from "./analysis-lock";
import { createPackageUnblindingReceipt } from "./unblinding";

const bytes = (text: string) => new TextEncoder().encode(text);
// Synthetic typed adapter isolates the core tests from a specific file format.
const adapter: DatasetFormatAdapter = {
  format: "synthetic", extension: "json",
  parse: (value) => JSON.parse(new TextDecoder().decode(value)) as ResearchDataset,
  serialize: (dataset) => bytes(JSON.stringify(dataset)),
};
const a: ResearchDataset = { variables: [{ id: "v1", name: "arm" }, { id: "v2", name: "score" }], rows: [["control", 0], ["intervention", 2], [null, 3]] };
const b: ResearchDataset = { variables: [{ id: "v1", name: "study_arm" }, { id: "v2", name: "score" }], rows: [["intervention", true], ["intervention", false]] };
const group = { members: [{ datasetId: "a", variableId: "v1" }, { datasetId: "b", variableId: "v1" }] };
const inputs = () => [{ datasetId: "a", bytes: adapter.serialize(a) as Uint8Array, adapter }, { datasetId: "b", bytes: adapter.serialize(b) as Uint8Array, adapter }];
const generate = () => createDatasetPackage(inputs(), [group]);

describe("v0.5 local multi-dataset protocol", () => {
  it("uses one mapping for explicit links and preserves missingness and native types", async () => {
    const p = await generate();
    const [x, y] = p.files.map((f) => adapter.parse(f.bytes) as ResearchDataset);
    expect(x.rows[1][0]).toBe(y.rows[0][0]);
    expect(x.rows[0][0]).not.toBe(x.rows[1][0]);
    expect(x.rows[2]).toEqual([null, 3]);
    expect(y.rows[0][1]).toBe(true);
    expect(a.rows[1][0]).toBe("intervention");
    expect(p.receipt.manifest.mappingGroups[0].categoryCount).toBe(2);
    expect(p.receiptArtifact.text).not.toContain('"intervention"');
    expect(p.receiptArtifact.text).not.toContain('"score"');
    expect(await openDatasetPackageMapping(p.receiptArtifact.bytes, p.secretArtifact.bytes)).toEqual([{ groupId: "g1", mapping: [{ original: "control", blinded: x.rows[0][0] }, { original: "intervention", blinded: x.rows[1][0] }] }]);
  });
  it("supports typed categorical values without converting original labels to strings", () => {
    const variables = [{ id: "v1", name: "arm" }];
    const dataset = { variables, rows: [[0], [1], [null]] };
    const out = blindDatasets([{ datasetId: "a", dataset }], [{ members: [{ datasetId: "a", variableId: "v1" }] }]);
    expect(out.released[0].mapping.map((entry) => entry.original)).toEqual([0, 1]);
    expect(out.outputs.get("a")?.rows[2]).toEqual([null]);
    expect(typeof out.outputs.get("a")?.rows[0][0]).toBe("string");
  });
  it("does not link same-named variables implicitly", () => {
    const x = blindDatasets([{ datasetId: "a", dataset: a }, { datasetId: "b", dataset: a }], [
      { members: [{ datasetId: "a", variableId: "v1" }] }, { members: [{ datasetId: "b", variableId: "v1" }] },
    ]);
    expect(x.groups).toHaveLength(2);
    expect(x.released.map((g) => g.groupId)).toEqual(["g1", "g2"]);
  });
  it("rejects repeated members, incompatible category types and omitted datasets", () => {
    const datasets = [{ datasetId: "a", dataset: a }, { datasetId: "b", dataset: b }];
    expect(() => blindDatasets(datasets, [group, group])).toThrow(/only one/);
    expect(() => blindDatasets(datasets, [{ members: [{ datasetId: "a", variableId: "v2" }, { datasetId: "b", variableId: "v2" }] }])).toThrow(/compatible/);
    expect(() => blindDatasets(datasets, [{ members: [{ datasetId: "a", variableId: "v1" }] }])).toThrow(/Each blinded dataset/);
  });
  it("verifies exact file sets regardless of selection order", async () => {
    const p = await generate();
    await expect(verifyBlindedPackage(p.receiptArtifact.bytes, [...p.files].reverse())).resolves.toEqual(p.receipt);
    await expect(verifyBlindedPackage(p.receiptArtifact.bytes, p.files.slice(0, 1))).rejects.toThrow(/File set/);
    await expect(verifyBlindedPackage(p.receiptArtifact.bytes, [p.files[0], p.files[0]])).rejects.toThrow(/unique/);
    const changed = new Uint8Array(p.files[1].bytes); changed[0] ^= 1;
    await expect(verifyBlindedPackage(p.receiptArtifact.bytes, [p.files[0], { ...p.files[1], bytes: changed }])).rejects.toThrow(/integrity/);
  });
  it("authenticates manifest and rejects a different secret even after manifest rehash", async () => {
    const p = await generate(); const other = await generate();
    await expect(openDatasetPackageMapping(p.receiptArtifact.bytes, other.secretArtifact.bytes)).rejects.toThrow(/does not belong/);
    const tampered = structuredClone(p.receipt);
    tampered.manifest.datasets[0].rowCount++;
    await expect(parsePackageReceipt(artifact(tampered).bytes)).rejects.toThrow(/Manifest hash/);
    tampered.manifestSha256 = await sha256Hex(canonicalBytes(tampered.manifest));
    await expect(openDatasetPackageMapping(artifact(tampered).bytes, p.secretArtifact.bytes)).rejects.toThrow(/authenticate/);
  });
  it("rejects adapters that silently change values", async () => {
    const broken: DatasetFormatAdapter = { ...adapter, serialize: (dataset) => bytes(JSON.stringify({ ...dataset, rows: dataset.rows.slice(1) })) };
    await expect(createDatasetPackage(inputs().map((input) => ({ ...input, adapter: broken })), [group])).rejects.toThrow(/preserve/);
  });
  it("creates a safe completion projection for a package with or without a lock", async () => {
    const p = await generate();
    const lock = await createPackageAnalysisLock(p.receiptArtifact.bytes, [{filename:"analysis.R", bytes:bytes("mean(x)")}]);
    for (const selected of [lock, null]) {
      const release = await createPackageUnblindingReceipt(p.receiptArtifact.bytes, p.secretArtifact.bytes, selected?.receiptArtifact.bytes ?? null);
      expect(release.receipt.manifest).toEqual(p.receipt.manifest);
      expect(release.receipt.lockId).toBe(selected?.receipt.lockId ?? null);
      expect(release.completion.artifacts.sourceArtifactSha256).toBe(p.receipt.manifestSha256);
      expect(release.completion.artifacts.blindedArtifactSha256).toBe(p.receipt.manifestSha256);
      expect(release.completion.artifacts.analysisArtifact).toEqual(selected ? {filename:"analysis-lock-receipt.json",sha256:await sha256Hex(selected.receiptArtifact.bytes),byteLength:selected.receiptArtifact.bytes.length} : null);
      expect(release.receipt.artifacts).not.toHaveProperty("analysisArtifact");
      expect(release.receipt.artifacts.analysisArtifacts).toEqual(selected?.receipt.analysisArtifacts ?? []);
      expect(release.receipt.releasedMappings[0].mapping).toHaveLength(2);
    }
  });
  it("locks multiple arbitrary artifacts locally and verifies exact receipt bytes and file set", async () => {
    const p = await generate();
    const files = [{ filename: "analysis.R", bytes: bytes("summary(x)") }, { filename: "report.pdf", bytes: new Uint8Array([1, 2, 3]) }, { filename: "empty.txt", bytes: new Uint8Array() }];
    const lock = await createPackageAnalysisLock(p.receiptArtifact.bytes, files);
    expect(lock.receipt.analysisArtifacts).toHaveLength(3);
    expect(lock.receiptArtifact.text).not.toContain("summary(x)");
    const ref = await packageBlindingReference(p.receiptArtifact.bytes);
    await expect(verifyLockedArtifacts(lock.receiptArtifact.bytes, [...files].reverse(), ref)).resolves.toEqual(lock.receipt);
    await expect(verifyLockedArtifacts(lock.receiptArtifact.bytes, files.slice(1), ref)).rejects.toThrow(/File set/);
    const reformatted = bytes(JSON.stringify(p.receipt));
    await expect(verifyLockedArtifacts(lock.receiptArtifact.bytes, files, await packageBlindingReference(reformatted))).rejects.toThrow(/exact/);
    await expect(createPackageAnalysisLock(p.receiptArtifact.bytes, [files[0], files[0]])).rejects.toThrow(/unique/);
    await expect(createPackageAnalysisLock(p.receiptArtifact.bytes, [])).rejects.toThrow(/at least one/);
    expect(parsePackageAnalysisLock(lock.receiptArtifact.bytes)).toEqual(lock.receipt);
    const release = await createPackageUnblindingReceipt(p.receiptArtifact.bytes, p.secretArtifact.bytes, lock.receiptArtifact.bytes);
    expect(release.receipt.lockId).toBe(lock.receipt.lockId);
    expect(release.receipt.artifacts.analysisLockReceiptSha256).toBe(await sha256Hex(lock.receiptArtifact.bytes));
    await expect(createPackageUnblindingReceipt(reformatted, p.secretArtifact.bytes, lock.receiptArtifact.bytes)).rejects.toThrow(/exact/);
  });
});
