export type TransformationIdentity = {
  transformationId: string;
  createdAt: string;
};

function requireRandomUuid(): () => string {
  const randomUUID = globalThis.crypto?.randomUUID;

  if (typeof randomUUID !== "function") {
    throw new Error("Web Crypto UUID generation is not available.");
  }

  return randomUUID.bind(globalThis.crypto);
}

export function createTransformationIdentity(
  createdAt: Date = new Date(),
): TransformationIdentity {
  if (Number.isNaN(createdAt.getTime())) {
    throw new RangeError("Transformation timestamp must be a valid date.");
  }

  return {
    transformationId: requireRandomUuid()(),
    createdAt: createdAt.toISOString(),
  };
}
