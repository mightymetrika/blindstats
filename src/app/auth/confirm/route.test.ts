import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue({ auth: { verifyOtp: mocks.verifyOtp } });
  mocks.verifyOtp.mockResolvedValue({ error: null });
});

describe("email OTP confirmation route", () => {
  it("preserves the existing signup confirmation destination", async () => {
    const request = new NextRequest(
      "https://blindstats.com/auth/confirm?token_hash=signup-token&type=email",
    );
    const response = await GET(request);

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "signup-token",
      type: "email",
    });
    expect(response.headers.get("location")).toBe("https://blindstats.com/studies");
  });

  it("retains support for previously accepted email OTP flows", async () => {
    const request = new NextRequest(
      "https://blindstats.com/auth/confirm?token_hash=invitation&type=invite",
    );
    const response = await GET(request);
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "invitation",
      type: "invite",
    });
    expect(response.headers.get("location")).toBe("https://blindstats.com/studies");
  });

  it("sends valid recovery links to reset-password without leaking the token", async () => {
    const request = new NextRequest(
      "https://blindstats.com/auth/confirm?token_hash=recovery-token&type=recovery&unexpected=value",
    );
    const response = await GET(request);

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "recovery-token",
      type: "recovery",
    });
    expect(response.headers.get("location")).toBe(
      "https://blindstats.com/reset-password",
    );
    expect(response.headers.get("location")).not.toContain("recovery-token");
  });

  it("rejects invalid or expired recovery tokens", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: new Error("Expired token") });
    const response = await GET(
      new NextRequest(
        "https://blindstats.com/auth/confirm?token_hash=expired&type=recovery",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://blindstats.com/forgot-password?status=expired",
    );
  });

  it("rejects missing tokens and unsupported OTP types without verification", async () => {
    const missingToken = await GET(new NextRequest(
      "https://blindstats.com/auth/confirm?type=recovery",
    ));
    expect(missingToken.headers.get("location")).toBe(
      "https://blindstats.com/forgot-password?status=expired",
    );
    const unsupportedType = await GET(new NextRequest(
      "https://blindstats.com/auth/confirm?token_hash=hello&type=unsupported",
    ));
    expect(unsupportedType.headers.get("location")).toBe(
      "https://blindstats.com/error",
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
