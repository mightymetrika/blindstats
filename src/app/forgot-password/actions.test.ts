import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  createClient: vi.fn(),
  redirect: vi.fn((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { requestPasswordReset } from "./actions";

function emailForm(email: string): FormData {
  const form = new FormData();
  form.set("email", email);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue({
    auth: { resetPasswordForEmail: mocks.resetPasswordForEmail },
  });
  mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
});

describe("requestPasswordReset", () => {
  it("sends a reset request and returns an account-neutral message", async () => {
    await expect(requestPasswordReset(emailForm("  user@example.org  "))).rejects.toThrow(
      "NEXT_REDIRECT:/forgot-password?status=sent",
    );
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith("user@example.org");
  });

  it("rejects malformed addresses before contacting Supabase", async () => {
    await expect(requestPasswordReset(emailForm("not-an-email"))).rejects.toThrow(
      "NEXT_REDIRECT:/forgot-password?status=invalid",
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("provides a generic retry message when the email provider fails", async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({ error: new Error("SMTP failure") });
    await expect(requestPasswordReset(emailForm("user@example.org"))).rejects.toThrow(
      "NEXT_REDIRECT:/forgot-password?status=unavailable",
    );
  });
});
