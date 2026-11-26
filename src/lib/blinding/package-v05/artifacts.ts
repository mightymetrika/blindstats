import { requireNonblankString, requirePositiveInteger, requireRecord, requireExactKeys, requireSha256 } from "../artifact-validation";
import { sha256Hex } from "../hashing";

export type FileReference = { filename: string; sha256: string; byteLength: number };
export type FileInput = { filename: string; bytes: Uint8Array };
export function artifact(value: unknown) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  return { text, bytes: new TextEncoder().encode(text) };
}
export function canonicalBytes(value: unknown): Uint8Array {
  // All protocol objects are reconstructed by strict parsers in fixed key order.
  // Array order is significant; never sort arrays or hash a raw parsed object.
  return new TextEncoder().encode(JSON.stringify(value));
}
export function filename(value: string): string {
  const hasControl = Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
  if (!value.trim() || /[\\/]/u.test(value) || hasControl || value === "." || value === "..") {
    throw new Error("Artifact filename must be a nonblank basename without control characters.");
  }
  return value;
}
export function safeInteger(value: unknown, label: string, minimum = 1): number {
  const n = requirePositiveInteger(value, label, minimum);
  if (!Number.isSafeInteger(n)) throw new Error(`${label} must be a safe integer.`);
  return n;
}
export function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`);
}
export function parseFileReference(value: unknown): FileReference {
  const item = requireRecord(value, "File reference");
  requireExactKeys(item, ["filename", "sha256", "byteLength"], "File reference");
  return {
    filename: filename(requireNonblankString(item, "filename", "Filename")),
    sha256: requireSha256(item.sha256, "File hash"),
    byteLength: safeInteger(item.byteLength, "File byte length", 0),
  };
}
export async function describeFile(input: FileInput): Promise<FileReference> {
  return { filename: filename(input.filename), sha256: await sha256Hex(input.bytes), byteLength: input.bytes.byteLength };
}
export async function verifyFiles(expected: readonly FileReference[], actual: readonly FileInput[]): Promise<void> {
  unique(expected.map((x) => x.filename), "Expected filenames");
  unique(actual.map((x) => x.filename), "Provided filenames");
  if (actual.length !== expected.length) throw new Error("File set does not match the manifest.");
  const byName = new Map(actual.map((item) => [item.filename, item]));
  for (const reference of expected) {
    const supplied = byName.get(reference.filename);
    if (!supplied || supplied.bytes.byteLength !== reference.byteLength ||
        await sha256Hex(supplied.bytes) !== reference.sha256) {
      throw new Error(`File integrity verification failed: ${reference.filename}`);
    }
  }
}
export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
export function fromHex(value: string): ArrayBuffer {
  return Uint8Array.from(value.match(/../g) ?? [], (b) => Number.parseInt(b, 16)).buffer;
}
export function requireHex(value: unknown, length: number | null, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]+$/.test(value) || value.length % 2 ||
      (length !== null && value.length !== length)) throw new Error(`Invalid ${label}.`);
  return value;
}
