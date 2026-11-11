import { describe, expect, it } from "vitest";

import { parseFeedback } from "./validation";

function base(): FormData {
  const form = new FormData();
  form.set("test_role", "paired_analyst");
  form.set("completion", "partial");
  return form;
}

describe("parseFeedback", () => {
  it("accepts a concise response with optional fields absent", () => {
    expect(parseFeedback(base())).toEqual({
      test_role: "paired_analyst",
      completion: "partial",
      ease_rating: null,
      difficulties: null,
      blinding_improvements: null,
      transfer_usefulness: null,
      transfer_controls: null,
      rms_priorities: null,
      other_feedback: null,
      follow_up: false,
    });
  });

  it("keeps supported response values and trims optional comments", () => {
    const form = base();
    form.set("ease_rating", "4");
    form.set("transfer_usefulness", "very");
    form.set("transfer_controls", "  Expiration and revocation  ");
    form.set("follow_up", "on");
    expect(parseFeedback(form)).toMatchObject({
      ease_rating: 4,
      transfer_usefulness: "very",
      transfer_controls: "Expiration and revocation",
      follow_up: true,
    });
  });

  it.each([
    ["test_role", "other"],
    ["completion", "finished_by_someone_else"],
    ["ease_rating", "0"],
    ["ease_rating", "6"],
    ["ease_rating", "2.5"],
    ["transfer_usefulness", "definitely"],
    ["follow_up", "yes"],
    ["difficulties", "x".repeat(1201)],
  ])("rejects invalid %s", (name, value) => {
    const form = base();
    form.set(name, value);
    expect(parseFeedback(form)).toBeNull();
  });

  it("requires the role and completion", () => {
    const form = new FormData();
    form.set("completion", "independent");
    expect(parseFeedback(form)).toBeNull();
  });
});
