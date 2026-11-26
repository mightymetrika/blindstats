import { describe, expect, it, vi } from "vitest";
import { createDatasetPackage } from "@/lib/blinding/package-v05/package";
import { delimitedAdapter } from "@/lib/datasets/adapters/delimited";
import { createMultiBlindedPackage } from "@/lib/blinding/multi-blinding";
import { createBlindedPackage } from "@/lib/blinding/blinding-package";
import { sha256Hex } from "@/lib/blinding/hashing";
import { createAnalystKeyBackup, encryptBlindedDataset, decryptBlindedDataset } from "./crypto";
import { sendAuthorizedSecret, validateSecretForReceipt } from "./secret-transfer";
import type { SupabaseClient } from "@supabase/supabase-js";
const source = new TextEncoder().encode("id,arm,site\n1,A,N\n2,B,S\n");

describe("authorized unblinding secret transfer", () => {
  it("authenticates both historical and current secret formats against exact receipts", async () => {
    const current = await createMultiBlindedPackage(source,["arm","site"]);
    const historical = await createBlindedPackage(source,"arm");
    for (const p of [current,historical]) await expect(validateSecretForReceipt(p.secretArtifact.bytes,p.receiptArtifact.bytes,p.receipt.transformationId)).resolves.toBeUndefined();
    await expect(validateSecretForReceipt(historical.secretArtifact.bytes,current.receiptArtifact.bytes,current.receipt.transformationId)).rejects.toThrow();
  });
  it("authenticates a v0.5 package secret locally and refuses a different key or registered identity", async () => {
    const p = await createDatasetPackage([{datasetId:"d1",bytes:source,adapter:delimitedAdapter("csv")}],[{members:[{datasetId:"d1",variableId:"v2"}]}]);
    await expect(validateSecretForReceipt(p.secretArtifact.bytes,p.receiptArtifact.bytes,p.receipt.transformationId)).resolves.toBeUndefined();
    await expect(validateSecretForReceipt(p.secretArtifact.bytes,p.receiptArtifact.bytes,"wrong")).rejects.toThrow("Wrong registered transformation");
    const fake = new TextEncoder().encode(JSON.stringify({...p.secret,keyHex:"0".repeat(64)}));
    await expect(validateSecretForReceipt(fake,p.receiptArtifact.bytes,p.receipt.transformationId)).rejects.toThrow("authenticate");
  });
  it("rejects a secret from another transformation or a forged key before upload", async () => {
    const p = await createMultiBlindedPackage(source,["arm"]);
    const q = await createMultiBlindedPackage(source,["arm"]);
    const fake = new TextEncoder().encode(JSON.stringify({...p.secret,keyHex:"0".repeat(64)}));
    await expect(validateSecretForReceipt(q.secretArtifact.bytes,p.receiptArtifact.bytes,p.receipt.transformationId)).rejects.toThrow();
    await expect(validateSecretForReceipt(fake,p.receiptArtifact.bytes,p.receipt.transformationId)).rejects.toThrow();
  });
  it("does not upload when the authorization RPC denies release", async () => {
    const p = await createMultiBlindedPackage(source,["arm"]);
    const rpc = vi.fn().mockResolvedValue({data:null,error:{message:"denied"}});
    const from = vi.fn();
    const supabase = {rpc,storage:{from}} as unknown as SupabaseClient;
    await expect(sendAuthorizedSecret(supabase,p.secretArtifact.bytes,p.receiptArtifact.bytes,{studyId:"study",workflowId:"workflow",recipientId:"recipient",requestId:"request",transformationId:p.receipt.transformationId},null,false)).rejects.toThrow("not authorized");
    expect(from).not.toHaveBeenCalled();
  });
  it("cryptographically separates secret requests from dataset transfers", async () => {
    const p = await createMultiBlindedPackage(source,["arm"]);
    const context = {studyId:"study",workflowId:"workflow",recipientId:"recipient",transformationId:p.receipt.transformationId,plaintextSha256:await sha256Hex(p.secretArtifact.bytes)};
    const pass = "Synthetic recovery passphrase only";
    const backup = await createAnalystKeyBackup(context.studyId,context.recipientId,pass);
    const enc = await encryptBlindedDataset(p.secretArtifact.bytes,backup.publicJwk,{...context,secretRequestId:"request"});
    await expect(decryptBlindedDataset(enc.ciphertext,enc.ciphertextSha256,enc.envelope,{...context,secretRequestId:"request"},backup,context.recipientId,pass)).resolves.toEqual(p.secretArtifact.bytes);
    await expect(decryptBlindedDataset(enc.ciphertext,enc.ciphertextSha256,enc.envelope,context,backup,context.recipientId,pass)).rejects.toThrow();
    await expect(decryptBlindedDataset(enc.ciphertext,enc.ciphertextSha256,enc.envelope,{...context,secretRequestId:"other"},backup,context.recipientId,pass)).rejects.toThrow();
  });
});
