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

function redirectAfterAnalystAssignment(
  studyId: string,
  workflowId: string | null,
  query: string,
): never {
  revalidatePath("/studies");
  revalidatePath(`/studies/${studyId}`);

  if (workflowId) {
    revalidatePath(`/studies/${studyId}/blinding/${workflowId}`);
    redirect(
      `/studies/${studyId}/blinding/${workflowId}?${query}`,
      RedirectType.replace,
    );
  }

  redirect(`/studies/${studyId}?${query}`, RedirectType.replace);
}

export async function assignBlindedAnalyst(formData: FormData) {
  const studyId = getRequiredString(formData, "studyId");
  const workflowIdValue = formData.get("workflowId");
  const workflowId =
    typeof workflowIdValue === "string" && workflowIdValue.trim().length > 0
      ? workflowIdValue.trim()
      : null;
  const analystEmail = getRequiredEmail(formData, "analystEmail");
  const acknowledgeRoleSeparation =
    formData.get("acknowledgeRoleSeparation") === "on";

  if (!acknowledgeRoleSeparation) {
    redirectAfterAnalystAssignment(
      studyId,
      workflowId,
      "analystError=acknowledgement_required",
    );
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  if (workflowId) {
    const { data: workflow, error: workflowError } = await supabase
      .from("blinding_workflows")
      .select("state")
      .eq("id", workflowId)
      .eq("study_id", studyId)
      .maybeSingle();

    if (workflowError || !workflow) {
      redirectAfterAnalystAssignment(
        studyId,
        workflowId,
        "analystError=workflow_not_found",
      );
    }

    if (workflow.state !== "setup") {
      redirectAfterAnalystAssignment(
        studyId,
        workflowId,
        "analystError=workflow_not_setup",
      );
    }
  }

  const { error } = await supabase.rpc("assign_blinded_analyst_by_email", {
    p_study_id: studyId,
    p_email: analystEmail,
  });

  if (error) {
    if (error.message.includes("No existing blindstats account was found")) {
      redirectAfterAnalystAssignment(studyId, workflowId, "analystError=account_not_found");
    }

    if (error.message.includes("different authenticated account")) {
      redirectAfterAnalystAssignment(studyId, workflowId, "analystError=same_account");
    }

    if (
      error.code === "42501" ||
      error.message.includes("not authorized to assign a blinded analyst")
    ) {
      redirectAfterAnalystAssignment(studyId, workflowId, "analystError=not_authorized");
    }

    if (error.message.includes("custodian capabilities")) {
      redirectAfterAnalystAssignment(studyId, workflowId, "analystError=custodian_capabilities");
    }

    redirectAfterAnalystAssignment(studyId, workflowId, "analystError=unable");
  }

  redirectAfterAnalystAssignment(studyId, workflowId, "analystAssigned=1");
}
