"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function requestPasswordReset(formData: FormData) {
  const submittedEmail = formData.get("email");
  const email = typeof submittedEmail === "string" ? submittedEmail.trim() : "";

  if (
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    redirect("/forgot-password?status=invalid");
  }

  const supabase = await createClient();
  // Each Supabase project's recovery template uses its configured Site URL.
  // Do not build a redirect destination from untrusted request headers.
  const { error } = await supabase.auth.resetPasswordForEmail(email);

  if (error) {
    redirect("/forgot-password?status=unavailable");
  }

  // Show the same response whether or not the address has an account.
  redirect("/forgot-password?status=sent");
}
