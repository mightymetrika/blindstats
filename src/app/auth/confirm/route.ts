import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const rawType = searchParams.get("type");
  // Preserve the existing supported Supabase email OTP types.
  const acceptedTypes = new Set([
    "signup",
    "invite",
    "magiclink",
    "recovery",
    "email_change",
    "email",
  ]);
  const type = rawType && acceptedTypes.has(rawType)
    ? (rawType as EmailOtpType)
    : null;

  const redirectTo = request.nextUrl.clone();
  // Never carry one-time credentials (or other query values) into a redirect.
  redirectTo.search = "";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (!error) {
      redirectTo.pathname = type === "recovery" ? "/reset-password" : "/studies";
      return NextResponse.redirect(redirectTo);
    }
  }

  if (type === "recovery") {
    redirectTo.pathname = "/forgot-password";
    redirectTo.searchParams.set("status", "expired");
    return NextResponse.redirect(redirectTo);
  }

  redirectTo.pathname = "/error";
  return NextResponse.redirect(redirectTo);
}
