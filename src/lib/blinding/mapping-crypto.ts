import { generateNeutralLabels } from "./labels";
import {
  BLINDING_SCHEMA_VERSION,
  SEALED_MAPPING_AAD_SCHEME,
  SEALED_MAPPING_ALGORITHM,
  SEALED_MAPPING_ENCODING,
  type BlindingMappingEntry,
  type BlindingReceipt,
  type SealedMapping,
  type UnblindingSecret,
} from "./types";

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

const AES_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BITS = 128;
const SEALED_MAPPING_DOMAIN =
  "blindstats.sealed-mapping.plaintext.v1";

type MappingEncryptionContext = {
  transformationId: string;
  createdAt: string;
  selectedColumn: string;
  categoryCount: number;
  rowCount: number;
  columnCount: number;
  sourceArtifactSha256: string;
  blindedArtifactSha256: string;
};

export type SealBlindingMappingInput =
  MappingEncryptionContext & {
    mapping: readonly BlindingMappingEntry[];
  };

export type SealedBlindingMappingPackage = {
  sealedMapping: SealedMapping;
  secret: UnblindingSecret;
};

function requireWebCrypto(): Crypto {
  const webCrypto = globalThis.crypto;

  if (
    !webCrypto ||
    typeof webCrypto.getRandomValues !== "function" ||
    !webCrypto.subtle
  ) {
    throw new Error("Secure Web Crypto is not available.");
  }

  return webCrypto;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function hexToBytes(
  value: string,
  fieldName: string,
  expectedByteLength?: number,
): Uint8Array {
  if (
    value.length === 0 ||
    value.length % 2 !== 0 ||
    !/^[0-9a-f]+$/.test(value)
  ) {
    throw new Error(
      `${fieldName} must be lowercase hexadecimal.`,
    );
  }

  const bytes = new Uint8Array(value.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(
      value.slice(index * 2, index * 2 + 2),
      16,
    );
  }

  if (
    expectedByteLength !== undefined &&
    bytes.length !== expectedByteLength
  ) {
    throw new Error(
      `${fieldName} must encode exactly ${expectedByteLength} bytes.`,
    );
  }

  return bytes;
}

function copyAndValidateMapping(
  mapping: readonly BlindingMappingEntry[],
): BlindingMappingEntry[] {
  if (mapping.length < 2) {
    throw new Error(
      "A sealed blinding mapping requires at least two entries.",
    );
  }

  const originals = new Set<string>();
  const blindedLabels = new Set<string>();

  const copied = mapping.map((entry) => {
    if (entry.original.length === 0) {
      throw new Error(
        "Blinding mapping original categories cannot be empty strings.",
      );
    }

    if (originals.has(entry.original)) {
      throw new Error(
        "Blinding mapping contains duplicate original categories.",
      );
    }

    if (blindedLabels.has(entry.blinded)) {
      throw new Error(
        "Blinding mapping contains duplicate blinded labels.",
      );
    }

    originals.add(entry.original);
    blindedLabels.add(entry.blinded);

    return {
      original: entry.original,
      blinded: entry.blinded,
    };
  });

  const expectedLabels = new Set(
    generateNeutralLabels(copied.length),
  );

  if (
    blindedLabels.size !== expectedLabels.size ||
    [...blindedLabels].some(
      (label) => !expectedLabels.has(label),
    )
  ) {
    throw new Error(
      "Blinding mapping does not use the expected neutral-label set.",
    );
  }

  return copied;
}

function buildAadBytes(
  context: MappingEncryptionContext,
): Uint8Array {
  const aad = {
    domain: SEALED_MAPPING_AAD_SCHEME,
    schemaVersion: BLINDING_SCHEMA_VERSION,
    transformationId: context.transformationId,
    createdAt: context.createdAt,
    transformationType: "categorical_label_permutation",
    selectedColumn: context.selectedColumn,
    categoryCount: context.categoryCount,
    rowCount: context.rowCount,
    columnCount: context.columnCount,
    sourceArtifactSha256: context.sourceArtifactSha256,
    blindedArtifactSha256: context.blindedArtifactSha256,
    neutralLabelScheme: "Group_<letters>",
    mappingAssignment: "web_crypto_random_permutation",
  };

  return UTF8_ENCODER.encode(JSON.stringify(aad));
}

async function importAesKey(
  rawKey: Uint8Array,
  keyUsages: KeyUsage[],
): Promise<CryptoKey> {
  const webCrypto = requireWebCrypto();

  return webCrypto.subtle.importKey(
    "raw",
    toArrayBuffer(rawKey),
    {
      name: SEALED_MAPPING_ALGORITHM,
    },
    false,
    keyUsages,
  );
}

function contextFromReceipt(
  receipt: BlindingReceipt,
): MappingEncryptionContext {
  return {
    transformationId: receipt.transformationId,
    createdAt: receipt.createdAt,
    selectedColumn: receipt.selectedColumn,
    categoryCount: receipt.categoryCount,
    rowCount: receipt.rowCount,
    columnCount: receipt.columnCount,
    sourceArtifactSha256: receipt.sourceArtifact.sha256,
    blindedArtifactSha256: receipt.blindedArtifact.sha256,
  };
}

export async function sealBlindingMapping(
  input: SealBlindingMappingInput,
): Promise<SealedBlindingMappingPackage> {
  const webCrypto = requireWebCrypto();
  const mapping = copyAndValidateMapping(input.mapping);

  if (mapping.length !== input.categoryCount) {
    throw new Error(
      "Blinding mapping size does not match the declared category count.",
    );
  }

  const rawKey = new Uint8Array(AES_KEY_BYTES);
  const iv = new Uint8Array(AES_GCM_IV_BYTES);

  webCrypto.getRandomValues(rawKey);
  webCrypto.getRandomValues(iv);

  const key = await importAesKey(rawKey, ["encrypt"]);
  const plaintext = UTF8_ENCODER.encode(
    JSON.stringify({
      domain: SEALED_MAPPING_DOMAIN,
      mapping,
    }),
  );
  const additionalData = buildAadBytes(input);

  const ciphertextBuffer = await webCrypto.subtle.encrypt(
    {
      name: SEALED_MAPPING_ALGORITHM,
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(additionalData),
      tagLength: AES_GCM_TAG_BITS,
    },
    key,
    toArrayBuffer(plaintext),
  );

  return {
    sealedMapping: {
      algorithm: SEALED_MAPPING_ALGORITHM,
      keyLength: 256,
      tagLength: AES_GCM_TAG_BITS,
      encoding: SEALED_MAPPING_ENCODING,
      aadScheme: SEALED_MAPPING_AAD_SCHEME,
      ivHex: bytesToHex(iv),
      ciphertextHex: bytesToHex(
        new Uint8Array(ciphertextBuffer),
      ),
    },
    secret: {
      schemaVersion: BLINDING_SCHEMA_VERSION,
      secretType: "unblinding_secret",
      transformationId: input.transformationId,
      keyAlgorithm: SEALED_MAPPING_ALGORITHM,
      keyLength: 256,
      encoding: SEALED_MAPPING_ENCODING,
      keyHex: bytesToHex(rawKey),
    },
  };
}

export async function openBlindingMapping(
  receipt: BlindingReceipt,
  secret: UnblindingSecret,
): Promise<BlindingMappingEntry[]> {
  if (secret.transformationId !== receipt.transformationId) {
    throw new Error(
      "Unblinding secret transformation identifier does not match the public blinding receipt.",
    );
  }

  const webCrypto = requireWebCrypto();
  const rawKey = hexToBytes(
    secret.keyHex,
    "Unblinding secret key",
    AES_KEY_BYTES,
  );
  const iv = hexToBytes(
    receipt.sealedMapping.ivHex,
    "Sealed-mapping IV",
    AES_GCM_IV_BYTES,
  );
  const ciphertext = hexToBytes(
    receipt.sealedMapping.ciphertextHex,
    "Sealed-mapping ciphertext",
  );

  const key = await importAesKey(rawKey, ["decrypt"]);

  let plaintextBuffer: ArrayBuffer;

  try {
    plaintextBuffer = await webCrypto.subtle.decrypt(
      {
        name: SEALED_MAPPING_ALGORITHM,
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(
          buildAadBytes(contextFromReceipt(receipt)),
        ),
        tagLength: AES_GCM_TAG_BITS,
      },
      key,
      toArrayBuffer(ciphertext),
    );
  } catch {
    throw new Error(
      "Unblinding secret could not authenticate and decrypt the sealed mapping.",
    );
  }

  let plaintext: string;

  try {
    plaintext = UTF8_DECODER.decode(
      new Uint8Array(plaintextBuffer),
    );
  } catch {
    throw new Error(
      "Decrypted blinding mapping is not valid UTF-8.",
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new Error(
      "Decrypted blinding mapping is not valid JSON.",
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      "Decrypted blinding mapping has an unexpected structure.",
    );
  }

  const payload = parsed as Record<string, unknown>;
  const payloadKeys = Object.keys(payload).sort();

  if (
    payloadKeys.length !== 2 ||
    payloadKeys[0] !== "domain" ||
    payloadKeys[1] !== "mapping" ||
    payload.domain !== SEALED_MAPPING_DOMAIN ||
    !Array.isArray(payload.mapping)
  ) {
    throw new Error(
      "Decrypted blinding mapping has an unexpected structure.",
    );
  }

  const mapping = copyAndValidateMapping(
    payload.mapping.map((entry, index) => {
      if (
        typeof entry !== "object" ||
        entry === null ||
        Array.isArray(entry)
      ) {
        throw new Error(
          `Decrypted mapping entry ${index + 1} must be an object.`,
        );
      }

      const record = entry as Record<string, unknown>;
      const keys = Object.keys(record).sort();

      if (
        keys.length !== 2 ||
        keys[0] !== "blinded" ||
        keys[1] !== "original" ||
        typeof record.original !== "string" ||
        typeof record.blinded !== "string"
      ) {
        throw new Error(
          `Decrypted mapping entry ${index + 1} has an unexpected structure.`,
        );
      }

      return {
        original: record.original,
        blinded: record.blinded,
      };
    }),
  );

  if (mapping.length !== receipt.categoryCount) {
    throw new Error(
      "Decrypted mapping size does not match the public blinding receipt category count.",
    );
  }

  return mapping;
}
