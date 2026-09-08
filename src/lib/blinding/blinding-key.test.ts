import { describe, expect, it } from "vitest";

import { parseBlindingKeyBytes } from "./blinding-key";
import type { BlindingKey } from "./types";

const encoder = new TextEncoder();

function validKey(): BlindingKey {
  return {
    schemaVersion: "0.1",
    transformationId: "123e4567-e89b-42d3-a456-426614174000",
    createdAt: "2026-09-08T01:00:00.000Z",
    transformationType: "categorical_label_permutation",
    selectedColumn: "treatment",
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
  };
}

function encode(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

describe("parseBlindingKeyBytes", () => {
  it("parses and validates a canonical private blinding key", () => {
    const key = validKey();

    expect(parseBlindingKeyBytes(encode(key))).toEqual(key);
  });

  it("rejects malformed JSON and unsupported schema versions", () => {
    expect(() =>
      parseBlindingKeyBytes(
        encoder.encode('{"schemaVersion":'),
      ),
    ).toThrow("valid JSON");

    expect(() =>
      parseBlindingKeyBytes(
        encode({
          ...validKey(),
          schemaVersion: "9.9",
        }),
      ),
    ).toThrow("Unsupported blinding key schema version");
  });

  it("rejects unexpected fields and noncanonical timestamps", () => {
    expect(() =>
      parseBlindingKeyBytes(
        encode({
          ...validKey(),
          extra: true,
        }),
      ),
    ).toThrow("unexpected structure");

    expect(() =>
      parseBlindingKeyBytes(
        encode({
          ...validKey(),
          createdAt: "2026-09-08",
        }),
      ),
    ).toThrow("canonical ISO-8601");
  });

  it("rejects duplicate or unsupported mapping labels", () => {
    expect(() =>
      parseBlindingKeyBytes(
        encode({
          ...validKey(),
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
        }),
      ),
    ).toThrow("duplicate blinded labels");

    expect(() =>
      parseBlindingKeyBytes(
        encode({
          ...validKey(),
          mapping: [
            {
              original: "Treatment",
              blinded: "Group_A",
            },
            {
              original: "Control",
              blinded: "Group_Z",
            },
          ],
        }),
      ),
    ).toThrow("expected neutral-label set");
  });

  it("rejects invalid hashes and mappings with fewer than two entries", () => {
    expect(() =>
      parseBlindingKeyBytes(
        encode({
          ...validKey(),
          sourceArtifactSha256: "not-a-hash",
        }),
      ),
    ).toThrow("source artifact hash");

    expect(() =>
      parseBlindingKeyBytes(
        encode({
          ...validKey(),
          mapping: [
            {
              original: "Treatment",
              blinded: "Group_A",
            },
          ],
        }),
      ),
    ).toThrow("at least two entries");
  });
});
