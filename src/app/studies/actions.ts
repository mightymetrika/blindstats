"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function getRequiredStudyName(formData: FormData) {
  const value = formData.get("name");

  if (typeof value !== "string") {
    throw new Error("Study name is required.");
  }

  const name = value.trim();

  if (name.length === 0 || name.length > 200) {
    throw new Error("Study name must be between 1 and 200 characters.");
  }

  return name;
}

function getStudyDescription(formData: FormData) {
  const value = formData.get("description");

  if (typeof value !== "string") {
    return null;
  }

  const description = value.trim();

  if (description.length > 2000) {
    throw new Error("Study description must be 2000 characters or fewer.");
  }

  return description || null;
}

export async function createStudy(formData: FormData) {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims?.sub) {
    redirect("/login");
  }

  const name = getRequiredStudyName(formData);
  const description = getStudyDescription(formData);
  const fileProtection = formData.get("fileProtection");
  if (fileProtection !== "managed_at_rest_v1" && fileProtection !== "recipient_e2ee_v1") {
    throw new Error("Select a valid Study file protection policy.");
  }

const { error } = await supabase
  .from("studies")
  .insert({
    name,
    description,
    file_protection: fileProtection,
  });

if (error) {
  throw new Error(`Unable to create Study: ${error.message}`);
}

redirect("/studies");
}
