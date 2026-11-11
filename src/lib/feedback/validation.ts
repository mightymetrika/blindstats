/**
 * Participant-facing researcher-preview feedback. Keep input short, optional
 * where practical, and validated before any database write.
 */
export type FeedbackInput = {
  test_role: "paired_custodian" | "paired_analyst" | "single";
  completion: "independent" | "with_help" | "partial" | "not_completed";
  ease_rating: number | null;
  difficulties: string | null;
  blinding_improvements: string | null;
  transfer_usefulness: "no" | "somewhat" | "very" | "unsure" | null;
  transfer_controls: string | null;
  rms_priorities: string | null;
  other_feedback: string | null;
  follow_up: boolean;
};

const roles = ["paired_custodian", "paired_analyst", "single"] as const;
const completions = ["independent", "with_help", "partial", "not_completed"] as const;
const transferChoices = ["no", "somewhat", "very", "unsure"] as const;

function choice<T extends string>(
  form: FormData,
  field: string,
  options: readonly T[],
  required: true,
): T | undefined;
function choice<T extends string>(
  form: FormData,
  field: string,
  options: readonly T[],
  required: false,
): T | null | undefined;
function choice<T extends string>(
  form: FormData,
  field: string,
  options: readonly T[],
  required: boolean,
): T | null | undefined {
  const raw = form.get(field);
  if (raw === null || raw === "") return required ? undefined : null;
  if (typeof raw !== "string") return undefined;
  return options.includes(raw as T) ? (raw as T) : undefined;
}

function optionalText(form: FormData, field: string, max: number): string | null | undefined {
  const raw = form.get(field);
  if (raw === null) return null;
  if (typeof raw !== "string" || raw.length > max) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Invalid submissions return null; no raw text is written to logs. */
export function parseFeedback(form: FormData): FeedbackInput | null {
  const test_role = choice(form, "test_role", roles, true);
  const completion = choice(form, "completion", completions, true);
  const transfer_usefulness = choice(form, "transfer_usefulness", transferChoices, false);
  const difficulties = optionalText(form, "difficulties", 1200);
  const blinding_improvements = optionalText(form, "blinding_improvements", 1200);
  const transfer_controls = optionalText(form, "transfer_controls", 600);
  const rms_priorities = optionalText(form, "rms_priorities", 1200);
  const other_feedback = optionalText(form, "other_feedback", 1000);

  const easeRaw = form.get("ease_rating");
  const ease_rating = easeRaw === null || easeRaw === "" ? null : Number(easeRaw);
  const followUpRaw = form.get("follow_up");

  if (
    !test_role || !completion || transfer_usefulness === undefined ||
    difficulties === undefined || blinding_improvements === undefined ||
    transfer_controls === undefined || rms_priorities === undefined ||
    other_feedback === undefined ||
    (ease_rating !== null && (!Number.isInteger(ease_rating) || ease_rating < 1 || ease_rating > 5)) ||
    (followUpRaw !== null && followUpRaw !== "on")
  ) return null;

  return {
    test_role,
    completion,
    ease_rating,
    difficulties,
    blinding_improvements,
    transfer_usefulness,
    transfer_controls,
    rms_priorities,
    other_feedback,
    follow_up: followUpRaw === "on",
  };
}
