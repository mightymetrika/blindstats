export type TransformationIdentity = {
  transformationId: string;
  createdAt: string;
};

export type AnalysisLockIdentity = {
  lockId: string;
  createdAt: string;
};

export type UnblindingIdentity = {
  unblindingId: string;
  createdAt: string;
};

function requireRandomUuid(): () => string {
  const randomUUID = globalThis.crypto?.randomUUID;

  if (typeof randomUUID !== "function") {
    throw new Error("Web Crypto UUID generation is not available.");
  }

  return randomUUID.bind(globalThis.crypto);
}

function canonicalTimestamp(createdAt: Date, label: string): string {
  if (Number.isNaN(createdAt.getTime())) {
    throw new RangeError(`${label} timestamp must be a valid date.`);
  }

  return createdAt.toISOString();
}

export function createTransformationIdentity(
  createdAt: Date = new Date(),
): TransformationIdentity {
  return {
    transformationId: requireRandomUuid()(),
    createdAt: canonicalTimestamp(createdAt, "Transformation"),
  };
}

export function createAnalysisLockIdentity(
  createdAt: Date = new Date(),
): AnalysisLockIdentity {
  return {
    lockId: requireRandomUuid()(),
    createdAt: canonicalTimestamp(createdAt, "Analysis lock"),
  };
}

export function createUnblindingIdentity(
  createdAt: Date = new Date(),
): UnblindingIdentity {
  return {
    unblindingId: requireRandomUuid()(),
    createdAt: canonicalTimestamp(createdAt, "Unblinding"),
  };
}
