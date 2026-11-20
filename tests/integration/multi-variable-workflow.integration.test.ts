import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { sha256Hex } from "@/lib/blinding/hashing";
import { createMultiBlindedPackage } from "@/lib/blinding/multi-blinding";
import {
  createMultiAnalysisLockPackage,
  createMultiUnblindingPackage,
} from "@/lib/blinding/multi-unblinding";

// Real database writes: this test is opt-in and may ONLY target Development.
// It is excluded from ordinary npm test and must be launched with the existing
// scripts/run-development-authz-test.ps1 launcher (which prompts privately).
const DEVELOPMENT_REF = "kfrfemqoalzxwzecyjjf";
const DEVELOPMENT_HOST = `${DEVELOPMENT_REF}.supabase.co`;

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function configuration() {
  if (process.env.BLINDSTATS_IT_CONFIRM !== "DEVELOPMENT_ONLY") {
    throw new Error("Refusing database writes outside the Development opt-in test.");
  }
  const url = new URL(env("BLINDSTATS_IT_SUPABASE_URL"));
  if (
    url.protocol !== "https:" ||
    url.hostname !== DEVELOPMENT_HOST ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(`Refusing writes: expected https://${DEVELOPMENT_HOST}/ only.`);
  }
  const key = env("BLINDSTATS_IT_SUPABASE_PUBLISHABLE_KEY");
  if (!key.startsWith("sb_publishable_")) {
    throw new Error("Use only the Development publishable key, not an admin key.");
  }
  const accountA = env("BLINDSTATS_IT_A_EMAIL");
  const accountB = env("BLINDSTATS_IT_B_EMAIL");
  if (accountA.toLowerCase() === accountB.toLowerCase()) {
    throw new Error("The two Development accounts must be distinct.");
  }
  return {
    url: url.origin,
    key,
    accountA,
    accountB,
    passwordA: env("BLINDSTATS_IT_A_PASSWORD"),
    passwordB: env("BLINDSTATS_IT_B_PASSWORD"),
  };
}

function checked(
  error: { code?: string; message: string; status?: number } | null,
  operation: string,
): void {
  if (error) {
    throw new Error(
      `${operation} failed (${error.code ?? error.status ?? "unknown"}): ${error.message}`,
    );
  }
}

function id(value: string | null | undefined, operation: string): string {
  if (!value) throw new Error(`${operation} did not return an identifier.`);
  return value;
}

const encode = (value: string) => new TextEncoder().encode(value);
const sourceCsv = [
  "participant,treatment,site,outcome",
  "1,Active,North,4",
  "2,Placebo,South,7",
  "3,Active,South,5",
  "4,Placebo,North,6",
  "",
].join("\n");

describe("Development only: complete v0.4 two-account workflow", () => {
  it.each([
    { label: "one column", columns: ["treatment"] },
    { label: "two columns", columns: ["treatment", "site"] },
  ])("registers the exact v0.4 artifact chain for $label and enforces independent authorization", async ({ columns }) => {
    const config = configuration();
    const options = {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    };
    const a = createClient(config.url, config.key, options);
    const b = createClient(config.url, config.key, options);

    const aLogin = await a.auth.signInWithPassword({
      email: config.accountA,
      password: config.passwordA,
    });
    checked(aLogin.error, "Account A sign-in");
    const aUserId = id(aLogin.data.user?.id, "Account A sign-in");

    const bLogin = await b.auth.signInWithPassword({
      email: config.accountB,
      password: config.passwordB,
    });
    checked(bLogin.error, "Account B sign-in");
    const bUserId = id(bLogin.data.user?.id, "Account B sign-in");
    expect(aUserId).not.toBe(bUserId);

    let studyId: string | null = null;
    try {
      const suffix = `${new Date().toISOString()}-${crypto.randomUUID()}`;
      const studyName = `[INTEGRATION TEST] v0.4 ${columns.length}-column ${suffix}`;
      const insertion = await a.from("studies").insert({
        name: studyName,
        description: "Disposable synthetic v0.4 workflow. Archive after test.",
      });
      checked(insertion.error, "Create synthetic Study");

      const newStudy = await a.from("studies")
        .select("id, created_by")
        .eq("name", studyName)
        .eq("created_by", aUserId)
        .single();
      checked(newStudy.error, "Read synthetic Study");
      studyId = id(newStudy.data?.id, "Read synthetic Study");

      // An unrelated user must not see the new Study before being assigned.
      const preAssignment = await b.from("studies")
        .select("id")
        .eq("id", studyId)
        .maybeSingle();
      checked(preAssignment.error, "Pre-assignment RLS read");
      expect(preAssignment.data).toBeNull();

      const assignment = await a.rpc("add_independent_authorizer_by_email", {
        p_study_id: studyId,
        p_email: config.accountB,
      });
      checked(assignment.error, "Assign independent authorizer");
      expect(assignment.data).toBe(bUserId);

      const bPermissions = await b.from("study_capabilities")
        .select("capability")
        .eq("study_id", studyId)
        .eq("user_id", bUserId);
      checked(bPermissions.error, "Inspect authorizer capabilities");
      expect((bPermissions.data ?? []).map((entry) => entry.capability))
        .toEqual(["unblinding.authorize"]);

      const newWorkflow = await a.from("blinding_workflows")
        .insert({ study_id: studyId })
        .select("id")
        .single();
      checked(newWorkflow.error, "Create synthetic workflow");
      const workflowId = id(newWorkflow.data?.id, "Create workflow");

      const draft = await a.from("blinding_plan_drafts")
        .update({
          protection_targets: ["Treatment assignment and site context"],
          require_analysis_lock: true,
          authorization_policy: "independent",
        })
        .eq("workflow_id", workflowId)
        .select("workflow_id")
        .single();
      checked(draft.error, "Configure strong BlindingPlan");
      expect(draft.data?.workflow_id).toBe(workflowId);

      const activation = await a.rpc("activate_blinding_plan", {
        p_workflow_id: workflowId,
        p_acknowledge_weaker_policies: false,
      });
      checked(activation.error, "Activate BlindingPlan");
      expect(activation.data).toBeTruthy();

      // Real v0.4 artifacts, generated locally. Upload only the public sealed
      // blinding receipt; never the dataset, plaintext mapping, or secret.
      const blinded = await createMultiBlindedPackage(
        encode(sourceCsv),
        columns,
      );
      expect(blinded.receipt.schemaVersion).toBe("0.4");
      expect(blinded.receipt.selectedColumns).toEqual(
        columns.map((column) => ({ column, categoryCount: 2 })),
      );
      for (const value of ["Active", "Placebo", "North", "South"]) {
        expect(blinded.receiptArtifact.text).not.toContain(value);
      }

      const transformationRegistration = await a.rpc(
        "register_multi_blinding_transformation",
        {
          p_workflow_id: workflowId,
          p_public_receipt_text: blinded.receiptArtifact.text,
        },
      );
      checked(transformationRegistration.error, "Register v0.4 transformation");
      const transformationRecordId = id(
        transformationRegistration.data,
        "Register v0.4 transformation",
      );

      const storedTransformation = await a.from("blinding_transformations")
        .select("id, schema_version, selected_column, selected_columns, public_receipt_text, public_receipt_sha256")
        .eq("workflow_id", workflowId)
        .single();
      checked(storedTransformation.error, "Read registered transformation");
      expect(storedTransformation.data?.id).toBe(transformationRecordId);
      expect(storedTransformation.data?.schema_version).toBe("0.4");
      expect(storedTransformation.data?.selected_column).toBeNull();
      expect(storedTransformation.data?.selected_columns)
        .toEqual(blinded.receipt.selectedColumns);
      expect(storedTransformation.data?.public_receipt_text)
        .toBe(blinded.receiptArtifact.text);
      expect(storedTransformation.data?.public_receipt_sha256)
        .toBe(await sha256Hex(blinded.receiptArtifact.bytes));

      const lock = await createMultiAnalysisLockPackage(
        blinded.receiptArtifact.bytes,
        {
          filename: "synthetic-analysis.txt",
          bytes: encode("Synthetic blinded analysis: model fixed before unblinding.\n"),
        },
      );
      expect(lock.receipt.schemaVersion).toBe("0.4");

      const unauthorizedLock = await b.rpc("register_multi_analysis_lock", {
        p_workflow_id: workflowId,
        p_analysis_lock_receipt_text: lock.receiptArtifact.text,
      });
      expect(unauthorizedLock.error).not.toBeNull();
      expect(unauthorizedLock.data).toBeNull();

      const lockRegistration = await a.rpc("register_multi_analysis_lock", {
        p_workflow_id: workflowId,
        p_analysis_lock_receipt_text: lock.receiptArtifact.text,
      });
      checked(lockRegistration.error, "Register v0.4 analysis lock");
      const lockRecordId = id(lockRegistration.data, "Register analysis lock");

      const storedLock = await a.from("analysis_locks")
        .select("id, schema_version, transformation_record_id, analysis_lock_receipt_sha256")
        .eq("id", lockRecordId)
        .single();
      checked(storedLock.error, "Read registered analysis lock");
      expect(storedLock.data?.schema_version).toBe("0.4");
      expect(storedLock.data?.transformation_record_id)
        .toBe(transformationRecordId);
      expect(storedLock.data?.analysis_lock_receipt_sha256)
        .toBe(await sha256Hex(lock.receiptArtifact.bytes));

      // With a required lock, requesting against null must be rejected.
      const noLockRequest = await a.rpc("request_unblinding", {
        p_workflow_id: workflowId,
        p_analysis_lock_id: null,
      });
      expect(noLockRequest.error).not.toBeNull();
      expect(noLockRequest.data).toBeNull();

      const request = await a.rpc("request_unblinding", {
        p_workflow_id: workflowId,
        p_analysis_lock_id: lockRecordId,
      });
      checked(request.error, "Request locked v0.4 unblinding");
      const requestId = id(request.data, "Unblinding request");

      const selfAuthorization = await a.rpc("authorize_unblinding", {
        p_request_id: requestId,
      });
      expect(selfAuthorization.error).not.toBeNull();
      expect(selfAuthorization.data).toBeNull();

      const authorized = await b.rpc("authorize_unblinding", {
        p_request_id: requestId,
      });
      checked(authorized.error, "Independent authorization by Account B");
      const authorizationRecordId = id(authorized.data, "Independent authorization");
      expect(authorizationRecordId).toBeTruthy();

      const released = await createMultiUnblindingPackage(
        blinded.receiptArtifact.bytes,
        blinded.secretArtifact.bytes,
        lock.receiptArtifact.bytes,
      );
      expect(released.receipt.schemaVersion).toBe("0.4");
      expect(released.receipt.lockId).toBe(lock.receipt.lockId);
      expect(released.receipt.releasedMappings.map((entry) => entry.column))
        .toEqual(columns);
      expect(new Set(released.receipt.releasedMappings[0].mapping.map((entry) => entry.original)))
        .toEqual(new Set(["Active", "Placebo"]));
      if (columns.includes("site")) {
        expect(new Set(released.receipt.releasedMappings[1].mapping.map((entry) => entry.original)))
          .toEqual(new Set(["North", "South"]));
      }

      const artifactRefs = released.receipt.artifacts;
      const completionMetadata = {
        p_workflow_id: workflowId,
        p_request_id: requestId,
        p_unblinding_id: released.receipt.unblindingId,
        p_receipt_created_at: released.receipt.createdAt,
        p_transformation_id: released.receipt.transformationId,
        p_lock_id: released.receipt.lockId,
        p_selected_columns: released.receipt.selectedColumns,
        p_source_artifact_sha256: artifactRefs.sourceArtifactSha256,
        p_blinding_receipt_sha256: artifactRefs.blindingReceiptSha256,
        p_blinded_artifact_sha256: artifactRefs.blindedArtifactSha256,
        p_unblinding_secret_sha256: artifactRefs.unblindingSecretSha256,
        p_analysis_lock_receipt_sha256: artifactRefs.analysisLockReceiptSha256,
        p_analysis_artifact_filename: artifactRefs.analysisArtifact?.filename ?? null,
        p_analysis_artifact_sha256: artifactRefs.analysisArtifact?.sha256 ?? null,
        p_analysis_artifact_byte_length: artifactRefs.analysisArtifact?.byteLength ?? null,
        p_unblinding_receipt_sha256: await sha256Hex(released.receiptArtifact.bytes),
      };

      // An authorizer is not automatically authorized to receive the secret.
      const unauthorizedCompletion = await b.rpc(
        "register_multi_unblinding_completion",
        completionMetadata,
      );
      expect(unauthorizedCompletion.error).not.toBeNull();
      expect(unauthorizedCompletion.data).toBeNull();

      // Tampered metadata must fail without marking the workflow unblinded.
      const badCompletion = await a.rpc("register_multi_unblinding_completion", {
        ...completionMetadata,
        p_selected_columns: blinded.receipt.selectedColumns.map((entry, i) =>
          i === 0 ? { ...entry, categoryCount: 99 } : entry),
      });
      expect(badCompletion.error).not.toBeNull();
      expect(badCompletion.data).toBeNull();

      const stillAuthorized = await a.from("blinding_workflows")
        .select("state")
        .eq("id", workflowId)
        .single();
      checked(stillAuthorized.error, "Verify rejected completion state");
      expect(stillAuthorized.data?.state).toBe("unblinding_authorized");

      const completed = await a.rpc(
        "register_multi_unblinding_completion",
        completionMetadata,
      );
      checked(completed.error, "Register v0.4 unblinding completion");
      const completionRecordId = id(completed.data, "Register completion");

      const persisted = await a.from("unblinding_completions")
        .select("id, schema_version, selected_column, selected_columns, transformation_record_id, analysis_lock_id, unblinding_receipt_sha256, completed_by")
        .eq("workflow_id", workflowId)
        .single();
      checked(persisted.error, "Read registered v0.4 completion");
      expect(persisted.data).toMatchObject({
        id: completionRecordId,
        schema_version: "0.4",
        selected_column: null,
        selected_columns: blinded.receipt.selectedColumns,
        transformation_record_id: transformationRecordId,
        analysis_lock_id: lockRecordId,
        unblinding_receipt_sha256: completionMetadata.p_unblinding_receipt_sha256,
        completed_by: aUserId,
      });

      const afterCompletion = await a.from("blinding_workflows")
        .select("state")
        .eq("id", workflowId)
        .single();
      checked(afterCompletion.error, "Read final workflow state");
      expect(afterCompletion.data?.state).toBe("unblinded");

      const exactRetry = await a.rpc(
        "register_multi_unblinding_completion",
        completionMetadata,
      );
      checked(exactRetry.error, "Verify exact completion retry");
      expect(exactRetry.data).toBe(completionRecordId);
      // Only safe metadata and hashes were sent to the completion RPC.
      // The final receipt (with released mappings) remains browser-local.
    } finally {
      if (studyId) {
        const archived = await a.from("studies")
          .update({ lifecycle: "archived" })
          .eq("id", studyId)
          .select("id, lifecycle")
          .single();
        if (archived.error || archived.data?.lifecycle !== "archived") {
          console.error(
            `IMPORTANT: Archive the disposable synthetic Study manually: ${studyId}`,
          );
          checked(archived.error, "Archive disposable Study");
          throw new Error("Could not confirm synthetic Study archival.");
        }
      }
    }
  });
});
