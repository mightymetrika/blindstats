import { generateNeutralLabels } from "./labels";
import type { BlindingMappingEntry } from "./types";

const UINT32_RANGE = 0x1_0000_0000;

export type ObservedCategoryValue = string | null;

export function getDistinctNonmissingCategories(
  values: readonly ObservedCategoryValue[],
): string[] {
  const categories = new Set<string>();

  for (const value of values) {
    if (value !== null) {
      categories.add(value);
    }
  }

  return [...categories];
}

export function secureRandomInt(maxExclusive: number): number {
  if (
    !Number.isInteger(maxExclusive) ||
    maxExclusive < 1 ||
    maxExclusive > UINT32_RANGE
  ) {
    throw new RangeError(
      `maxExclusive must be an integer from 1 through ${UINT32_RANGE}.`,
    );
  }

  const webCrypto = globalThis.crypto;

  if (!webCrypto || typeof webCrypto.getRandomValues !== "function") {
    throw new Error("Secure Web Crypto randomness is not available.");
  }

  const randomValue = new Uint32Array(1);
  const rejectionLimit =
    Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;

  do {
    webCrypto.getRandomValues(randomValue);
  } while (randomValue[0] >= rejectionLimit);

  return randomValue[0] % maxExclusive;
}

export function secureShuffle<T>(values: readonly T[]): T[] {
  const shuffled = [...values];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = secureRandomInt(index + 1);
    [shuffled[index], shuffled[randomIndex]] = [
      shuffled[randomIndex],
      shuffled[index],
    ];
  }

  return shuffled;
}

export function createBlindingMapping(
  values: readonly ObservedCategoryValue[],
): BlindingMappingEntry[] {
  const categories = getDistinctNonmissingCategories(values);

  if (categories.length < 2) {
    throw new Error(
      "A blinding mapping requires at least two distinct nonmissing categories.",
    );
  }

  const neutralLabels = secureShuffle(
    generateNeutralLabels(categories.length),
  );

  return categories.map((original, index) => ({
    original,
    blinded: neutralLabels[index],
  }));
}
