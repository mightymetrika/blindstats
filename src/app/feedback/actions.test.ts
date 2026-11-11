import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getClaims: vi.fn(),
  insert: vi.fn(),
  from: vi.fn(),
  redirect: vi.fn((url: string): never => { throw new Error(`NEXT_REDIRECT:${url}`); }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { submitResearcherFeedback } from "./actions";

function filledForm(): FormData {
  const data = new FormData();
  data.set("test_role", "paired_custodian");
  data.set("completion", "independent");
  data.set("ease_rating", "5");
  data.set("rms_priorities", "Data collection and sharing");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReturnValue({ insert: mocks.insert });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "user-123" } }, error: null });
  mocks.createClient.mockResolvedValue({
    auth: { getClaims: mocks.getClaims },
    from: mocks.from,
  });
});

describe("submitResearcherFeedback", () => {
  it("saves only validated fields using the signed-in user's Supabase session", async () => {
    await expect(submitResearcherFeedback(filledForm())).rejects.toThrow(
      "NEXT_REDIRECT:/feedback?status=thanks",
    );
    expect(mocks.from).toHaveBeenCalledWith("researcher_feedback");
    expect(mocks.insert).toHaveBeenCalledWith({
      test_role: "paired_custodian",
      completion: "independent",
      ease_rating: 5,
      difficulties: null,
      blinding_improvements: null,
      transfer_usefulness: null,
      transfer_controls: null,
      rms_priorities: "Data collection and sharing",
      other_feedback: null,
      follow_up: false,
    });
  });

  it("blocks invalid data before calling the database", async () => {
    const data = filledForm();
    data.set("test_role", "unknown");
    await expect(submitResearcherFeedback(data)).rejects.toThrow(
      "NEXT_REDIRECT:/feedback?status=invalid",
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("requires login before writing feedback", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: null }, error: null });
    await expect(submitResearcherFeedback(filledForm())).rejects.toThrow(
      "NEXT_REDIRECT:/login",
    );
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("reports a retryable error instead of claiming the response was stored", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.insert.mockResolvedValue({ error: { code: "42501" } });
    try {
      await expect(submitResearcherFeedback(filledForm())).rejects.toThrow(
        "NEXT_REDIRECT:/feedback?status=unavailable",
      );
    } finally {
      spy.mockRestore();
    }
  });
});
