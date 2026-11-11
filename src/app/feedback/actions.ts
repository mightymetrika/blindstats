"use server";

import { redirect } from "next/navigation";

import { parseFeedback } from "@/lib/feedback/validation";
import { createClient } from "@/lib/supabase/server";

export async function submitResearcherFeedback(formData: FormData) {
  const feedback = parseFeedback(formData);
  if (!feedback) redirect("/feedback?status=invalid");

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims?.sub) redirect("/login");

  // The database assigns user_id and timestamps. No public SELECT, UPDATE,
  // or DELETE privilege exists for this table; do not request a returned row.
  const { error } = await supabase.from("researcher_feedback").insert(feedback);
  if (error) {
    // Never log the participant's free-text feedback or credentials.
    console.error("[blindstats] Feedback submission failed", { code: error.code });
    redirect("/feedback?status=unavailable");
  }

  redirect("/feedback?status=thanks");
}
