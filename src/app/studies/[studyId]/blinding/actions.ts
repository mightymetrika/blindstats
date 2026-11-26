"use server";

import { parsePackageReceipt } from "@/lib/blinding/package-v05/receipt";
import { parsePackageAnalysisLock } from "@/lib/blinding/package-v05/analysis-lock";
import { parseJsonArtifactBytes } from "@/lib/blinding/artifact-validation";

import { Buffer } from "node:buffer";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";

import {
  parseSupportedAnalysisLockReceiptBytes,
  registrationRpcForAnalysisLockReceipt,
} from "@/lib/blinding/supported-analysis-lock";
import {
  parseSupportedBlindingReceiptBytes,
  registrationRpcForBlindingReceipt,
} from "@/lib/blinding/public-receipt-version";
import {
  requireArray,
  requireExactKeys,
  requireNonblankString,
  requirePositiveInteger,
  requireRecord,
} from "@/lib/blinding/artifact-validation";
import { createClient } from "@/lib/supabase/server";

function getRequiredString(formData: FormData, name: string) {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }

  return value.trim();
}

function getRequiredExactString(formData: FormData, name: string) {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

function getRequiredSha256(formData: FormData, name: string) {
  const value = getRequiredString(formData, name);

  if (!SHA256_HEX_PATTERN.test(value)) {
    throw new Error(`${name} must be a lowercase 64-character SHA-256 digest.`);
  }

  return value;
}

function getOptionalString(formData: FormData, name: string) {
  const value = formData.get(name);

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${name} must be a string when provided.`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getOptionalExactString(formData: FormData, name: string) {
  const value = formData.get(name);

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${name} must be a string when provided.`);
  }

  return value.trim().length > 0 ? value : null;
}

function getOptionalSha256(formData: FormData, name: string) {
  const value = getOptionalString(formData, name);

  if (value === null) {
    return null;
  }

  if (!SHA256_HEX_PATTERN.test(value)) {
    throw new Error(`${name} must be a lowercase 64-character SHA-256 digest.`);
  }

  return value;
}

function getOptionalPositiveInteger(formData: FormData, name: string) {
  const value = getOptionalString(formData, name);

  if (value === null) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function getRequiredCanonicalTimestamp(formData: FormData, name: string) {
  const value = getRequiredString(formData, name);
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${name} must be a canonical ISO-8601 timestamp.`);
  }

  return value;
}

function redirectToCurrentWorkflow(
  studyId: string,
  workflowId: string,
  query:
    | "saved=1"
    | "activated=1"
    | "activationError=independent_requires_two_actors"
    | "stale=1"
    | "requested=1"
    | "authorized=1"
    | "unblinded=1",
) {
  revalidatePath(`/studies/${studyId}`);
  revalidatePath(`/studies/${studyId}/blinding/${workflowId}`);

  redirect(
    `/studies/${studyId}/blinding/${workflowId}?${query}`,
    RedirectType.replace,
  );
}

export async function createBlindingWorkflow(formData: FormData) {
  const studyId = getRequiredString(formData, "studyId");
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: existingWorkflow, error: existingError } = await supabase
    .from("blinding_workflows")
    .select("id")
    .eq("study_id", studyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `Unable to check for an existing blinding workflow: ${existingError.message}`,
    );
  }

  if (existingWorkflow) {
    redirect(`/studies/${studyId}/blinding/${existingWorkflow.id}`);
  }

  const { data: workflow, error } = await supabase
    .from("blinding_workflows")
    .insert({
      study_id: studyId,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Unable to create blinding workflow: ${error.message}`);
  }

  redirect(`/studies/${studyId}/blinding/${workflow.id}`);
}

export async function saveBlindingPlanDraft(formData: FormData) {
  const studyId = getRequiredString(formData, "studyId");
  const workflowId = getRequiredString(formData, "workflowId");
  const targetValue = formData.get("protectionTarget");
  const rationaleValue = formData.get("protectionRationale");
  const lockPolicy = getRequiredString(formData, "lockPolicy");
  const authorizationPolicy = getRequiredString(
    formData,
    "authorizationPolicy",
  );

  const protectionTarget =
    typeof targetValue === "string" ? targetValue.trim() : "";
  const protectionRationale =
    typeof rationaleValue === "string" ? rationaleValue.trim() : "";

  if (protectionTarget.length > 200) {
    throw new Error("Protection target must be 200 characters or fewer.");
  }

  if (protectionRationale.length > 1000) {
    throw new Error("Protection rationale must be 1000 characters or fewer.");
  }

  if (lockPolicy !== "required" && lockPolicy !== "not_required") {
    throw new Error("Analysis-lock policy is invalid.");
  }

  if (
    authorizationPolicy !== "independent" &&
    authorizationPolicy !== "self_authorization"
  ) {
    throw new Error("Unblinding-authorization policy is invalid.");
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: workflow, error: workflowError } = await supabase
    .from("blinding_workflows")
    .select("state, active_plan_version_id")
    .eq("id", workflowId)
    .eq("study_id", studyId)
    .maybeSingle();

  if (workflowError) {
    throw new Error(
      `Unable to verify blinding workflow: ${workflowError.message}`,
    );
  }

  if (!workflow) {
    throw new Error("Blinding workflow not found.");
  }

  if (
    workflow.state !== "setup" ||
    workflow.active_plan_version_id !== null
  ) {
    redirectToCurrentWorkflow(studyId, workflowId, "stale=1");
  }

  const { data: updatedDraft, error } = await supabase
    .from("blinding_plan_drafts")
    .update({
      protection_targets: protectionTarget ? [protectionTarget] : [],
      protection_rationale: protectionRationale || null,
      require_analysis_lock: lockPolicy === "required",
      authorization_policy: authorizationPolicy,
    })
    .eq("workflow_id", workflowId)
    .eq("study_id", studyId)
    .select("workflow_id")
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to save BlindingPlan draft: ${error.message}`);
  }

  if (!updatedDraft) {
    redirectToCurrentWorkflow(studyId, workflowId, "stale=1");
  }

  redirectToCurrentWorkflow(studyId, workflowId, "saved=1");
}

export async function activateBlindingPlan(formData: FormData) {
  const studyId = getRequiredString(formData, "studyId");
  const workflowId = getRequiredString(formData, "workflowId");
  const acknowledgeWeakerPolicies =
    formData.get("acknowledgeWeakerPolicies") === "on";

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const [
    { data: workflow, error: workflowError },
    { data: draft, error: draftError },
    { data: unblindingCapabilities, error: capabilitiesError },
  ] = await Promise.all([
    supabase
      .from("blinding_workflows")
      .select("id")
      .eq("id", workflowId)
      .eq("study_id", studyId)
      .maybeSingle(),
    supabase
      .from("blinding_plan_drafts")
      .select("authorization_policy")
      .eq("workflow_id", workflowId)
      .eq("study_id", studyId)
      .maybeSingle(),
    supabase
      .from("study_capabilities")
      .select("user_id, capability")
      .eq("study_id", studyId)
      .in("capability", ["unblinding.request", "unblinding.authorize"]),
  ]);

  if (workflowError || !workflow) {
    throw new Error(
      `Unable to verify blinding workflow: ${workflowError?.message ?? "Workflow not found."}`,
    );
  }

  if (draftError || !draft) {
    throw new Error(
      `Unable to verify BlindingPlan draft: ${draftError?.message ?? "Draft not found."}`,
    );
  }

  if (capabilitiesError) {
    throw new Error(
      `Unable to verify unblinding roles: ${capabilitiesError.message}`,
    );
  }

  if (draft.authorization_policy === "independent") {
    const requesterIds = new Set(
      (unblindingCapabilities ?? [])
        .filter((entry) => entry.capability === "unblinding.request")
        .map((entry) => entry.user_id),
    );
    const authorizerIds = new Set(
      (unblindingCapabilities ?? [])
        .filter((entry) => entry.capability === "unblinding.authorize")
        .map((entry) => entry.user_id),
    );
    const hasIndependentAuthorizationPair = Array.from(requesterIds).some(
      (requesterId) =>
        Array.from(authorizerIds).some(
          (authorizerId) => authorizerId !== requesterId,
        ),
    );

    if (!hasIndependentAuthorizationPair) {
      redirectToCurrentWorkflow(
        studyId,
        workflowId,
        "activationError=independent_requires_two_actors",
      );
    }
  }

  const { error } = await supabase.rpc("activate_blinding_plan", {
    p_workflow_id: workflowId,
    p_acknowledge_weaker_policies: acknowledgeWeakerPolicies,
  });

  if (error) {
    throw new Error(`Unable to activate BlindingPlan: ${error.message}`);
  }

  redirectToCurrentWorkflow(studyId, workflowId, "activated=1");
}

export type RegisterBlindingTransformationResult =
  | {
      ok: true;
      transformationRecordId: string;
    }
  | {
      ok: false;
      error: string;
    };

export async function registerBlindingTransformation(
  formData: FormData,
): Promise<RegisterBlindingTransformationResult> {
  const studyId = getRequiredString(formData, "studyId");
  const workflowId = getRequiredString(formData, "workflowId");
  const publicReceiptBase64Value = formData.get("publicReceiptBase64");
  const acknowledgedCustody = formData.get("acknowledgeCustody") === "on";

  if (
    typeof publicReceiptBase64Value !== "string" ||
    publicReceiptBase64Value.length === 0
  ) {
    return {
      ok: false,
      error: "A public blinding receipt is required for registration.",
    };
  }

  if (!acknowledgedCustody) {
    return {
      ok: false,
      error:
        "Confirm that the blinded dataset files, public receipt, and unblinding secret have been saved before registration.",
    };
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: workflow, error: workflowError } = await supabase
    .from("blinding_workflows")
    .select("state, active_plan_version_id")
    .eq("id", workflowId)
    .eq("study_id", studyId)
    .maybeSingle();

  if (workflowError) {
    return {
      ok: false,
      error: `Unable to verify blinding workflow: ${workflowError.message}`,
    };
  }

  if (!workflow) {
    return {
      ok: false,
      error: "Blinding workflow not found.",
    };
  }

  if (workflow.state !== "setup") {
    return {
      ok: false,
      error:
        "This workflow is no longer in setup. Reload the workflow before continuing.",
    };
  }

  if (!workflow.active_plan_version_id) {
    return {
      ok: false,
      error: "An active BlindingPlan is required before registration.",
    };
  }

  let publicReceiptText: string;
  let registrationRpc: "register_blinding_transformation" | "register_multi_blinding_transformation" | "register_package_blinding_transformation";

  try {
    if (
      publicReceiptBase64Value.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(publicReceiptBase64Value)
    ) {
      throw new Error("Public blinding receipt transport encoding is invalid.");
    }

    const decoded = Buffer.from(publicReceiptBase64Value, "base64");

    if (decoded.toString("base64") !== publicReceiptBase64Value) {
      throw new Error("Public blinding receipt transport encoding is invalid.");
    }

    const publicReceiptBytes = new Uint8Array(decoded);
    if (parseJsonArtifactBytes(publicReceiptBytes, "Public receipt").schemaVersion === "0.5") {
      if (publicReceiptBytes.byteLength > 524288 || (publicReceiptBytes[0] === 0xef && publicReceiptBytes[1] === 0xbb && publicReceiptBytes[2] === 0xbf)) throw new Error("Package receipt must be UTF-8 without BOM and at most 512 KiB.");
      await parsePackageReceipt(publicReceiptBytes);
      registrationRpc = "register_package_blinding_transformation";
    } else {
      const publicReceipt = parseSupportedBlindingReceiptBytes(publicReceiptBytes);
      registrationRpc = registrationRpcForBlindingReceipt(publicReceipt);
    }
    publicReceiptText = new TextDecoder("utf-8", { fatal: true }).decode(
      publicReceiptBytes,
    );
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Unable to validate public blinding receipt: ${error.message}`
          : "Unable to validate public blinding receipt.",
    };
  }

  const { data, error } = await supabase.rpc(
    registrationRpc,
    {
      p_workflow_id: workflowId,
      p_public_receipt_text: publicReceiptText,
    },
  );

  if (error) {
    return {
      ok: false,
      error: `Unable to register blinded package: ${error.message}`,
    };
  }

  if (typeof data !== "string" || data.length === 0) {
    return {
      ok: false,
      error:
        "The blinded package was registered, but its server record could not be confirmed.",
    };
  }

  revalidatePath(`/studies/${studyId}`);
  revalidatePath(`/studies/${studyId}/blinding/${workflowId}`);

  return {
    ok: true,
    transformationRecordId: data,
  };
}

export type RegisterAnalysisLockResult =
  | {
      ok: true;
      lockRecordId: string;
    }
  | {
      ok: false;
      error: string;
    };

export async function registerAnalysisLock(
  formData: FormData,
): Promise<RegisterAnalysisLockResult> {
  const studyId = getRequiredString(formData, "studyId");
  const workflowId = getRequiredString(formData, "workflowId");
  const receiptBase64Value = formData.get("analysisLockReceiptBase64");

  if (
    typeof receiptBase64Value !== "string" ||
    receiptBase64Value.length === 0
  ) {
    return {
      ok: false,
      error: "An analysis-lock receipt is required for registration.",
    };
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: workflow, error: workflowError } = await supabase
    .from("blinding_workflows")
    .select("state")
    .eq("id", workflowId)
    .eq("study_id", studyId)
    .maybeSingle();

  if (workflowError) {
    return {
      ok: false,
      error: `Unable to verify blinding workflow: ${workflowError.message}`,
    };
  }

  if (!workflow) {
    return {
      ok: false,
      error: "Blinding workflow not found.",
    };
  }

  if (workflow.state !== "blinded") {
    return {
      ok: false,
      error:
        "Analysis-lock registration requires the workflow to be blinded. Reload the workflow before continuing.",
    };
  }

  let receiptText: string;
  let registrationRpc: "register_analysis_lock" | "register_multi_analysis_lock" | "register_package_analysis_lock";

  try {
    if (
      receiptBase64Value.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(receiptBase64Value)
    ) {
      throw new Error("Analysis-lock receipt transport encoding is invalid.");
    }

    const decoded = Buffer.from(receiptBase64Value, "base64");

    if (decoded.toString("base64") !== receiptBase64Value) {
      throw new Error("Analysis-lock receipt transport encoding is invalid.");
    }

    const receiptBytes = new Uint8Array(decoded);
    if (parseJsonArtifactBytes(receiptBytes, "Analysis lock").schemaVersion === "0.5") {
      if (receiptBytes.byteLength > 262144 || (receiptBytes[0] === 0xef && receiptBytes[1] === 0xbb && receiptBytes[2] === 0xbf)) throw new Error("Package lock receipt must be UTF-8 without BOM and at most 256 KiB.");
      const lock = parsePackageAnalysisLock(receiptBytes);
      if (lock.analysisArtifacts.length > 100) throw new Error("Select at most 100 analysis artifacts.");
      registrationRpc = "register_package_analysis_lock";
    } else {
      const receipt = parseSupportedAnalysisLockReceiptBytes(receiptBytes);
      registrationRpc = registrationRpcForAnalysisLockReceipt(receipt);
    }
    receiptText = new TextDecoder("utf-8", { fatal: true }).decode(
      receiptBytes,
    );
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Unable to validate analysis-lock receipt: ${error.message}`
          : "Unable to validate analysis-lock receipt.",
    };
  }

  const { data, error } = await supabase.rpc(registrationRpc, {
    p_workflow_id: workflowId,
    p_analysis_lock_receipt_text: receiptText,
  });

  if (error) {
    return {
      ok: false,
      error: `Unable to register analysis lock: ${error.message}`,
    };
  }

  if (typeof data !== "string" || data.length === 0) {
    return {
      ok: false,
      error:
        "The analysis lock was registered, but its server record could not be confirmed.",
    };
  }

  revalidatePath(`/studies/${studyId}`);
  revalidatePath(`/studies/${studyId}/blinding/${workflowId}`);

  return {
    ok: true,
    lockRecordId: data,
  };
}

export async function requestUnblinding(formData: FormData) {
  const studyId = getRequiredString(formData, "studyId");
  const workflowId = getRequiredString(formData, "workflowId");
  const analysisLockIdValue = formData.get("analysisLockId");
  const analysisLockId =
    typeof analysisLockIdValue === "string" &&
    analysisLockIdValue.trim().length > 0
      ? analysisLockIdValue.trim()
      : null;

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: workflow, error: workflowError } = await supabase
    .from("blinding_workflows")
    .select("state")
    .eq("id", workflowId)
    .eq("study_id", studyId)
    .maybeSingle();

  if (workflowError) {
    throw new Error(
      `Unable to verify blinding workflow: ${workflowError.message}`,
    );
  }

  if (!workflow) {
    throw new Error("Blinding workflow not found.");
  }

  if (workflow.state !== "blinded") {
    throw new Error(
      "Unblinding can only be requested while the workflow is blinded.",
    );
  }

  const { data, error } = await supabase.rpc("request_unblinding", {
    p_workflow_id: workflowId,
    p_analysis_lock_id: analysisLockId,
  });

  if (error) {
    throw new Error(`Unable to request unblinding: ${error.message}`);
  }

  if (typeof data !== "string" || data.length === 0) {
    throw new Error(
      "The unblinding request was registered, but its server record could not be confirmed.",
    );
  }

  redirectToCurrentWorkflow(studyId, workflowId, "requested=1");
}

export async function authorizeUnblinding(formData: FormData) {
  const studyId = getRequiredString(formData, "studyId");
  const workflowId = getRequiredString(formData, "workflowId");
  const requestId = getRequiredString(formData, "requestId");

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: request, error: requestError } = await supabase
    .from("unblinding_requests")
    .select("id")
    .eq("id", requestId)
    .eq("workflow_id", workflowId)
    .eq("study_id", studyId)
    .maybeSingle();

  if (requestError) {
    throw new Error(
      `Unable to verify unblinding request: ${requestError.message}`,
    );
  }

  if (!request) {
    throw new Error("Unblinding request not found.");
  }

  const { data, error } = await supabase.rpc("authorize_unblinding", {
    p_request_id: requestId,
  });

  if (error) {
    throw new Error(`Unable to authorize unblinding: ${error.message}`);
  }

  if (typeof data !== "string" || data.length === 0) {
    throw new Error(
      "Unblinding was authorized, but its server record could not be confirmed.",
    );
  }

  redirectToCurrentWorkflow(studyId, workflowId, "authorized=1");
}

function getSelectedColumnsMetadata(formData: FormData):
  { column: string; categoryCount: number }[] {
  const raw = getRequiredExactString(formData, "selectedColumns");
  if (raw.length > 65536) throw new Error("Selected-column metadata is too large.");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Selected-column metadata must be JSON.");
  }
  const selected = requireArray(value, "Selected columns");
  if (selected.length < 1 || selected.length > 1024) {
    throw new Error("v0.4 completion requires at least one selected column.");
  }
  const names = new Set<string>();
  return selected.map((item) => {
    const column = requireRecord(item, "Selected column");
    requireExactKeys(column, ["column", "categoryCount"], "Selected column");
    const name = requireNonblankString(column, "column", "Selected column name");
    const categoryCount = requirePositiveInteger(column.categoryCount, "Category count", 2);
    if (names.has(name)) throw new Error("Selected column names must be unique.");
    names.add(name);
    return { column: name, categoryCount };
  });
}

export type RegisterUnblindingCompletionResult =
  | {
      ok: true;
      completionRecordId: string;
    }
  | {
      ok: false;
      error: string;
    };

export async function registerUnblindingCompletion(
  formData: FormData,
): Promise<RegisterUnblindingCompletionResult> {
  const studyId = getRequiredString(formData, "studyId");
  const workflowId = getRequiredString(formData, "workflowId");
  const requestId = getRequiredString(formData, "requestId");
  const acknowledgedCustody = formData.get("acknowledgeCustody") === "on";

  if (!acknowledgedCustody) {
    return {
      ok: false,
      error:
        "Confirm that the final unblinding receipt has been saved before registering completion.",
    };
  }

  let receiptCreatedAt: string;
  let unblindingId: string;
  let transformationId: string;
  let lockId: string | null;
  let selectedColumn: string | null;
  let selectedColumns: { column: string; categoryCount: number }[] | null;
  let schemaVersion: "0.3" | "0.4" | "0.5";
  let sourceArtifactSha256: string;
  let blindingReceiptSha256: string;
  let blindedArtifactSha256: string;
  let unblindingSecretSha256: string;
  let analysisLockReceiptSha256: string | null;
  let analysisArtifactFilename: string | null;
  let analysisArtifactSha256: string | null;
  let analysisArtifactByteLength: number | null;
  let unblindingReceiptSha256: string;

  try {
    receiptCreatedAt = getRequiredCanonicalTimestamp(
      formData,
      "receiptCreatedAt",
    );
    unblindingId = getRequiredString(formData, "unblindingId");
    transformationId = getRequiredString(formData, "transformationId");
    lockId = getOptionalString(formData, "lockId");
    const version = formData.get("schemaVersion") ?? "0.3";
    if (version !== "0.3" && version !== "0.4" && version !== "0.5") {
      throw new Error("Unsupported unblinding receipt version.");
    }
    schemaVersion = version;
    selectedColumn = version === "0.3"
      ? getRequiredExactString(formData, "selectedColumn") : null;
    selectedColumns = version === "0.4"
      ? getSelectedColumnsMetadata(formData) : null;
    if (version === "0.5" && (formData.has("selectedColumn") || formData.has("selectedColumns"))) throw new Error("Package completion requires only manifest commitment metadata.");
    if (version === "0.4" && formData.has("selectedColumn")) {
      throw new Error("v0.4 metadata must not include a single selected column.");
    }
    if (version === "0.3" && formData.has("selectedColumns")) {
      throw new Error("v0.3 metadata must not include multiple selected columns.");
    }
    sourceArtifactSha256 = getRequiredSha256(
      formData,
      "sourceArtifactSha256",
    );
    blindingReceiptSha256 = getRequiredSha256(
      formData,
      "blindingReceiptSha256",
    );
    blindedArtifactSha256 = getRequiredSha256(
      formData,
      "blindedArtifactSha256",
    );
    unblindingSecretSha256 = getRequiredSha256(
      formData,
      "unblindingSecretSha256",
    );
    analysisLockReceiptSha256 = getOptionalSha256(
      formData,
      "analysisLockReceiptSha256",
    );
    analysisArtifactFilename = getOptionalExactString(
      formData,
      "analysisArtifactFilename",
    );
    analysisArtifactSha256 = getOptionalSha256(
      formData,
      "analysisArtifactSha256",
    );
    analysisArtifactByteLength = getOptionalPositiveInteger(
      formData,
      "analysisArtifactByteLength",
    );

    const lockMetadata = [
      lockId,
      analysisLockReceiptSha256,
      analysisArtifactFilename,
      analysisArtifactSha256,
      analysisArtifactByteLength,
    ];
    const hasAnyLockMetadata = lockMetadata.some((value) => value !== null);
    const hasAllLockMetadata = lockMetadata.every((value) => value !== null);

    if (hasAnyLockMetadata && !hasAllLockMetadata) {
      throw new Error(
        "Analysis-lock completion metadata must be supplied together or omitted together.",
      );
    }
    unblindingReceiptSha256 = getRequiredSha256(
      formData,
      "unblindingReceiptSha256",
    );
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Unable to validate unblinding completion metadata: ${error.message}`
          : "Unable to validate unblinding completion metadata.",
    };
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: workflow, error: workflowError } = await supabase
    .from("blinding_workflows")
    .select("state")
    .eq("id", workflowId)
    .eq("study_id", studyId)
    .maybeSingle();

  if (workflowError) {
    return {
      ok: false,
      error: `Unable to verify blinding workflow: ${workflowError.message}`,
    };
  }

  if (!workflow) {
    return {
      ok: false,
      error: "Blinding workflow not found.",
    };
  }

  if (
    workflow.state !== "unblinding_authorized" &&
    workflow.state !== "unblinded"
  ) {
    return {
      ok: false,
      error:
        "Completion registration requires an authorized unblinding workflow. Reload the workflow before continuing.",
    };
  }

  const { data: request, error: requestError } = await supabase
    .from("unblinding_requests")
    .select("id")
    .eq("id", requestId)
    .eq("workflow_id", workflowId)
    .eq("study_id", studyId)
    .maybeSingle();

  if (requestError) {
    return {
      ok: false,
      error: `Unable to verify unblinding request: ${requestError.message}`,
    };
  }

  if (!request) {
    return {
      ok: false,
      error: "Authorized unblinding request not found.",
    };
  }

  const commonCompletionMetadata = {
      p_workflow_id: workflowId,
      p_request_id: requestId,
      p_unblinding_id: unblindingId,
      p_receipt_created_at: receiptCreatedAt,
      p_transformation_id: transformationId,
      p_lock_id: lockId,
      p_source_artifact_sha256: sourceArtifactSha256,
      p_blinding_receipt_sha256: blindingReceiptSha256,
      p_blinded_artifact_sha256: blindedArtifactSha256,
      p_unblinding_secret_sha256: unblindingSecretSha256,
      p_analysis_lock_receipt_sha256: analysisLockReceiptSha256,
      p_analysis_artifact_filename: analysisArtifactFilename,
      p_analysis_artifact_sha256: analysisArtifactSha256,
      p_analysis_artifact_byte_length: analysisArtifactByteLength,
      p_unblinding_receipt_sha256: unblindingReceiptSha256,
  };
  const { data, error } = schemaVersion === "0.5"
    ? await supabase.rpc("register_package_unblinding_completion", commonCompletionMetadata)
    : schemaVersion === "0.4"
    ? await supabase.rpc("register_multi_unblinding_completion", {
        ...commonCompletionMetadata,
        p_selected_columns: selectedColumns,
      })
    : await supabase.rpc("register_unblinding_completion", {
        ...commonCompletionMetadata,
        p_selected_column: selectedColumn,
      });

  if (error) {
    return {
      ok: false,
      error: `Unable to register unblinding completion: ${error.message}`,
    };
  }

  if (typeof data !== "string" || data.length === 0) {
    return {
      ok: false,
      error:
        "The unblinding completion was registered, but its server record could not be confirmed.",
    };
  }

  revalidatePath(`/studies/${studyId}`);
  revalidatePath(`/studies/${studyId}/blinding/${workflowId}`);

  return {
    ok: true,
    completionRecordId: data,
  };
}
