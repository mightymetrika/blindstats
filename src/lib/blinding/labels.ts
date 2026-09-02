const LETTER_COUNT = 26;
const ASCII_A = 65;

function lettersForIndex(index: number): string {
  let value = index + 1;
  let letters = "";

  while (value > 0) {
    value -= 1;
    letters = String.fromCharCode(ASCII_A + (value % LETTER_COUNT)) + letters;
    value = Math.floor(value / LETTER_COUNT);
  }

  return letters;
}

export function generateNeutralLabels(count: number): string[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError("Neutral label count must be a nonnegative integer.");
  }

  return Array.from(
    { length: count },
    (_, index) => `Group_${lettersForIndex(index)}`,
  );
}
