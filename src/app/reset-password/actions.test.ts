import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { setNewPassword } from "./actions";

function passwordForm(password: string, confirmPassword: string): FormData {
  const form = new FormData();
  form.set("password", password);
  form.set("confirmPassword", confirmPassword);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue({
    auth: {
      getUser: mocks.getUser,
      updateUser: mocks.updateUser,
      signOut: mocks.signOut,
    },
  });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "test-user" } }, error: null });
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
});

describe("setNewPassword", () => {
  it("requires a valid, authenticated Supabase session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(setNewPassword(passwordForm("newPassword123!", "newPassword123!"))).rejects.toThrow(
      "NEXT_REDIRECT:/forgot-password?status=expired",
    );
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("rejects short passwords before calling updateUser", async () => {
    await expect(setNewPassword(passwordForm("short", "short"))).rejects.toThrow(
      "NEXT_REDIRECT:/reset-password?error=invalid",
    );
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("rejects mismatched passwords", async () => {
    await expect(setNewPassword(passwordForm("newPassword123!", "different123!"))).rejects.toThrow(
      "NEXT_REDIRECT:/reset-password?error=mismatch",
    );
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("shows a safe retry message if the password update fails", async () => {
    mocks.updateUser.mockResolvedValue({ error: new Error("Sensitive message") });
    await expect(setNewPassword(passwordForm("newPassword123!", "newPassword123!"))).rejects.toThrow(
      "NEXT_REDIRECT:/reset-password?error=failed",
    );
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("updates the password, signs out globally, and returns to login", async () => {
    await expect(setNewPassword(passwordForm("newPassword123!", "newPassword123!"))).rejects.toThrow(
      "NEXT_REDIRECT:/login?reset=success",
    );
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "newPassword123!" });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});
