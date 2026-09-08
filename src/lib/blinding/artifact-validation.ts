const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export function parseJsonArtifactBytes(
  bytes: Uint8Array,
  artifactName: string,
): Record<string, unknown> {
  if (bytes.length === 0) {
    throw new Error(`${artifactName} file cannot be empty.`);
  }

  let text: string;

  try {
    text = UTF8_DECODER.decode(new Uint8Array(bytes));
  } catch {
    throw new Error(`${artifactName} must be valid UTF-8.`);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${artifactName} must contain valid JSON.`);
  }

  return requireRecord(parsed, artifactName);
}

export function requireRecord(
  value: unknown,
  fieldName: string,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(`${fieldName} must be a JSON object.`);
  }

  return value as Record<string, unknown>;
}

export function requireArray(
  value: unknown,
  fieldName: string,
): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be a JSON array.`);
  }

  return value;
}

export function requireExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  fieldName: string,
): void {
  const expected = new Set(expectedKeys);
  const actual = Object.keys(value);

  const missing = expectedKeys.filter((key) => !(key in value));
  const unexpected = actual.filter((key) => !expected.has(key));

  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(`${fieldName} has an unexpected structure.`);
  }
}

export function requireString(
  value: Record<string, unknown>,
  key: string,
  fieldName: string,
): string {
  const result = value[key];

  if (typeof result !== "string") {
    throw new Error(`${fieldName} must be a string.`);
  }

  return result;
}

export function requireNonblankString(
  value: Record<string, unknown>,
  key: string,
  fieldName: string,
): string {
  const result = requireString(value, key, fieldName);

  if (result.trim().length === 0) {
    throw new Error(`${fieldName} cannot be blank.`);
  }

  return result;
}

export function requirePositiveInteger(
  value: unknown,
  fieldName: string,
  minimum = 1,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum
  ) {
    throw new Error(
      `${fieldName} must be an integer greater than or equal to ${minimum}.`,
    );
  }

  return value;
}

export function requireSha256(
  value: unknown,
  fieldName: string,
): string {
  if (
    typeof value !== "string" ||
    !SHA256_HEX_PATTERN.test(value)
  ) {
    throw new Error(
      `${fieldName} must be a lowercase 64-character SHA-256 hexadecimal digest.`,
    );
  }

  return value;
}

export function requireCanonicalTimestamp(
  value: unknown,
  fieldName: string,
): string {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string.`);
  }

  const parsed = new Date(value);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== value
  ) {
    throw new Error(
      `${fieldName} must be a canonical ISO-8601 timestamp.`,
    );
  }

  return value;
}
