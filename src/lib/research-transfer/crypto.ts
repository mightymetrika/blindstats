// Browser-local v46 encryption. Neither plaintext CSV nor private keys are
// submitted to the server. Each transfer has one independently keyed recipient.
import { sha256Hex } from "@/lib/blinding/hashing";

import { MAX_TRANSFER_OBJECT_BYTES } from "./storage";

export const MAX_CIPHERTEXT_BYTES = MAX_TRANSFER_OBJECT_BYTES;
export const PBKDF2_ITERATIONS = 600_000;
export const TRANSFER_ALGORITHM = "v46-ecdh-hkdf-aes256gcm-1";

export type PublicKeyJwk = {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
};

export type TransferEnvelope = {
  version: typeof TRANSFER_ALGORITHM;
  ephemeralPublicJwk: PublicKeyJwk;
  salt: string;
  iv: string;
};

export type TransferContext = {
  studyId: string;
  workflowId: string;
  transformationId: string;
  recipientId: string;
  plaintextSha256: string;
  secretRequestId?: string;
};

export type AnalystKeyBackup = {
  publicJwk: PublicKeyJwk;
  wrappedPrivateKey: string;
  salt: string;
  iv: string;
};

function subtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("A secure browser context with Web Crypto is required.");
  }
  return globalThis.crypto.subtle;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function base64(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    result += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(result);
}

function unbase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

function asBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function contextBytes(context: TransferContext): Uint8Array {
  return new TextEncoder().encode(JSON.stringify([
    context.secretRequestId ? "blindstats-v46-unblinding-secret" : "blindstats-v46-blinded-dataset", context.studyId, context.workflowId,
    context.transformationId, context.recipientId, context.plaintextSha256,
    ...(context.secretRequestId ? [context.secretRequestId] : []),
  ]));
}

function keyBackupContext(studyId: string, userId: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify([
    "blindstats-v46-analyst-key", studyId, userId,
  ]));
}

function publicJwk(jwk: JsonWebKey): PublicKeyJwk {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" ||
      !jwk.x || !jwk.y || !/^[A-Za-z0-9_-]{43}$/.test(jwk.x) ||
      !/^[A-Za-z0-9_-]{43}$/.test(jwk.y) || jwk.d) {
    throw new Error("Invalid P-256 public encryption key.");
  }
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

async function passwordKey(
  passphrase: string, salt: Uint8Array,
): Promise<CryptoKey> {
  if (passphrase.length < 16) {
    throw new Error("Recovery passphrase must contain at least 16 characters.");
  }
  const material = await subtle().importKey(
    "raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"],
  );
  return subtle().deriveKey({
    name: "PBKDF2", hash: "SHA-256", salt: asBuffer(salt),
    iterations: PBKDF2_ITERATIONS,
  }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function createAnalystKeyBackup(
  studyId: string, userId: string, passphrase: string,
): Promise<AnalystKeyBackup> {
  const pair = await subtle().generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
  );
  const pkcs8 = await subtle().exportKey("pkcs8", pair.privateKey);
  const jwk = publicJwk(await subtle().exportKey("jwk", pair.publicKey));
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await passwordKey(passphrase, salt);
  let wrapped: ArrayBuffer;
  try {
    wrapped = await subtle().encrypt({
      name: "AES-GCM", iv: asBuffer(iv),
      additionalData: asBuffer(keyBackupContext(studyId, userId)),
    }, key, pkcs8);
  } finally {
    new Uint8Array(pkcs8).fill(0);
  }
  return {
    publicJwk: jwk, wrappedPrivateKey: base64(new Uint8Array(wrapped)),
    salt: base64(salt), iv: base64(iv),
  };
}

async function unlockPrivateKey(
  studyId: string, userId: string, passphrase: string,
  backup: Pick<AnalystKeyBackup, "wrappedPrivateKey" | "salt" | "iv">,
): Promise<CryptoKey> {
  try {
    const key = await passwordKey(passphrase, unbase64(backup.salt));
    const bytes = await subtle().decrypt({
      name: "AES-GCM", iv: asBuffer(unbase64(backup.iv)),
      additionalData: asBuffer(keyBackupContext(studyId, userId)),
    }, key, asBuffer(unbase64(backup.wrappedPrivateKey)));
    try {
      return await subtle().importKey("pkcs8", bytes,
        { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    } finally {
      new Uint8Array(bytes).fill(0);
    }
  } catch {
    throw new Error("Unable to unlock your key. Check your recovery passphrase.");
  }
}

async function sharedEncryptionKey(
  privateKey: CryptoKey, publicKey: CryptoKey,
  salt: Uint8Array, context: TransferContext,
): Promise<CryptoKey> {
  const bits = await subtle().deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  let hkdfKey: CryptoKey;
  try {
    hkdfKey = await subtle().importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  } finally {
    new Uint8Array(bits).fill(0);
  }
  return subtle().deriveKey({
    name: "HKDF", hash: "SHA-256", salt: asBuffer(salt),
    info: asBuffer(contextBytes(context)),
  }, hkdfKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptBlindedDataset(
  plaintext: Uint8Array, recipientPublicJwk: PublicKeyJwk,
  context: TransferContext,
): Promise<{ ciphertext: Uint8Array; ciphertextSha256: string; envelope: TransferEnvelope }> {
  if (await sha256Hex(plaintext) !== context.plaintextSha256) {
    throw new Error("Selected CSV does not match the registered blinded dataset SHA-256.");
  }
  if (plaintext.length + 16 > MAX_CIPHERTEXT_BYTES) {
    throw new Error("Encrypted dataset exceeds the 4 MiB v46 upload limit.");
  }
  const recipientKey = await subtle().importKey(
    "jwk", publicJwk(recipientPublicJwk),
    { name: "ECDH", namedCurve: "P-256" }, false, [],
  );
  const ephemeral = await subtle().generateKey(
    { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"],
  );
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const encryptionKey = await sharedEncryptionKey(
    ephemeral.privateKey, recipientKey, salt, context,
  );
  const encrypted = await subtle().encrypt({
    name: "AES-GCM", iv: asBuffer(iv),
    additionalData: asBuffer(contextBytes(context)),
  }, encryptionKey, asBuffer(plaintext));
  const ciphertext = new Uint8Array(encrypted);
  return {
    ciphertext,
    ciphertextSha256: await sha256Hex(ciphertext),
    envelope: {
      version: TRANSFER_ALGORITHM,
      ephemeralPublicJwk: publicJwk(await subtle().exportKey("jwk", ephemeral.publicKey)),
      salt: base64(salt), iv: base64(iv),
    },
  };
}

export async function decryptBlindedDataset(
  ciphertext: Uint8Array, ciphertextSha256: string,
  envelope: TransferEnvelope, context: TransferContext,
  backup: Pick<AnalystKeyBackup, "wrappedPrivateKey" | "salt" | "iv">,
  userId: string, passphrase: string,
): Promise<Uint8Array> {
  if (ciphertext.length > MAX_CIPHERTEXT_BYTES ||
      await sha256Hex(ciphertext) !== ciphertextSha256) {
    throw new Error("Downloaded ciphertext failed SHA-256 verification.");
  }
  if (envelope.version !== TRANSFER_ALGORITHM) {
    throw new Error("Unsupported transfer encryption version.");
  }
  const privateKey = await unlockPrivateKey(context.studyId, userId, passphrase, backup);
  try {
    const ephemeralKey = await subtle().importKey(
      "jwk", publicJwk(envelope.ephemeralPublicJwk),
      { name: "ECDH", namedCurve: "P-256" }, false, [],
    );
    const encryptionKey = await sharedEncryptionKey(
      privateKey, ephemeralKey, unbase64(envelope.salt), context,
    );
    const result = await subtle().decrypt({
      name: "AES-GCM", iv: asBuffer(unbase64(envelope.iv)),
      additionalData: asBuffer(contextBytes(context)),
    }, encryptionKey, asBuffer(ciphertext));
    const plaintext = new Uint8Array(result);
    if (await sha256Hex(plaintext) !== context.plaintextSha256) {
      throw new Error("Decrypted file does not match the registered blinded dataset.");
    }
    return plaintext;
  } catch {
    throw new Error("Dataset decryption or registered SHA-256 verification failed.");
  }
}
