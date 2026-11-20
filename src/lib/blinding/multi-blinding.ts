import {
  parseJsonArtifactBytes,
  requireArray,
  requireCanonicalTimestamp,
  requireExactKeys,
  requireNonblankString,
  requirePositiveInteger,
  requireRecord,
  requireSha256,
} from "./artifact-validation";
import { parseCsvBytes, serializeCsvDataset } from "./csv";
import { sha256Hex } from "./hashing";
import { createTransformationIdentity } from "./identity";
import { generateNeutralLabels } from "./labels";
import { createBlindingMapping } from "./mapping";
import { applyBlindingMapping } from "./transform";
import {
  MULTI_BLINDING_SCHEMA_VERSION,
  MULTI_MAPPING_AAD_SCHEME,
  type ColumnBlindingMapping,
  type MultiBlindingReceipt,
  type MultiUnblindingSecret,
  type SelectedBlindingColumn,
} from "./multi-types";
import type { DatasetRow } from "./types";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder("utf-8", { fatal: true });
const PLAINTEXT_DOMAIN = "blindstats.sealed-mapping.plaintext.v2";
const HEX_KEY = /^[0-9a-f]{64}$/;
const HEX_IV = /^[0-9a-f]{24}$/;
const HEX_CIPHERTEXT = /^[0-9a-f]+$/;

export type MultiBlindedPackage = {
  source: { columns: string[]; rowCount: number; columnCount: number; sha256: string };
  blinded: { columns: string[]; rows: DatasetRow[]; text: string; bytes: Uint8Array; sha256: string };
  receipt: MultiBlindingReceipt;
  secret: MultiUnblindingSecret;
  receiptArtifact: { text: string; bytes: Uint8Array };
  secretArtifact: { text: string; bytes: Uint8Array };
};

function jsonArtifact(value: unknown) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  return { text, bytes: ENCODER.encode(text) };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  }
  return bytes;
}

function buffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function cryptoProvider(): Crypto {
  const provider = globalThis.crypto;
  if (!provider?.subtle || typeof provider.getRandomValues !== "function") {
    throw new Error("Secure Web Crypto is not available.");
  }
  return provider;
}

function validateSelectedColumns(
  selected: readonly SelectedBlindingColumn[],
  columnCount: number,
): void {
  if (selected.length < 1 || selected.length > columnCount) {
    throw new Error("Blinding requires at least one selected column.");
  }
  const names = new Set<string>();
  for (const { column, categoryCount } of selected) {
    if (!column.trim() || names.has(column)) {
      throw new Error("Selected blinding columns must be nonblank and unique.");
    }
    if (!Number.isSafeInteger(categoryCount) || categoryCount < 2) {
      throw new Error("Every selected column must have at least two nonmissing categories.");
    }
    names.add(column);
  }
}

function validateMapping(
  value: unknown,
  selected: readonly SelectedBlindingColumn[],
): ColumnBlindingMapping[] {
  const mappings = requireArray(value, "Decrypted column mappings");
  if (mappings.length !== selected.length) {
    throw new Error("Decrypted mapping count does not match the receipt.");
  }
  return mappings.map((item, index) => {
    const record = requireRecord(item, "Decrypted column mapping");
    requireExactKeys(record, ["column", "mapping"], "Decrypted column mapping");
    const column = requireNonblankString(record, "column", "Mapping column name");
    if (column !== selected[index].column) {
      throw new Error("Decrypted mapping columns do not match the receipt.");
    }
    const entries = requireArray(record.mapping, "Decrypted mapping entries");
    if (entries.length !== selected[index].categoryCount) {
      throw new Error("Decrypted mapping category count does not match the receipt.");
    }
    const originals = new Set<string>();
    const blinded = new Set<string>();
    const mapping = entries.map((entry) => {
      const pair = requireRecord(entry, "Decrypted mapping entry");
      requireExactKeys(pair, ["original", "blinded"], "Decrypted mapping entry");
      const original = requireNonblankString(pair, "original", "Original category");
      const neutral = requireNonblankString(pair, "blinded", "Neutral category");
      if (originals.has(original) || blinded.has(neutral)) {
        throw new Error("Decrypted mapping contains duplicate categories or labels.");
      }
      originals.add(original);
      blinded.add(neutral);
      return { original, blinded: neutral };
    });
    const expected = generateNeutralLabels(mapping.length);
    if (blinded.size !== expected.length || expected.some((label) => !blinded.has(label))) {
      throw new Error("Decrypted mapping uses an unexpected neutral-label set.");
    }
    return { column, mapping };
  });
}

function aad(receipt: MultiBlindingReceipt): Uint8Array {
  return ENCODER.encode(JSON.stringify({
    domain: MULTI_MAPPING_AAD_SCHEME,
    schemaVersion: MULTI_BLINDING_SCHEMA_VERSION,
    transformationId: receipt.transformationId,
    createdAt: receipt.createdAt,
    transformationType: receipt.transformationType,
    selectedColumns: receipt.selectedColumns,
    rowCount: receipt.rowCount,
    columnCount: receipt.columnCount,
    sourceArtifactSha256: receipt.sourceArtifact.sha256,
    blindedArtifactSha256: receipt.blindedArtifact.sha256,
    neutralLabelScheme: receipt.algorithm.neutralLabelScheme,
    mappingAssignment: receipt.algorithm.mappingAssignment,
  }));
}

export function parseMultiBlindingReceiptBytes(bytes: Uint8Array): MultiBlindingReceipt {
  const value = parseJsonArtifactBytes(bytes, "Multi-variable blinding receipt");
  requireExactKeys(value, [
    "schemaVersion", "transformationId", "createdAt", "transformationType",
    "selectedColumns", "rowCount", "columnCount", "sourceArtifact",
    "blindedArtifact", "sealedMapping", "algorithm",
  ], "Multi-variable blinding receipt");
  if (value.schemaVersion !== MULTI_BLINDING_SCHEMA_VERSION) {
    throw new Error("Unsupported multi-variable blinding receipt schema version.");
  }
  if (value.transformationType !== "categorical_label_permutation") {
    throw new Error("Unsupported blinding transformation type.");
  }
  const rowCount = requirePositiveInteger(value.rowCount, "Row count");
  const columnCount = requirePositiveInteger(value.columnCount, "Column count");
  const selection = requireArray(value.selectedColumns, "Selected columns").map((item) => {
    const selected = requireRecord(item, "Selected column");
    requireExactKeys(selected, ["column", "categoryCount"], "Selected column");
    return {
      column: requireNonblankString(selected, "column", "Selected column name"),
      categoryCount: requirePositiveInteger(selected.categoryCount, "Category count", 2),
    };
  });
  validateSelectedColumns(selection, columnCount);
  const source = requireRecord(value.sourceArtifact, "Source artifact");
  const blinded = requireRecord(value.blindedArtifact, "Blinded artifact");
  requireExactKeys(source, ["sha256"], "Source artifact");
  requireExactKeys(blinded, ["sha256"], "Blinded artifact");
  const sealed = requireRecord(value.sealedMapping, "Sealed mapping");
  requireExactKeys(sealed, [
    "algorithm", "keyLength", "tagLength", "encoding", "aadScheme",
    "ivHex", "ciphertextHex",
  ], "Sealed mapping");
  if (sealed.algorithm !== "AES-GCM" || sealed.keyLength !== 256 ||
      sealed.tagLength !== 128 || sealed.encoding !== "hex" ||
      sealed.aadScheme !== MULTI_MAPPING_AAD_SCHEME ||
      typeof sealed.ivHex !== "string" || !HEX_IV.test(sealed.ivHex) ||
      typeof sealed.ciphertextHex !== "string" ||
      sealed.ciphertextHex.length < 32 || sealed.ciphertextHex.length % 2 !== 0 ||
      !HEX_CIPHERTEXT.test(sealed.ciphertextHex)) {
    throw new Error("Unsupported or malformed encrypted mapping parameters.");
  }
  const algorithm = requireRecord(value.algorithm, "Blinding algorithm");
  requireExactKeys(algorithm, ["neutralLabelScheme", "mappingAssignment"], "Blinding algorithm");
  if (algorithm.neutralLabelScheme !== "Group_<letters>" ||
      algorithm.mappingAssignment !== "web_crypto_random_permutation") {
    throw new Error("Unsupported blinding algorithm.");
  }
  return {
    schemaVersion: MULTI_BLINDING_SCHEMA_VERSION,
    transformationId: requireNonblankString(value, "transformationId", "Transformation identifier"),
    createdAt: requireCanonicalTimestamp(value.createdAt, "Blinding creation time"),
    transformationType: "categorical_label_permutation",
    selectedColumns: selection,
    rowCount,
    columnCount,
    sourceArtifact: { sha256: requireSha256(source.sha256, "Source artifact hash") },
    blindedArtifact: { sha256: requireSha256(blinded.sha256, "Blinded artifact hash") },
    sealedMapping: {
      algorithm: "AES-GCM", keyLength: 256, tagLength: 128, encoding: "hex",
      aadScheme: MULTI_MAPPING_AAD_SCHEME,
      ivHex: sealed.ivHex as string, ciphertextHex: sealed.ciphertextHex as string,
    },
    algorithm: {
      neutralLabelScheme: "Group_<letters>",
      mappingAssignment: "web_crypto_random_permutation",
    },
  };
}

export function parseMultiUnblindingSecretBytes(bytes: Uint8Array): MultiUnblindingSecret {
  const secret = parseJsonArtifactBytes(bytes, "Multi-variable unblinding secret");
  requireExactKeys(secret, [
    "schemaVersion", "secretType", "transformationId", "keyAlgorithm",
    "keyLength", "encoding", "keyHex",
  ], "Multi-variable unblinding secret");
  if (secret.schemaVersion !== MULTI_BLINDING_SCHEMA_VERSION ||
      secret.secretType !== "unblinding_secret" ||
      secret.keyAlgorithm !== "AES-GCM" || secret.keyLength !== 256 ||
      secret.encoding !== "hex" || typeof secret.keyHex !== "string" ||
      !HEX_KEY.test(secret.keyHex)) {
    throw new Error("Unsupported or malformed multi-variable unblinding secret.");
  }
  return {
    schemaVersion: MULTI_BLINDING_SCHEMA_VERSION,
    secretType: "unblinding_secret",
    transformationId: requireNonblankString(secret, "transformationId", "Transformation identifier"),
    keyAlgorithm: "AES-GCM", keyLength: 256, encoding: "hex", keyHex: secret.keyHex,
  };
}

export async function openMultiBlindingMapping(
  receipt: MultiBlindingReceipt,
  secret: MultiUnblindingSecret,
): Promise<ColumnBlindingMapping[]> {
  // Validate objects even when supplied directly instead of through file parsers.
  const validatedReceipt = parseMultiBlindingReceiptBytes(jsonArtifact(receipt).bytes);
  const validatedSecret = parseMultiUnblindingSecretBytes(jsonArtifact(secret).bytes);
  if (validatedReceipt.transformationId !== validatedSecret.transformationId) {
    throw new Error("Unblinding secret transformation identifier does not match the receipt.");
  }
  const provider = cryptoProvider();
  const key = await provider.subtle.importKey("raw", buffer(hexToBytes(validatedSecret.keyHex)),
    { name: "AES-GCM" }, false, ["decrypt"]);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await provider.subtle.decrypt({
      name: "AES-GCM", iv: buffer(hexToBytes(validatedReceipt.sealedMapping.ivHex)),
      additionalData: buffer(aad(validatedReceipt)), tagLength: 128,
    }, key, buffer(hexToBytes(validatedReceipt.sealedMapping.ciphertextHex)));
  } catch {
    throw new Error("Unblinding secret could not authenticate and decrypt the sealed mapping.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(DECODER.decode(plaintext));
  } catch {
    throw new Error("Decrypted mapping is not valid UTF-8 JSON.");
  }
  const record = requireRecord(payload, "Decrypted mapping payload");
  requireExactKeys(record, ["domain", "columns"], "Decrypted mapping payload");
  if (record.domain !== PLAINTEXT_DOMAIN) {
    throw new Error("Decrypted mapping payload has an unexpected domain.");
  }
  return validateMapping(record.columns, validatedReceipt.selectedColumns);
}

export async function createMultiBlindedPackage(
  sourceBytes: Uint8Array,
  selectedColumns: readonly string[],
  createdAt: Date = new Date(),
): Promise<MultiBlindedPackage> {
  const parsed = parseCsvBytes(sourceBytes);
  if (selectedColumns.length < 1 || new Set(selectedColumns).size !== selectedColumns.length) {
    throw new Error("Select at least one distinct column for blinding.");
  }
  for (const column of selectedColumns) {
    if (!parsed.columns.includes(column)) {
      throw new Error(`Selected blinding column "${column}" does not exist in the source dataset.`);
    }
  }
  // Record selections in the source-file column order, not the click order.
  const selected = parsed.columns.filter((column) => selectedColumns.includes(column));
  const columnMappings: ColumnBlindingMapping[] = selected.map((column) => ({
    column, mapping: createBlindingMapping(parsed.rows.map((row) => row[column])),
  }));
  let rows = parsed.rows;
  for (const { column, mapping } of columnMappings) {
    rows = applyBlindingMapping(rows, column, mapping);
  }
  const serialized = serializeCsvDataset(parsed.columns, rows);
  const [sourceHash, blindedHash] = await Promise.all([
    sha256Hex(sourceBytes), sha256Hex(serialized.bytes),
  ]);
  const identity = createTransformationIdentity(createdAt);
  const selectedMetadata = columnMappings.map(({ column, mapping }) => ({
    column, categoryCount: mapping.length,
  }));
  validateSelectedColumns(selectedMetadata, parsed.columns.length);
  const provider = cryptoProvider();
  const rawKey = new Uint8Array(32);
  const iv = new Uint8Array(12);
  provider.getRandomValues(rawKey);
  provider.getRandomValues(iv);
  const receipt: MultiBlindingReceipt = {
    schemaVersion: MULTI_BLINDING_SCHEMA_VERSION,
    transformationId: identity.transformationId,
    createdAt: identity.createdAt,
    transformationType: "categorical_label_permutation",
    selectedColumns: selectedMetadata,
    rowCount: parsed.rows.length,
    columnCount: parsed.columns.length,
    sourceArtifact: { sha256: sourceHash },
    blindedArtifact: { sha256: blindedHash },
    sealedMapping: {
      algorithm: "AES-GCM", keyLength: 256, tagLength: 128, encoding: "hex",
      aadScheme: MULTI_MAPPING_AAD_SCHEME, ivHex: bytesToHex(iv), ciphertextHex: "",
    },
    algorithm: {
      neutralLabelScheme: "Group_<letters>",
      mappingAssignment: "web_crypto_random_permutation",
    },
  };
  const key = await provider.subtle.importKey("raw", buffer(rawKey),
    { name: "AES-GCM" }, false, ["encrypt"]);
  const plaintext = ENCODER.encode(JSON.stringify({
    domain: PLAINTEXT_DOMAIN, columns: columnMappings,
  }));
  const cipher = await provider.subtle.encrypt({
    name: "AES-GCM", iv: buffer(iv), additionalData: buffer(aad(receipt)), tagLength: 128,
  }, key, buffer(plaintext));
  receipt.sealedMapping.ciphertextHex = bytesToHex(new Uint8Array(cipher));
  const secret: MultiUnblindingSecret = {
    schemaVersion: MULTI_BLINDING_SCHEMA_VERSION,
    secretType: "unblinding_secret",
    transformationId: identity.transformationId,
    keyAlgorithm: "AES-GCM", keyLength: 256, encoding: "hex", keyHex: bytesToHex(rawKey),
  };
  return {
    source: {
      columns: [...parsed.columns], rowCount: parsed.rows.length,
      columnCount: parsed.columns.length, sha256: sourceHash,
    },
    blinded: {
      columns: [...parsed.columns], rows, text: serialized.text,
      bytes: serialized.bytes, sha256: blindedHash,
    },
    receipt, secret,
    receiptArtifact: jsonArtifact(receipt), secretArtifact: jsonArtifact(secret),
  };
}
