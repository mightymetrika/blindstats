function requireSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;

  if (!subtle) {
    throw new Error("Web Crypto SHA-256 hashing is not available.");
  }

  return subtle;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = requireSubtleCrypto();

  // Copy into a fresh Uint8Array so the exact byte sequence being hashed is
  // independent of any later mutation to the caller's buffer.
  const stableBytes = new Uint8Array(bytes);

  const digest = await subtle.digest("SHA-256", stableBytes);

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
