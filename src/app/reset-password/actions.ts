"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function setNewPassword(formData: FormData) {
  const supabase = await createClient();
  const { data, error: userError } = await supabase.auth.getUser();

  if (userError || !data.user) {
    redirect("/forgot-password?status=expired");
  }

  const password = formData.get("password");
  const confirmation = formData.get("confirmPassword");

  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    redirect("/reset-password?error=invalid");
  }
  if (password !== confirmation) {
    redirect("/reset-password?error=mismatch");
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    redirect("/reset-password?error=failed");
  }

  // Invalidate refresh tokens for other sessions after a password reset.
  await supabase.auth.signOut({ scope: "global" });
  revalidatePath("/", "layout");
  redirect("/login?reset=success");
}
