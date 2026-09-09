import { describe, expect, it } from "vitest";

import {
  openBlindingMapping,
  sealBlindingMapping,
} from "./mapping-crypto";
import type { BlindingReceipt } from "./types";

function context() {
  return {
    transformationId:
      "123e4567-e89b-42d3-a456-426614174000",
    createdAt: "2026-09-08T23:00:00.000Z",
    selectedColumn: "treatment",
    categoryCount: 2,
    rowCount: 4,
    columnCount: 3,
    sourceArtifactSha256: "a".repeat(64),
    blindedArtifactSha256: "b".repeat(64),
    mapping: [
      {
        original: "Treatment",
        blinded: "Group_B",
      },
      {
        original: "Control",
        blinded: "Group_A",
      },
    ],
  } as const;
}

function receiptFrom(
  sealedMapping: Awaited<
    ReturnType<typeof sealBlindingMapping>
  >["sealedMapping"],
): BlindingReceipt {
  const input = context();

  return {
    schemaVersion: "0.3",
    transformationId: input.transformationId,
    createdAt: input.createdAt,
    transformationType: "categorical_label_permutation",
    selectedColumn: input.selectedColumn,
    categoryCount: input.categoryCount,
    rowCount: input.rowCount,
    columnCount: input.columnCount,
    sourceArtifact: {
      sha256: input.sourceArtifactSha256,
    },
    blindedArtifact: {
      sha256: input.blindedArtifactSha256,
    },
    sealedMapping,
    algorithm: {
      neutralLabelScheme: "Group_<letters>",
      mappingAssignment: "web_crypto_random_permutation",
    },
  };
}

describe("sealed blinding mapping", () => {
  it("encrypts the mapping and decrypts it only with the corresponding secret", async () => {
    const input = context();
    const result = await sealBlindingMapping(input);
    const receipt = receiptFrom(result.sealedMapping);

    expect(result.secret.keyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(result.sealedMapping.ivHex).toMatch(
      /^[0-9a-f]{24}$/,
    );
    expect(result.sealedMapping.ciphertextHex).toMatch(
      /^[0-9a-f]+$/,
    );

    expect(
      await openBlindingMapping(receipt, result.secret),
    ).toEqual(input.mapping);
  });

  it("does not expose plaintext category names in either generated artifact", async () => {
    const input = context();
    const result = await sealBlindingMapping(input);

    const publicText = JSON.stringify(result.sealedMapping);
    const secretText = JSON.stringify(result.secret);

    for (const entry of input.mapping) {
      expect(publicText).not.toContain(entry.original);
      expect(publicText).not.toContain(entry.blinded);
      expect(secretText).not.toContain(entry.original);
      expect(secretText).not.toContain(entry.blinded);
    }
  });

  it("generates independent encryption material for separate blinding operations", async () => {
    const first = await sealBlindingMapping(context());
    const second = await sealBlindingMapping(context());

    expect(first.secret.keyHex).not.toBe(second.secret.keyHex);
    expect(first.sealedMapping.ivHex).not.toBe(
      second.sealedMapping.ivHex,
    );
    expect(first.sealedMapping.ciphertextHex).not.toBe(
      second.sealedMapping.ciphertextHex,
    );
  });

  it("fails closed with the wrong unblinding secret", async () => {
    const first = await sealBlindingMapping(context());
    const second = await sealBlindingMapping(context());
    const receipt = receiptFrom(first.sealedMapping);

    await expect(
      openBlindingMapping(receipt, second.secret),
    ).rejects.toThrow(
      "could not authenticate and decrypt",
    );
  });

  it("fails closed when the encrypted mapping is altered", async () => {
    const result = await sealBlindingMapping(context());
    const ciphertext = result.sealedMapping.ciphertextHex;
    const replacement = ciphertext.endsWith("0") ? "1" : "0";
    const receipt = receiptFrom({
      ...result.sealedMapping,
      ciphertextHex:
        `${ciphertext.slice(0, -1)}${replacement}`,
    });

    await expect(
      openBlindingMapping(receipt, result.secret),
    ).rejects.toThrow(
      "could not authenticate and decrypt",
    );
  });

  it("binds the ciphertext to the receipt metadata through authenticated additional data", async () => {
    const result = await sealBlindingMapping(context());
    const receipt = {
      ...receiptFrom(result.sealedMapping),
      selectedColumn: "different_column",
    };

    await expect(
      openBlindingMapping(receipt, result.secret),
    ).rejects.toThrow(
      "could not authenticate and decrypt",
    );
  });
});
