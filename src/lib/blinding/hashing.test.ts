import { describe, expect, it } from "vitest";

import { sha256Hex } from "./hashing";

const encoder = new TextEncoder();

describe("sha256Hex", () => {
  it("matches the standard SHA-256 digest for known bytes", async () => {
    const digest = await sha256Hex(encoder.encode("abc"));

    expect(digest).toBe(
      "ba7816bf8f01cfea414140de5dae2223" +
        "b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("returns the same digest for identical byte sequences", async () => {
    const first = encoder.encode("participant_id,treatment\nP001,Group_A\n");
    const second = encoder.encode(
      "participant_id,treatment\nP001,Group_A\n",
    );

    await expect(sha256Hex(first)).resolves.toBe(await sha256Hex(second));
  });

  it("returns a different digest when even one byte changes", async () => {
    const first = encoder.encode("Group_A");
    const second = encoder.encode("Group_B");

    expect(await sha256Hex(first)).not.toBe(await sha256Hex(second));
  });

  it("hashes bytes rather than normalized text content", async () => {
    const lf = encoder.encode("a,b\n1,2\n");
    const crlf = encoder.encode("a,b\r\n1,2\r\n");

    expect(await sha256Hex(lf)).not.toBe(await sha256Hex(crlf));
  });

  it("does not mutate the caller's byte array", async () => {
    const bytes = encoder.encode("source artifact");
    const snapshot = new Uint8Array(bytes);

    await sha256Hex(bytes);

    expect(bytes).toEqual(snapshot);
  });

  it("returns a lowercase 64-character hexadecimal digest", async () => {
    const digest = await sha256Hex(new Uint8Array());

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
