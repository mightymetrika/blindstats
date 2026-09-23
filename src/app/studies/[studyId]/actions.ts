"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function getRequiredString(formData: FormData, name: string): string {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }

  return value.trim();
}

function getRequiredEmail(formData: FormData, name: string): string {
  const email = getRequiredString(formData, name).toLowerCase();

  if (email.length > 320 || !email.includes("@")) {
    throw new Error("A valid account email is required.");
  }

  return email;
}

function redirectToStudy(studyId: string, query: string): never {
  revalidatePath("/studies");
  revalidatePath(`/studies/${studyId}`);

  redirect(`/studies/${studyId}?${query}`, RedirectType.replace);
}

export async function assignBlindedAnalyst(formData: FormData) {
  const studyId = getRequiredString(formData, "studyId");
  const analystEmail = getRequiredEmail(formData, "analystEmail");
  const acknowledgeRoleSeparation =
    formData.get("acknowledgeRoleSeparation") === "on";

  if (!acknowledgeRoleSeparation) {
    redirectToStudy(studyId, "analystError=acknowledgement_required");
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { error } = await supabase.rpc("assign_blinded_analyst_by_email", {
    p_study_id: studyId,
    p_email: analystEmail,
  });

  if (error) {
    if (error.message.includes("No existing blindstats account was found")) {
      redirectToStudy(studyId, "analystError=account_not_found");
    }

    if (error.message.includes("different authenticated account")) {
      redirectToStudy(studyId, "analystError=same_account");
    }

    if (
      error.code === "42501" ||
      error.message.includes("not authorized to assign a blinded analyst")
    ) {
      redirectToStudy(studyId, "analystError=not_authorized");
    }

    if (error.message.includes("custodian capabilities")) {
      redirectToStudy(studyId, "analystError=custodian_capabilities");
    }

    redirectToStudy(studyId, "analystError=unable");
  }

  redirectToStudy(studyId, "analystAssigned=1");
}
