import { validateDataset, type DatasetFormatAdapter } from "../../datasets/types";
import { parseJsonArtifactBytes, requireArray, requireExactKeys, requireNonblankString, requireRecord } from "../artifact-validation";
import { sha256Hex } from "../hashing";
import { createTransformationIdentity } from "../identity";
import { generateNeutralLabels } from "../labels";
import { artifact, canonicalBytes, describeFile, fromHex, hex } from "./artifacts";
import { blindDatasets, type Category, type MappingGroupInput, type ReleasedGroup } from "./mappings";
import { PACKAGE_AAD, PACKAGE_VERSION, mappingAad, packageHeader, parsePackageReceipt, parsePackageSecret, type ManifestDataset, type PackageHeader, type PackageReceipt, type PackageSecret } from "./receipt";

export type DatasetInput = { datasetId: string; bytes: Uint8Array; adapter: DatasetFormatAdapter };
function buffer(bytes: Uint8Array): ArrayBuffer { return Uint8Array.from(bytes).buffer; }

/** Local operation only. No storage, network, or Study authorization implied. */
export async function createDatasetPackage(inputs: readonly DatasetInput[], groups: readonly MappingGroupInput[], createdAt = new Date()) {
  const identity = createTransformationIdentity(createdAt);
  const sources = inputs.map(({ datasetId, bytes, adapter }) => ({ datasetId, bytes: new Uint8Array(bytes), adapter }));
  const selection = groups.map(({ members }) => ({ members: members.map(({ datasetId, variableId }) => ({ datasetId, variableId })) }));
  const parsed = await Promise.all(sources.map(async ({ datasetId, bytes, adapter }) => {
    if (!bytes.byteLength || !/^[a-z0-9]+$/.test(adapter.format) || !/^[a-z0-9]+$/.test(adapter.extension)) throw new Error("Dataset bytes and valid format are required.");
    const dataset = await adapter.parse(new Uint8Array(bytes));
    validateDataset(dataset);
    return { datasetId, dataset };
  }));
  const transformed = blindDatasets(parsed, selection);
  const selected = new Set(transformed.groups.flatMap((g) => g.members.map((m) => JSON.stringify([m.datasetId, m.variableId]))));
  const datasets: ManifestDataset[] = [];
  const files: { datasetId: string; filename: string; bytes: Uint8Array }[] = [];
  for (const [i, source] of sources.entries()) {
    const output = transformed.outputs.get(source.datasetId)!;
    const bytes = new Uint8Array(await source.adapter.serialize(output));
    // An adapter must not silently alter values, missingness, headers or row count.
    const roundtrip = await source.adapter.parse(new Uint8Array(bytes));
    validateDataset(roundtrip);
    if (JSON.stringify(roundtrip.variables.map((v) => v.name)) !== JSON.stringify(output.variables.map((v) => v.name)) ||
        JSON.stringify(roundtrip.rows) !== JSON.stringify(output.rows)) throw new Error("Output adapter did not preserve the transformed dataset exactly.");
    const file = { datasetId: source.datasetId, filename: `blinded-dataset-${i + 1}.${source.adapter.extension}`, bytes };
    files.push(file);
    datasets.push({
      datasetId: source.datasetId, format: source.adapter.format,
      rowCount: output.rows.length, columnCount: output.variables.length,
      selectedVariables: output.variables.filter(({ id }) => selected.has(JSON.stringify([source.datasetId, id]))).map(({ id, name }) => ({ id, name })),
      source: { sha256: await sha256Hex(source.bytes), byteLength: source.bytes.length },
      blinded: await describeFile(file),
    });
  }
  const manifest = { datasets, mappingGroups: transformed.groups };
  const header: PackageHeader = {
    schemaVersion: PACKAGE_VERSION, receiptType: "blinding_package", ...identity,
    manifest, manifestSha256: await sha256Hex(canonicalBytes(manifest)),
  };
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  try {
    const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt"]);
    const plaintext = canonicalBytes({ domain: PACKAGE_AAD, groups: transformed.released });
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: buffer(mappingAad(header)), tagLength: 128 }, key, buffer(plaintext));
    const receipt: PackageReceipt = { ...header, sealedMapping: { algorithm: "AES-GCM", aadScheme: PACKAGE_AAD, ivHex: hex(iv), ciphertextHex: hex(new Uint8Array(encrypted)) } };
    const secret: PackageSecret = { schemaVersion: PACKAGE_VERSION, secretType: "unblinding_secret", transformationId: identity.transformationId, keyHex: hex(rawKey) };
    const receiptArtifact = artifact(receipt);
    await parsePackageReceipt(receiptArtifact.bytes);
    return { files, receipt, secret, receiptArtifact, secretArtifact: artifact(secret) };
  } finally { rawKey.fill(0); }
}

function parseReleasedGroups(bytes: Uint8Array, receipt: PackageReceipt): ReleasedGroup[] {
  const p = parseJsonArtifactBytes(bytes, "Decrypted package mappings");
  requireExactKeys(p, ["domain", "groups"], "Decrypted package mappings");
  if (p.domain !== PACKAGE_AAD) throw new Error("Unexpected mapping domain.");
  const groups = requireArray(p.groups, "Released groups");
  if (groups.length !== receipt.manifest.mappingGroups.length) throw new Error("Released group count does not match manifest.");
  return groups.map((item, i) => {
    const group = requireRecord(item, "Released group");
    requireExactKeys(group, ["groupId", "mapping"], "Released group");
    const expected = receipt.manifest.mappingGroups[i];
    if (group.groupId !== expected.groupId) throw new Error("Released group identity does not match manifest.");
    const originals = new Set<Category>();
    const labels = new Set<string>();
    const types = new Set<string>();
    const mapping = requireArray(group.mapping, "Mapping entries").map((item) => {
      const entry = requireRecord(item, "Mapping entry");
      requireExactKeys(entry, ["original", "blinded"], "Mapping entry");
      const value = entry.original;
      if (!(typeof value === "string" && value.trim() || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0))) throw new Error("Invalid original category.");
      const original = value as Category;
      const blinded = requireNonblankString(entry, "blinded", "Neutral label");
      if (originals.has(original) || labels.has(blinded)) throw new Error("Mapping contains duplicate categories or labels.");
      originals.add(original); labels.add(blinded); types.add(typeof original);
      return { original, blinded };
    });
    if (mapping.length !== expected.categoryCount || types.size !== 1 || generateNeutralLabels(mapping.length).some((label) => !labels.has(label))) throw new Error("Released mapping does not match manifest metadata.");
    return { groupId: expected.groupId, mapping };
  });
}

/** Cryptographic primitive only. Never use as a substitute for Study authorization. */
export async function openDatasetPackageMapping(receiptBytes: Uint8Array, secretBytes: Uint8Array): Promise<ReleasedGroup[]> {
  const receipt = await parsePackageReceipt(new Uint8Array(receiptBytes));
  const secret = parsePackageSecret(secretBytes);
  if (receipt.transformationId !== secret.transformationId) throw new Error("Secret does not belong to this transformation.");
  const key = await crypto.subtle.importKey("raw", fromHex(secret.keyHex), { name: "AES-GCM" }, false, ["decrypt"]);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromHex(receipt.sealedMapping.ivHex), additionalData: buffer(mappingAad(packageHeader(receipt))), tagLength: 128 }, key, fromHex(receipt.sealedMapping.ciphertextHex));
  } catch { throw new Error("Secret could not authenticate the sealed package mapping."); }
  return parseReleasedGroups(new Uint8Array(plaintext), receipt);
}
