import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256Hex } from "@/lib/blinding/hashing";
import { createAnalystKeyBackup, decryptBlindedDataset, encryptBlindedDataset, encryptResearchFile, decryptResearchFile } from "./crypto";
import { MANAGED_FILE_VERSION, prepareResearchFile, researchFileContext, sendResearchFile, verifyDeliveredResearchFile,
  type FileDeliveryContext, type ResearchFileRecord } from "./research-files";
import { MAX_TRANSFER_OBJECT_BYTES } from "./storage";

const bytes = new TextEncoder().encode("arm\nGroup_A\nGroup_B\n");
const studyId = "11111111-1111-4111-8111-111111111111";
const recipientId = "22222222-2222-4222-8222-222222222222";
const transferId = "33333333-3333-4333-8333-333333333333";
const passphrase = "Synthetic file delivery recovery passphrase";
async function fixture() {
  const sha256 = await sha256Hex(bytes);
  const packageDelivery = { workflowId: "workflow", transformationId: "transformation", datasets: [
    { datasetId: "d1", blinded: { filename: "blinded-dataset-1.csv", sha256, byteLength: bytes.length } },
    { datasetId: "d2", blinded: { filename: "blinded-dataset-2.csv", sha256, byteLength: bytes.length } },
  ] };
  const delivery: FileDeliveryContext = { studyId, recipientId, protection: "managed_at_rest_v1", packageDelivery };
  const file = await prepareResearchFile("blinded-dataset-1.csv", bytes, "package_dataset", delivery.protection, packageDelivery);
  const record: ResearchFileRecord = { id: transferId, filename: file.filename, sender_id: "sender", recipient_id: recipientId,
    state: "ready", file_purpose: file.purpose, artifact_id: file.artifactId, plaintext_sha256: sha256,
    plaintext_byte_length: bytes.length, ciphertext_sha256: sha256, ciphertext_byte_length: bytes.length,
    envelope: { version: MANAGED_FILE_VERSION }, transfer_mode: delivery.protection, created_at: "2026-11-26T00:00:00Z",
    ready_at: "2026-11-26T00:00:01Z", abandoned_at: null };
  return { delivery, file, record };
}

describe("v47 per-file delivery", () => {
  it("matches exact dataset identity and allows distinct datasets with identical hashes", async () => {
    const { delivery, file } = await fixture();
    expect(file.artifactId).toBe("d1");
    const second = await prepareResearchFile("blinded-dataset-2.csv", bytes, "package_dataset", delivery.protection, delivery.packageDelivery);
    expect(second.artifactId).toBe("d2"); expect(second.sha256).toBe(file.sha256);
    for (const [name, data] of [["renamed.csv", bytes], [file.filename, new TextEncoder().encode("different")]] as const) {
      await expect(prepareResearchFile(name, data, "package_dataset", delivery.protection, delivery.packageDelivery)).rejects.toThrow(/registered blinded dataset/);
    }
    await expect(prepareResearchFile(file.filename, bytes, "package_dataset", delivery.protection, null)).rejects.toThrow();
  });
  it("accepts arbitrary supported document bytes independently of a transformation", async () => {
    const document = new Uint8Array([80, 75, 3, 4, 0, 255]);
    const file = await prepareResearchFile("protocol.docx", document, "supporting", "managed_at_rest_v1", null);
    expect(file.artifactId).toBeNull(); expect(Array.from(file.bytes)).toEqual(Array.from(document));
  });
  it("rejects unsafe names, obvious secret artifacts, and disguised known JSON payloads", async () => {
    for (const name of ["../protocol.pdf", "CON.txt", "tool.exe", "unblinding-secret.json", "released-mapping.txt"]) {
      await expect(prepareResearchFile(name, bytes, "supporting", "managed_at_rest_v1", null)).rejects.toThrow();
    }
    for (const payload of [{secretType:"unblinding_secret"}, {keyHex:"a".repeat(64),transformationId:"id"}, {report:{releasedMappings:[]}}]) {
      await expect(prepareResearchFile("protocol.txt", new TextEncoder().encode(JSON.stringify(payload)), "supporting", "managed_at_rest_v1", null)).rejects.toThrow(/authorized unblinding/);
    }
  });
  it("enforces the stored-object size including the GCM tag", async () => {
    await expect(prepareResearchFile("protocol.txt", new Uint8Array(0), "supporting", "managed_at_rest_v1", null)).rejects.toThrow();
    await expect(prepareResearchFile("protocol.txt", new Uint8Array(MAX_TRANSFER_OBJECT_BYTES - 15), "supporting", "recipient_e2ee_v1", null)).rejects.toThrow(/4 MiB/);
  });
  it("verifies the stored and plaintext hashes, length, identity and recipient before download", async () => {
    const { delivery, record } = await fixture();
    expect(Array.from(await verifyDeliveredResearchFile(record, delivery, bytes, null, ""))).toEqual(Array.from(bytes));
    for (const changed of [{...record, artifact_id:"d2"}, {...record, recipient_id:"other"}, {...record, plaintext_byte_length:1}, {...record, plaintext_sha256:"0".repeat(64)}, {...record, state:"pending"}, {...record, abandoned_at:"date"}]) {
      await expect(verifyDeliveredResearchFile(changed, delivery, bytes, null, "")).rejects.toThrow();
    }
    const tampered = new Uint8Array(bytes); tampered[0] ^= 1;
    await expect(verifyDeliveredResearchFile(record, delivery, tampered, null, "")).rejects.toThrow();
  });
  it("binds new encrypted bytes to each purpose, transfer, manifest artifact and filename, and preserves legacy decoding", async () => {
    const { delivery, record, file } = await fixture(); delivery.protection = "recipient_e2ee_v1";
    const backup = await createAnalystKeyBackup(studyId, recipientId, passphrase);
    const context = researchFileContext(delivery, transferId, file, bytes.length);
    const encrypted = await encryptResearchFile(bytes, backup.publicJwk, context);
    const encryptedRecord: ResearchFileRecord = {...record, transfer_mode: delivery.protection,
      ciphertext_sha256: encrypted.ciphertextSha256, ciphertext_byte_length: encrypted.ciphertext.length, envelope: encrypted.envelope};
    expect(Array.from(await verifyDeliveredResearchFile(encryptedRecord, delivery, encrypted.ciphertext, backup, passphrase))).toEqual(Array.from(bytes));
    for (const changed of [{...context, transferId:"other"}, {...context, artifactId:"d2"}, {...context, filename:"other.csv"},
      {...context, purpose:"supporting" as const}, {...context, plaintextByteLength:bytes.length + 1}, {...context, workflowId:"different"}]) {
      await expect(decryptResearchFile(encrypted.ciphertext, encrypted.ciphertextSha256, encrypted.envelope, changed, backup, recipientId, passphrase)).rejects.toThrow();
    }
    const oldContext = {studyId, recipientId, workflowId:"workflow", transformationId:"transformation", plaintextSha256:file.sha256};
    const old = await encryptBlindedDataset(bytes, backup.publicJwk, oldContext);
    expect(Array.from(await decryptBlindedDataset(old.ciphertext, old.ciphertextSha256, old.envelope, oldContext, backup, recipientId, passphrase))).toEqual(Array.from(bytes));
    await expect(decryptBlindedDataset(encrypted.ciphertext, encrypted.ciphertextSha256, {...encrypted.envelope,version:"v46-ecdh-hkdf-aes256gcm-1"}, oldContext, backup, recipientId, passphrase)).rejects.toThrow();
  }, 15000);
  it("uses the immutable transfer ID, never overwrites storage, and never completes a failed upload", async () => {
    const { delivery, file } = await fixture();
    const rpc = vi.fn().mockResolvedValueOnce({data:transferId,error:null}).mockResolvedValueOnce({data:null,error:null});
    const upload = vi.fn().mockResolvedValue({error:null});
    const client = {rpc, storage:{from:vi.fn(()=>({upload}))}} as unknown as SupabaseClient;
    expect(await sendResearchFile(client, delivery, file, null)).toBe(transferId);
    expect(rpc.mock.calls.map(call=>call[0])).toEqual(["initiate_research_file","complete_research_file"]);
    expect(rpc.mock.calls[0][1]).toMatchObject({p_artifact_id:"d1",p_plaintext_byte_length:bytes.length,p_file_purpose:"package_dataset"});
    expect(upload.mock.calls[0][0]).toBe(`${studyId}/${transferId}.bin`);
    expect(upload.mock.calls[0][2]).toMatchObject({upsert:false});
    rpc.mockReset().mockResolvedValueOnce({data:transferId,error:null}); upload.mockResolvedValue({error:{message:"upload failed"}});
    await expect(sendResearchFile(client, delivery, file, null)).rejects.toThrow(/pending file/);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
