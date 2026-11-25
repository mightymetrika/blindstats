import { sha256Hex } from "@/lib/blinding/hashing";
import { parseSupportedBlindingReceiptBytes } from "@/lib/blinding/public-receipt-version";
import { openMultiBlindingMapping, parseMultiUnblindingSecretBytes } from "@/lib/blinding/multi-blinding";
import { parseUnblindingSecretBytes } from "@/lib/blinding/unblinding-secret";
import { openBlindingMapping } from "@/lib/blinding/mapping-crypto";
import { decryptBlindedDataset, encryptBlindedDataset, type AnalystKeyBackup, type PublicKeyJwk, type TransferContext, type TransferEnvelope } from "./crypto";
import { MAX_SECRET_TRANSFER_BYTES, SECRET_TRANSFER_BUCKET } from "./secret-constants";
import { transferStoragePath } from "./storage";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SecretTransferRecord = {
  id: string; recipient_id: string; plaintext_sha256: string;
  transfer_mode: "managed_at_rest_v1" | "recipient_e2ee_v1";
  object_sha256: string | null; object_byte_length: number | null;
  envelope: TransferEnvelope | { version: "v46-managed-atrest-1" } | null;
  ready_at: string | null;
};
export type SecretTransferContext = {
  studyId: string; workflowId: string; transformationId: string;
  requestId: string; recipientId: string;
};
export type SecretBackup = Pick<AnalystKeyBackup, "wrappedPrivateKey" | "salt" | "iv">;
function cryptoContext(context: SecretTransferContext, plaintextSha256: string): TransferContext {
  return { studyId: context.studyId, workflowId: context.workflowId, transformationId: context.transformationId,
    recipientId: context.recipientId, secretRequestId: context.requestId, plaintextSha256 };
}
// Authenticate the supplied secret against the exact sealed mapping locally.
// No mapping, secret, or generated unblinding receipt is returned or logged.
export async function validateSecretForReceipt(bytes: Uint8Array, receiptBytes: Uint8Array, transformationId: string) {
  if (bytes.length < 1 || bytes.length > MAX_SECRET_TRANSFER_BYTES - 16) throw new Error("Choose a valid unblinding secret JSON file (maximum 16 KiB).");
  const receipt = parseSupportedBlindingReceiptBytes(receiptBytes);
  if (receipt.transformationId !== transformationId) throw new Error("Wrong registered transformation.");
  if (receipt.schemaVersion === "0.4") {
    const secret = parseMultiUnblindingSecretBytes(bytes);
    if (secret.transformationId !== transformationId) throw new Error("This secret belongs to another transformation.");
    await openMultiBlindingMapping(receipt, secret);
  } else {
    const secret = parseUnblindingSecretBytes(bytes);
    if (secret.transformationId !== transformationId) throw new Error("This secret belongs to another transformation.");
    await openBlindingMapping(receipt, secret);
  }
}
export async function sendAuthorizedSecret(supabase: SupabaseClient, bytes: Uint8Array, receiptBytes: Uint8Array,
  context: SecretTransferContext, publicKey: PublicKeyJwk | null, useRecipientOnly: boolean) {
  await validateSecretForReceipt(bytes, receiptBytes, context.transformationId);
  const hash = await sha256Hex(bytes);
  if (useRecipientOnly && !publicKey) throw new Error("The analyst must set up recipient-only encryption first.");
  const encrypted = useRecipientOnly && publicKey ? await encryptBlindedDataset(bytes, publicKey, cryptoContext(context, hash)) : null;
  const payload = encrypted?.ciphertext ?? bytes;
  const { data: id, error } = await supabase.rpc("initiate_unblinding_secret_transfer", {
    p_request_id: context.requestId, p_plaintext_sha256: hash,
    p_transfer_mode: encrypted ? "recipient_e2ee_v1" : "managed_at_rest_v1",
  });
  if (error || typeof id !== "string") throw new Error("Secret delivery is not authorized or a transfer already exists.");
  const upload = await supabase.storage.from(SECRET_TRANSFER_BUCKET).upload(transferStoragePath(context.studyId, id),
    new Blob([new Uint8Array(payload).buffer], { type: "application/octet-stream" }),
    { upsert: false, contentType: "application/octet-stream" });
  if (upload.error) throw new Error("Secret upload failed. Retain your local secret; a pending transfer may need operator cleanup.");
  const completed = await supabase.rpc("complete_unblinding_secret_transfer", {
    p_transfer_id: id, p_object_sha256: encrypted?.ciphertextSha256 ?? hash, p_object_byte_length: payload.length,
    p_envelope: encrypted?.envelope ?? { version: "v46-managed-atrest-1" },
  });
  if (completed.error) throw new Error("Secret upload could not be finalized. Retain your local secret and contact the operator.");
}
export async function retrieveAuthorizedSecret(record: SecretTransferRecord,
  context: SecretTransferContext, backup: SecretBackup | null, passphrase: string) {
  if (!record.ready_at || record.recipient_id !== context.recipientId || !record.object_sha256 || !record.object_byte_length) throw new Error("Secret is not ready.");
  const response = await fetch(`/api/unblinding-secret-transfers/${encodeURIComponent(record.id)}/download`, { method: "POST", cache: "no-store" });
  if (!response.ok) throw new Error("Unable to retrieve the authorized secret.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== record.object_byte_length || await sha256Hex(bytes) !== record.object_sha256) throw new Error("Secret integrity verification failed.");
  let plaintext = bytes;
  if (record.transfer_mode === "recipient_e2ee_v1") {
    if (!backup || record.envelope?.version !== "v46-ecdh-hkdf-aes256gcm-1") throw new Error("Recipient encryption key required.");
    plaintext = new Uint8Array(await decryptBlindedDataset(bytes, record.object_sha256, record.envelope, cryptoContext(context, record.plaintext_sha256), backup, context.recipientId, passphrase));
  }
  if (await sha256Hex(plaintext) !== record.plaintext_sha256) throw new Error("Secret SHA-256 verification failed.");
  return plaintext;
}
