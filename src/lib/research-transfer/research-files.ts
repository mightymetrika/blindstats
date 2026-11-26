import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256Hex } from "@/lib/blinding/hashing";
import type { ManifestDataset } from "@/lib/blinding/package-v05/receipt";
import { decryptResearchFile, encryptResearchFile, RESEARCH_FILE_ALGORITHM,
  type AnalystKeyBackup, type PublicKeyJwk, type ResearchFileContext, type ResearchFileEnvelope } from "./crypto";
import { MAX_TRANSFER_OBJECT_BYTES, transferStoragePath, uploadTransferObject } from "./storage";

export const MANAGED_FILE_VERSION = "v47-managed-atrest-1" as const;
export const MAX_BATCH_FILES = 20;
export const SUPPORTING_FILE_ACCEPT = ".pdf,.docx,.txt,.md,.csv,.tsv,.xlsx,.r,.rmd,.qmd,.py,.sas,.sps,.do,.json,.yaml,.yml,.ipynb,.pptx,.rtf";
export type FileProtection = "managed_at_rest_v1" | "recipient_e2ee_v1";
export type FilePurpose = ResearchFileContext["purpose"];
export type ResearchFileRecord = {
  id: string; filename: string; sender_id: string; recipient_id: string; state: string;
  file_purpose: FilePurpose; artifact_id: string | null; plaintext_sha256: string; plaintext_byte_length: number;
  ciphertext_sha256: string | null; ciphertext_byte_length: number | null;
  envelope: ResearchFileEnvelope | { version: typeof MANAGED_FILE_VERSION } | null;
  transfer_mode: FileProtection; created_at: string; ready_at: string | null; abandoned_at: string | null;
};
export type PackageDelivery = { workflowId: string; transformationId: string; datasets: Pick<ManifestDataset, "datasetId" | "blinded">[] };
export type PreparedResearchFile = {
  filename: string; bytes: Uint8Array; sha256: string; artifactId: string | null;
  purpose: FilePurpose;
};
export type FileDeliveryContext = {
  studyId: string; recipientId: string; protection: FileProtection;
  packageDelivery: PackageDelivery | null;
};

export function safeSupportingFilename(name: string): boolean {
  return name.trim() === name && name.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9._ -]*\.(pdf|docx|txt|md|csv|tsv|xlsx|r|rmd|qmd|py|sas|sps|do|json|yaml|yml|ipynb|pptx|rtf)$/i.test(name) &&
    !name.includes("..") && !/unblind.*secret|unblind.*receipt|released.*mapping/i.test(name) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name);
}

// This is a local accidental-disclosure guard, not a general content safety
// classifier. No research file contents are interpreted or uploaded for scanning.
export function rejectKnownSecret(bytes: Uint8Array): void {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return; }
  if (!value || typeof value !== "object") return;
  // Inspect nested JSON as well; bounded by the file-size limit, iterative
  // traversal avoids recursion on maliciously deep documents.
  const pending: unknown[] = [value];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object") continue;
    const record = current as Record<string, unknown>;
    if (record.secretType === "unblinding_secret" ||
        (typeof record.keyHex === "string" && typeof record.transformationId === "string") ||
        "releasedMapping" in record || "releasedMappings" in record || "releasedGroups" in record) {
      throw new Error("Use the authorized unblinding workflow for secrets and released mappings.");
    }
    for (const child of Object.values(record)) if (child && typeof child === "object") pending.push(child);
  }
}

export async function prepareResearchFile(filename: string, bytes: Uint8Array, purpose: FilePurpose,
  protection: FileProtection, packageDelivery: PackageDelivery | null): Promise<PreparedResearchFile> {
  if (!bytes.length || bytes.length > MAX_TRANSFER_OBJECT_BYTES - (protection === "recipient_e2ee_v1" ? 16 : 0)) {
    throw new Error("File is empty or exceeds the 4 MiB stored-object limit (including encryption overhead).");
  }
  const stable = new Uint8Array(bytes);
  const sha256 = await sha256Hex(stable);
  let artifactId: string | null = null;
  if (purpose === "package_dataset") {
    const dataset = packageDelivery?.datasets.find((item) => item.blinded.filename === filename);
    if (!dataset || dataset.blinded.sha256 !== sha256 || dataset.blinded.byteLength !== stable.length) {
      throw new Error("Filename, hash and size must match a registered blinded dataset.");
    }
    artifactId = dataset.datasetId;
  } else if (purpose === "supporting") {
    if (!safeSupportingFilename(filename)) throw new Error("Choose a supported safe research filename; secret and released-mapping files are not allowed.");
    rejectKnownSecret(stable);
  } else throw new Error("Unsupported research file purpose.");
  return { filename, bytes: stable, sha256, artifactId, purpose };
}

export function researchFileContext(delivery: FileDeliveryContext, transferId: string,
  file: Pick<PreparedResearchFile, "filename" | "purpose" | "artifactId" | "sha256">, byteLength: number): ResearchFileContext {
  const p = file.purpose === "package_dataset" ? delivery.packageDelivery : null;
  if (file.purpose === "package_dataset" && (!p || !file.artifactId)) throw new Error("Registered dataset identity required.");
  if (file.purpose === "supporting" && file.artifactId !== null) throw new Error("Supporting file cannot have a dataset identity.");
  return { studyId: delivery.studyId, recipientId: delivery.recipientId, transferId,
    workflowId: p?.workflowId ?? null, transformationId: p?.transformationId ?? null,
    purpose: file.purpose, artifactId: file.artifactId, filename: file.filename,
    plaintextSha256: file.sha256, plaintextByteLength: byteLength };
}

export async function sendResearchFile(supabase: SupabaseClient, delivery: FileDeliveryContext,
  file: PreparedResearchFile, recipientKey: PublicKeyJwk | null): Promise<string> {
  if (delivery.protection === "recipient_e2ee_v1" && !recipientKey) throw new Error("Analyst Study encryption key is required.");
  // Recheck at the upload boundary, even for a prepared file supplied by another caller.
  const validated = await prepareResearchFile(file.filename, file.bytes, file.purpose, delivery.protection, delivery.packageDelivery);
  if (validated.sha256 !== file.sha256 || validated.artifactId !== file.artifactId) throw new Error("Prepared file identity changed.");
  const initiated = await supabase.rpc("initiate_research_file", {
    p_study_id: delivery.studyId, p_workflow_id: file.purpose === "package_dataset" ? delivery.packageDelivery!.workflowId : null,
    p_recipient_id: delivery.recipientId, p_file_purpose: file.purpose, p_artifact_id: file.artifactId,
    p_filename: file.filename, p_plaintext_sha256: file.sha256, p_plaintext_byte_length: validated.bytes.length,
    p_transfer_mode: delivery.protection,
  });
  if (initiated.error || typeof initiated.data !== "string") throw new Error(initiated.error?.message ?? "Unable to initiate research file.");
  const id = initiated.data;
  const context = researchFileContext(delivery, id, file, validated.bytes.length);
  try {
    const encrypted = delivery.protection === "recipient_e2ee_v1" && recipientKey
      ? await encryptResearchFile(validated.bytes, recipientKey, context) : null;
    const stored = encrypted?.ciphertext ?? validated.bytes;
    await uploadTransferObject(supabase, transferStoragePath(delivery.studyId, id), stored);
    const complete = await supabase.rpc("complete_research_file", {
      p_transfer_id: id, p_object_sha256: encrypted?.ciphertextSha256 ?? file.sha256,
      p_object_byte_length: stored.length, p_envelope: encrypted?.envelope ?? { version: MANAGED_FILE_VERSION },
    });
    if (complete.error) throw new Error(complete.error.message);
    return id;
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : "Send failed."} Review the pending file before retrying; no stored object will be overwritten.`);
  }
}

export async function verifyDeliveredResearchFile(record: ResearchFileRecord, delivery: FileDeliveryContext,
  stored: Uint8Array, backup: Pick<AnalystKeyBackup, "wrappedPrivateKey" | "salt" | "iv"> | null, passphrase: string): Promise<Uint8Array> {
  if (record.recipient_id !== delivery.recipientId || record.state !== "ready" || record.abandoned_at ||
      record.transfer_mode !== delivery.protection || !record.ciphertext_sha256 || !record.ciphertext_byte_length ||
      stored.length !== record.ciphertext_byte_length || stored.length > MAX_TRANSFER_OBJECT_BYTES ||
      await sha256Hex(stored) !== record.ciphertext_sha256) throw new Error("Research file integrity or recipient verification failed.");
  const context = researchFileContext(delivery, record.id, { filename: record.filename, purpose: record.file_purpose,
    artifactId: record.artifact_id, sha256: record.plaintext_sha256 }, record.plaintext_byte_length);
  let plaintext = stored;
  if (record.transfer_mode === "recipient_e2ee_v1") {
    if (!backup || record.envelope?.version !== RESEARCH_FILE_ALGORITHM) throw new Error("Study recipient key and valid file envelope are required.");
    plaintext = await decryptResearchFile(stored, record.ciphertext_sha256, record.envelope, context, backup, delivery.recipientId, passphrase);
  } else if (record.envelope?.version !== MANAGED_FILE_VERSION) throw new Error("Invalid managed file envelope.");
  const validated = await prepareResearchFile(record.filename, plaintext, record.file_purpose, record.transfer_mode, delivery.packageDelivery);
  if (validated.sha256 !== record.plaintext_sha256 || validated.bytes.length !== record.plaintext_byte_length || validated.artifactId !== record.artifact_id) {
    throw new Error("Downloaded plaintext does not match registered file identity.");
  }
  return validated.bytes;
}

export async function retrieveResearchFile(supabase: SupabaseClient, record: ResearchFileRecord, delivery: FileDeliveryContext,
  backup: Pick<AnalystKeyBackup, "wrappedPrivateKey" | "salt" | "iv"> | null, passphrase: string) {
  const response = await fetch(`/api/research-transfers/${encodeURIComponent(record.id)}/download`, { method: "POST", cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new Error("Download unavailable or access denied.");
  const plaintext = await verifyDeliveredResearchFile(record, delivery, new Uint8Array(await response.arrayBuffer()), backup, passphrase);
  const acknowledged = await supabase.rpc("acknowledge_research_transfer", { p_transfer_id: record.id, p_plaintext_sha256: record.plaintext_sha256 });
  if (acknowledged.error) throw new Error(acknowledged.error.message);
  return plaintext;
}
