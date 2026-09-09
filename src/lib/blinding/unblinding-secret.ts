import {
  parseJsonArtifactBytes,
  requireExactKeys,
  requireNonblankString,
} from "./artifact-validation";
import {
  BLINDING_SCHEMA_VERSION,
  SEALED_MAPPING_ALGORITHM,
  SEALED_MAPPING_ENCODING,
  UNBLINDING_SECRET_TYPE,
  type UnblindingSecret,
} from "./types";

const AES_256_KEY_HEX_PATTERN = /^[0-9a-f]{64}$/;

export function parseUnblindingSecretBytes(
  bytes: Uint8Array,
): UnblindingSecret {
  const secret = parseJsonArtifactBytes(
    bytes,
    "Unblinding secret",
  );

  requireExactKeys(
    secret,
    [
      "schemaVersion",
      "secretType",
      "transformationId",
      "keyAlgorithm",
      "keyLength",
      "encoding",
      "keyHex",
    ],
    "Unblinding secret",
  );

  if (secret.schemaVersion !== BLINDING_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported unblinding secret schema version "${String(secret.schemaVersion)}".`,
    );
  }

  if (secret.secretType !== UNBLINDING_SECRET_TYPE) {
    throw new Error(
      "Unblinding secret has an unsupported secret type.",
    );
  }

  if (secret.keyAlgorithm !== SEALED_MAPPING_ALGORITHM) {
    throw new Error(
      "Unblinding secret has an unsupported key algorithm.",
    );
  }

  if (secret.keyLength !== 256) {
    throw new Error(
      "Unblinding secret must contain a 256-bit key.",
    );
  }

  if (secret.encoding !== SEALED_MAPPING_ENCODING) {
    throw new Error(
      "Unblinding secret has an unsupported key encoding.",
    );
  }

  if (
    typeof secret.keyHex !== "string" ||
    !AES_256_KEY_HEX_PATTERN.test(secret.keyHex)
  ) {
    throw new Error(
      "Unblinding secret key must be a lowercase 64-character hexadecimal value.",
    );
  }

  return {
    schemaVersion: BLINDING_SCHEMA_VERSION,
    secretType: UNBLINDING_SECRET_TYPE,
    transformationId: requireNonblankString(
      secret,
      "transformationId",
      "Transformation identifier",
    ),
    keyAlgorithm: SEALED_MAPPING_ALGORITHM,
    keyLength: 256,
    encoding: SEALED_MAPPING_ENCODING,
    keyHex: secret.keyHex,
  };
}
