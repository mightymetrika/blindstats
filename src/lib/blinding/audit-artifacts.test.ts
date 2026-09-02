import { describe, expect, it } from "vitest";

import { createBlindingAuditArtifacts } from "./audit-artifacts";
import type { TransformationIdentity } from "./identity";
import type { BlindingMappingEntry } from "./types";

const sourceHash =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const blindedHash =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const identity: TransformationIdentity = {
  transformationId: "123e4567-e89b-42d3-a456-426614174000",
  createdAt: "2026-09-02T01:00:00.000Z",
};

const mapping: BlindingMappingEntry[] = [
  {
    original: "Treatment",
    blinded: "Group_B",
  },
  {
    original: "Control",
    blinded: "Group_A",
  },
];

function createValidArtifacts() {
  return createBlindingAuditArtifacts({
    identity,
    selectedColumn: "treatment",
    mapping,
    rowCount: 100,
    columnCount: 12,
    sourceArtifactSha256: sourceHash,
    blindedArtifactSha256: blindedHash,
  });
}

describe("createBlindingAuditArtifacts", () => {
  it("creates linked public receipt and private key metadata", () => {
    const { receipt, key } = createValidArtifacts();

    expect(receipt.transformationId).toBe(identity.transformationId);
    expect(key.transformationId).toBe(identity.transformationId);
    expect(receipt.createdAt).toBe(identity.createdAt);
    expect(key.createdAt).toBe(identity.createdAt);

    expect(receipt.sourceArtifact.sha256).toBe(sourceHash);
    expect(key.sourceArtifactSha256).toBe(sourceHash);
    expect(receipt.blindedArtifact.sha256).toBe(blindedHash);
    expect(key.blindedArtifactSha256).toBe(blindedHash);
  });

  it("derives receipt structure and category count from trusted inputs", () => {
    const { receipt } = createValidArtifacts();

    expect(receipt).toMatchObject({
      schemaVersion: "0.1",
      transformationType: "categorical_label_permutation",
      selectedColumn: "treatment",
      categoryCount: 2,
      rowCount: 100,
      columnCount: 12,
    });
  });

  it("records the declared blinding algorithm without exposing the mapping", () => {
    const { receipt } = createValidArtifacts();

    expect(receipt.algorithm).toEqual({
      neutralLabelScheme: "Group_<letters>",
      mappingAssignment: "web_crypto_random_permutation",
    });
    expect(receipt).not.toHaveProperty("mapping");
  });

  it("does not leak original category values through the serialized receipt", () => {
    const { receipt } = createValidArtifacts();
    const serializedReceipt = JSON.stringify(receipt);

    expect(serializedReceipt).not.toContain("Treatment");
    expect(serializedReceipt).not.toContain("Control");
    expect(serializedReceipt).not.toContain("Group_A");
    expect(serializedReceipt).not.toContain("Group_B");
  });

  it("places the complete mapping only in the private key", () => {
    const { key } = createValidArtifacts();

    expect(key.mapping).toEqual(mapping);
    expect(key.schemaVersion).toBe("0.1");
    expect(key.transformationType).toBe(
      "categorical_label_permutation",
    );
  });

  it("defensively copies the mapping so later caller mutation cannot change the key", () => {
    const mutableMapping: BlindingMappingEntry[] = [
      {
        original: "Treatment",
        blinded: "Group_B",
      },
      {
        original: "Control",
        blinded: "Group_A",
      },
    ];

    const { key } = createBlindingAuditArtifacts({
      identity,
      selectedColumn: "treatment",
      mapping: mutableMapping,
      rowCount: 100,
      columnCount: 12,
      sourceArtifactSha256: sourceHash,
      blindedArtifactSha256: blindedHash,
    });

    mutableMapping[0].blinded = "Group_Z";
    mutableMapping.push({
      original: "Placebo",
      blinded: "Group_C",
    });

    expect(key.mapping).toEqual(mapping);
  });

  it("rejects blank selected-column names", () => {
    expect(() =>
      createBlindingAuditArtifacts({
        identity,
        selectedColumn: "   ",
        mapping,
        rowCount: 100,
        columnCount: 12,
        sourceArtifactSha256: sourceHash,
        blindedArtifactSha256: blindedHash,
      }),
    ).toThrow("cannot be blank");
  });

  it("rejects invalid row and column counts", () => {
    expect(() =>
      createBlindingAuditArtifacts({
        identity,
        selectedColumn: "treatment",
        mapping,
        rowCount: 0,
        columnCount: 12,
        sourceArtifactSha256: sourceHash,
        blindedArtifactSha256: blindedHash,
      }),
    ).toThrow("Row count must be a positive integer");

    expect(() =>
      createBlindingAuditArtifacts({
        identity,
        selectedColumn: "treatment",
        mapping,
        rowCount: 100,
        columnCount: 1.5,
        sourceArtifactSha256: sourceHash,
        blindedArtifactSha256: blindedHash,
      }),
    ).toThrow("Column count must be a positive integer");
  });

  it("rejects malformed artifact hashes", () => {
    expect(() =>
      createBlindingAuditArtifacts({
        identity,
        selectedColumn: "treatment",
        mapping,
        rowCount: 100,
        columnCount: 12,
        sourceArtifactSha256: "not-a-sha256",
        blindedArtifactSha256: blindedHash,
      }),
    ).toThrow("Source artifact hash");

    expect(() =>
      createBlindingAuditArtifacts({
        identity,
        selectedColumn: "treatment",
        mapping,
        rowCount: 100,
        columnCount: 12,
        sourceArtifactSha256: sourceHash,
        blindedArtifactSha256: blindedHash.toUpperCase(),
      }),
    ).toThrow("Blinded artifact hash");
  });

  it("rejects malformed transformation identity metadata", () => {
    expect(() =>
      createBlindingAuditArtifacts({
        identity: {
          transformationId: "   ",
          createdAt: identity.createdAt,
        },
        selectedColumn: "treatment",
        mapping,
        rowCount: 100,
        columnCount: 12,
        sourceArtifactSha256: sourceHash,
        blindedArtifactSha256: blindedHash,
      }),
    ).toThrow("identifier cannot be blank");

    expect(() =>
      createBlindingAuditArtifacts({
        identity: {
          transformationId: identity.transformationId,
          createdAt: "2026-09-02",
        },
        selectedColumn: "treatment",
        mapping,
        rowCount: 100,
        columnCount: 12,
        sourceArtifactSha256: sourceHash,
        blindedArtifactSha256: blindedHash,
      }),
    ).toThrow("canonical ISO-8601");
  });

  it("rejects incomplete or non-bijective mappings", () => {
    expect(() =>
      createBlindingAuditArtifacts({
        identity,
        selectedColumn: "treatment",
        mapping: [
          {
            original: "Treatment",
            blinded: "Group_A",
          },
        ],
        rowCount: 100,
        columnCount: 12,
        sourceArtifactSha256: sourceHash,
        blindedArtifactSha256: blindedHash,
      }),
    ).toThrow("at least two mapping entries");

    expect(() =>
      createBlindingAuditArtifacts({
        identity,
        selectedColumn: "treatment",
        mapping: [
          {
            original: "Treatment",
            blinded: "Group_A",
          },
          {
            original: "Treatment",
            blinded: "Group_B",
          },
        ],
        rowCount: 100,
        columnCount: 12,
        sourceArtifactSha256: sourceHash,
        blindedArtifactSha256: blindedHash,
      }),
    ).toThrow("duplicate original categories");

    expect(() =>
      createBlindingAuditArtifacts({
        identity,
        selectedColumn: "treatment",
        mapping: [
          {
            original: "Treatment",
            blinded: "Group_A",
          },
          {
            original: "Control",
            blinded: "Group_A",
          },
        ],
        rowCount: 100,
        columnCount: 12,
        sourceArtifactSha256: sourceHash,
        blindedArtifactSha256: blindedHash,
      }),
    ).toThrow("duplicate blinded labels");
  });
});
