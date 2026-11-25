import { describe, expect, it } from "vitest";

import { sha256Hex } from "@/lib/blinding/hashing";
import {
  createAnalystKeyBackup, decryptBlindedDataset, encryptBlindedDataset,
  MAX_CIPHERTEXT_BYTES, type TransferContext,
} from "./crypto";

const studyId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const workflowId = "33333333-3333-4333-8333-333333333333";
const transformationId = "44444444-4444-4444-8444-444444444444";
const passphrase = "An excellent recovery passphrase only I know";
const data = new TextEncoder().encode("id,blinded_group\n1,A\n2,B\n");

async function fixture() {
  const plaintextSha256 = await sha256Hex(data);
  const context: TransferContext = {
    studyId, workflowId, transformationId, recipientId: userId, plaintextSha256,
  };
  const backup = await createAnalystKeyBackup(studyId, userId, passphrase);
  const encrypted = await encryptBlindedDataset(data, backup.publicJwk, context);
  return { context, backup, encrypted };
}

describe("browser encrypted blinded-dataset transfers", () => {
  it("recovers exact registered bytes using encrypted key backup on a new device", async () => {
    const { context, backup, encrypted } = await fixture();
    const recovered = await decryptBlindedDataset(
      encrypted.ciphertext, encrypted.ciphertextSha256,
      encrypted.envelope, context, backup, userId, passphrase,
    );
    expect(Array.from(recovered)).toEqual(Array.from(data));
    expect(encrypted.ciphertext).not.toEqual(data);
    expect(JSON.stringify(encrypted.envelope)).not.toContain(passphrase);
    expect(JSON.stringify(backup)).not.toContain(passphrase);
  });

  it("refuses an incorrect source dataset before upload", async () => {
    const { context, backup } = await fixture();
    await expect(encryptBlindedDataset(
      new TextEncoder().encode("different"), backup.publicJwk, context,
    )).rejects.toThrow(/registered blinded dataset/);
  });

  it("rejects an incorrect recovery passphrase", async () => {
    const { context, backup, encrypted } = await fixture();
    await expect(decryptBlindedDataset(
      encrypted.ciphertext, encrypted.ciphertextSha256,
      encrypted.envelope, context, backup, userId, "Incorrect recovery passphrase 2026",
    )).rejects.toThrow(/Unable to unlock/);
  });

  it("rejects ciphertext tampering before decryption", async () => {
    const { context, backup, encrypted } = await fixture();
    const changed = new Uint8Array(encrypted.ciphertext);
    changed[0] ^= 1;
    await expect(decryptBlindedDataset(
      changed, encrypted.ciphertextSha256, encrypted.envelope,
      context, backup, userId, passphrase,
    )).rejects.toThrow(/ciphertext failed SHA-256/);
  });

  it("cryptographically binds recipient, study, workflow, and transformation", async () => {
    const { context, backup, encrypted } = await fixture();
    for (const changed of [
      { ...context, studyId: "77777777-7777-4777-8777-777777777777" },
      { ...context, workflowId: "77777777-7777-4777-8777-777777777777" },
      { ...context, recipientId: "77777777-7777-4777-8777-777777777777" },
      { ...context, transformationId: "77777777-7777-4777-8777-777777777777" },
    ]) {
      await expect(decryptBlindedDataset(
        encrypted.ciphertext, encrypted.ciphertextSha256,
        encrypted.envelope, changed, backup, userId, passphrase,
      )).rejects.toThrow();
    }
  });

  it("rejects oversized ciphertext before upload", async () => {
    const { context, backup } = await fixture();
    const veryLarge = new Uint8Array(MAX_CIPHERTEXT_BYTES);
    await expect(encryptBlindedDataset(veryLarge, backup.publicJwk, {
      ...context, plaintextSha256: await sha256Hex(veryLarge),
    })).rejects.toThrow(/4 MiB/);
  });
});
