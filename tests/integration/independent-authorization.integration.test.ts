import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { createResearchAnalysisLock } from "@/lib/blinding/package-v05/legacy-lock";
import { createLegacyReleaseWithPackageLock } from "@/lib/blinding/package-v05/legacy-release";
import { sha256Hex } from "@/lib/blinding/hashing";
import { createDatasetPackage } from "@/lib/blinding/package-v05/package";
import { createPackageUnblindingReceipt } from "@/lib/blinding/package-v05/unblinding";
import { canonicalBytes } from "@/lib/blinding/package-v05/artifacts";
import { delimitedAdapter } from "@/lib/datasets/adapters/delimited";
import { createBlindedPackage } from "@/lib/blinding/blinding-package";

// Intentionally hard-coded: this integration test may ONLY write to the
// project's existing DEVELOPMENT Supabase project, never blindstats-prod.
const DEVELOPMENT_PROJECT_REF = "kfrfemqoalzxwzecyjjf";
const DEVELOPMENT_HOST = `${DEVELOPMENT_PROJECT_REF}.supabase.co`;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for this opt-in integration test.`);
  }
  return value;
}

function getTestConfiguration() {
  if (process.env.BLINDSTATS_IT_CONFIRM !== "DEVELOPMENT_ONLY") {
    throw new Error(
      "Refusing database writes: set BLINDSTATS_IT_CONFIRM=DEVELOPMENT_ONLY explicitly.",
    );
  }

  const rawUrl = requiredEnvironment("BLINDSTATS_IT_SUPABASE_URL");
  const url = new URL(rawUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== DEVELOPMENT_HOST ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(
      `Refusing database writes: expected https://${DEVELOPMENT_HOST}/ only.`,
    );
  }

  const publishableKey = requiredEnvironment(
    "BLINDSTATS_IT_SUPABASE_PUBLISHABLE_KEY",
  );
  if (!publishableKey.startsWith("sb_publishable_")) {
    throw new Error(
      "Use only the development project's sb_publishable_ key (never a secret/service-role key).",
    );
  }

  const firstEmail = requiredEnvironment("BLINDSTATS_IT_A_EMAIL");
  const secondEmail = requiredEnvironment("BLINDSTATS_IT_B_EMAIL");
  if (firstEmail.toLowerCase() === secondEmail.toLowerCase()) {
    throw new Error("The two development test accounts must be different.");
  }

  return {
    supabaseUrl: url.origin,
    publishableKey,
    firstEmail,
    firstPassword: requiredEnvironment("BLINDSTATS_IT_A_PASSWORD"),
    secondEmail,
    secondPassword: requiredEnvironment("BLINDSTATS_IT_B_PASSWORD"),
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

function requiredId(value: string | undefined | null, operation: string): string {
  if (!value) throw new Error(`${operation} did not return an ID.`);
  return value;
}

// These opt-in tests perform real RLS/RPC calls with two
// separate password-authenticated users; it does not use admin credentials.
describe("development Supabase: independent authorization", () => {
  it.each([{ label: "optional lock omitted", multiLock: false, packageMode: false }, { label: "v0.5 multi-file lock", multiLock: true, packageMode: false }, { label: "v0.5 package with required lock", multiLock: true, packageMode: true }, { label: "v0.5 package with optional lock omitted", multiLock: false, packageMode: true }])("rejects requester self-authorization and accepts a distinct authorized member ($label)", async ({ multiLock, packageMode }) => {
    // Check ALL safeguards before creating clients or issuing network requests.
    const config = getTestConfiguration();
    const clientOptions = {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    };
    const a = createClient(config.supabaseUrl, config.publishableKey, clientOptions);
    const b = createClient(config.supabaseUrl, config.publishableKey, clientOptions);

    // Authentication must succeed before creating any test Study.
    const aLogin = await a.auth.signInWithPassword({
      email: config.firstEmail,
      password: config.firstPassword,
    });
    checked(aLogin.error, "Account A sign-in");
    const aId = requiredId(aLogin.data.user?.id, "Account A sign-in");

    const bLogin = await b.auth.signInWithPassword({
      email: config.secondEmail,
      password: config.secondPassword,
    });
    checked(bLogin.error, "Account B sign-in");
    const bId = requiredId(bLogin.data.user?.id, "Account B sign-in");
    expect(aId).not.toBe(bId);

    let studyId: string | null = null;
    try {
      const tag = new Date().toISOString().replace(/[:.]/g, "-");
      const studyName = `[INTEGRATION TEST] Independent authorization ${tag}`;

      // Match the real application: INSERT without an immediate RETURNING/SELECT.
      // The studies SELECT policy depends on creator membership, established by
      // an AFTER INSERT trigger. Reading in a separate request gives that
      // transaction time to finish before RLS evaluates the SELECT policy.
      const studyInsert = await a.from("studies")
        .insert({
          name: studyName,
          description: "Disposable synthetic authorization test. Safe to archive.",
        });
      checked(studyInsert.error, "Create synthetic Study");

      const studyResult = await a.from("studies")
        .select("id, created_by")
        .eq("name", studyName)
        .eq("created_by", aId)
        .single();
      checked(studyResult.error, "Read newly created Study");
      studyId = requiredId(studyResult.data?.id, "Read newly created Study");
      expect(studyResult.data?.created_by).toBe(aId);

      // RLS: B must not see this Study before the owner adds B.
      const beforeMembership = await b.from("studies")
        .select("id")
        .eq("id", studyId)
        .maybeSingle();
      checked(beforeMembership.error, "Pre-membership RLS read");
      expect(beforeMembership.data).toBeNull();

      // This existing RPC grants B only the independent authorization role.
      const assignment = await a.rpc("add_independent_authorizer_by_email", {
        p_study_id: studyId,
        p_email: config.secondEmail,
      });
      checked(assignment.error, "Assign independent authorizer");
      expect(assignment.data).toBe(bId);

      const permissions = await b.from("study_capabilities")
        .select("capability")
        .eq("study_id", studyId)
        .eq("user_id", bId);
      checked(permissions.error, "Read Account B capabilities");
      expect((permissions.data ?? []).map((entry) => entry.capability))
        .toEqual(["unblinding.authorize"]);

      const visibleToB = await b.from("studies")
        .select("id")
        .eq("id", studyId)
        .single();
      checked(visibleToB.error, "Post-membership RLS read");
      expect(visibleToB.data?.id).toBe(studyId);

      const workflowResult = await a.from("blinding_workflows")
        .insert({ study_id: studyId })
        .select("id")
        .single();
      checked(workflowResult.error, "Create synthetic workflow");
      const workflowId = requiredId(workflowResult.data?.id, "Create workflow");

      const draft = await a.from("blinding_plan_drafts")
        .update({
          protection_targets: ["treatment"],
          require_analysis_lock: multiLock,
          authorization_policy: "independent",
        })
        .eq("workflow_id", workflowId)
        .select("workflow_id")
        .single();
      checked(draft.error, "Configure independent BlindingPlan");
      expect(draft.data?.workflow_id).toBe(workflowId);

      const activation = await a.rpc("activate_blinding_plan", {
        p_workflow_id: workflowId,
        p_acknowledge_weaker_policies: !multiLock,
      });
      checked(activation.error, "Activate independent BlindingPlan");
      expect(activation.data).toBeTruthy();

      // Use the actual browser-local core to generate a well-formed receipt.
      // Only the sealed public receipt is sent to Supabase, not the CSV/secret.
      const syntheticCsv = new TextEncoder().encode(
        "id,treatment,outcome\n1,A,1\n2,B,2\n3,A,3\n",
      );
      const coordinated = packageMode ? await createDatasetPackage([
        { datasetId: "baseline", bytes: syntheticCsv, adapter: delimitedAdapter("csv") },
        { datasetId: "followup", bytes: new TextEncoder().encode('id\t"bras ""é"""\tscore\n1\tA\t4\n2\tB\t5\n'), adapter: delimitedAdapter("tsv") },
      ], [{ members: [{ datasetId: "baseline", variableId: "v2" }, { datasetId: "followup", variableId: "v2" }] }]) : null;
      const packageResult = coordinated ?? await createBlindedPackage(syntheticCsv, "treatment");
      const registrationRpc = packageMode ? "register_package_blinding_transformation" : "register_blinding_transformation";
      if (coordinated) {
        const args = { p_workflow_id: workflowId, p_public_receipt_text: coordinated.receiptArtifact.text };
        expect((await b.rpc(registrationRpc, args)).error).not.toBeNull();
        expect((await a.rpc("register_multi_blinding_transformation", args)).error).not.toBeNull();
        const wrongDigest = { ...coordinated.receipt, manifestSha256: "0".repeat(64) };
        const uncovered = structuredClone(coordinated.receipt);
        uncovered.manifest.mappingGroups[0].members.pop();
        uncovered.manifestSha256 = await sha256Hex(canonicalBytes(uncovered.manifest));
        const bad = [JSON.stringify(wrongDigest), JSON.stringify(uncovered), JSON.stringify({...coordinated.receipt, secret: "not allowed"}), coordinated.receiptArtifact.text.replace('"schemaVersion": "0.5"', '"schemaVersion": "0.5", "schemaVersion": "0.5"')];
        for (const text of bad) expect((await a.rpc(registrationRpc, {...args, p_public_receipt_text: text})).error).not.toBeNull();
      }
      const transformation = await a.rpc(registrationRpc, {
        p_workflow_id: workflowId,
        p_public_receipt_text: packageResult.receiptArtifact.text,
      });
      checked(transformation.error, "Register synthetic blinded receipt");
      expect(transformation.data).toBeTruthy();
      if (coordinated) {
        const stored = await a.from("blinding_transformations").select("schema_version, public_receipt_text, public_receipt_sha256, source_artifact_sha256, blinded_artifact_sha256, selected_columns").eq("workflow_id",workflowId).single();
        checked(stored.error, "Read registered v0.5 package");
        expect(stored.data).toMatchObject({schema_version:"0.5", public_receipt_text:coordinated.receiptArtifact.text, public_receipt_sha256:await sha256Hex(coordinated.receiptArtifact.bytes), source_artifact_sha256:coordinated.receipt.manifestSha256, blinded_artifact_sha256:coordinated.receipt.manifestSha256, selected_columns:null});
      }

      const lock = multiLock ? await createResearchAnalysisLock(packageResult.receiptArtifact.bytes, [
        { filename: "analysis.R", bytes: new TextEncoder().encode("mean(x)") },
        { filename: "results.txt", bytes: new TextEncoder().encode("Synthetic results") },
      ]) : null;
      let lockRecordId: string | null = null;
      if (lock) {
        if (coordinated) {
          const args = { p_workflow_id: workflowId, p_analysis_lock_receipt_text: lock.receiptArtifact.text };
          expect((await b.rpc("register_package_analysis_lock", args)).error).not.toBeNull();
          expect((await a.rpc("register_package_analysis_lock", { ...args, p_analysis_lock_receipt_text: JSON.stringify({...lock.receipt, blinding: {...lock.receipt.blinding, datasetCommitmentSha256: "0".repeat(64)}}) })).error).not.toBeNull();
        }
        const lockRegistration = await a.rpc("register_package_analysis_lock", { p_workflow_id: workflowId, p_analysis_lock_receipt_text: lock.receiptArtifact.text });
        checked(lockRegistration.error, "Register v0.5 lock");
        lockRecordId = requiredId(lockRegistration.data, "Register multi-artifact lock");
      }

      // A-only ability: B has not been granted unblinding.request.
      const bRequest = await b.rpc("request_unblinding", {
        p_workflow_id: workflowId,
        p_analysis_lock_id: lockRecordId,
      });
      expect(bRequest.error).not.toBeNull();
      expect(bRequest.data).toBeNull();

      const request = await a.rpc("request_unblinding", {
        p_workflow_id: workflowId,
        p_analysis_lock_id: lockRecordId,
      });
      checked(request.error, "Account A requests unblinding");
      const requestId = requiredId(request.data, "Unblinding request");

      // Critical negative assertion: although owner A has authorize capability,
      // the immutable Independent policy MUST prevent self-authorization.
      const selfAuthorization = await a.rpc("authorize_unblinding", {
        p_request_id: requestId,
      });
      expect(selfAuthorization.error).not.toBeNull();
      expect(selfAuthorization.data).toBeNull();

      const afterRejection = await a.from("blinding_workflows")
        .select("state")
        .eq("id", workflowId)
        .single();
      checked(afterRejection.error, "Verify rejected authorization state");
      expect(afterRejection.data?.state).toBe("blinded");

      // Critical positive assertion: a distinct authorized Study member succeeds.
      const authorization = await b.rpc("authorize_unblinding", {
        p_request_id: requestId,
      });
      checked(authorization.error, "Account B authorizes unblinding");
      const authorizationId = requiredId(authorization.data, "Unblinding authorization");

      const persisted = await a.from("unblinding_requests")
        .select("id, requested_by, analysis_lock_id")
        .eq("id", requestId)
        .single();
      checked(persisted.error, "Read persisted request");
      expect(persisted.data?.requested_by).toBe(aId);
      expect(persisted.data?.analysis_lock_id).toBe(lockRecordId);

      const approval = await a.from("unblinding_authorizations")
        .select("id, request_id, authorized_by, authorization_policy")
        .eq("id", authorizationId)
        .single();
      checked(approval.error, "Read persisted authorization");
      expect(approval.data).toMatchObject({
        request_id: requestId,
        authorized_by: bId,
        authorization_policy: "independent",
      });

      const finalWorkflow = await a.from("blinding_workflows")
        .select("state")
        .eq("id", workflowId)
        .single();
      checked(finalWorkflow.error, "Read final workflow state");
      expect(finalWorkflow.data?.state).toBe("unblinding_authorized");
      if (coordinated) {
        const released = await createPackageUnblindingReceipt(coordinated.receiptArtifact.bytes, coordinated.secretArtifact.bytes, lock?.receiptArtifact.bytes ?? null);
        const receipt = released.completion;
        const refs = receipt.artifacts;
        const metadata = {
          p_workflow_id: workflowId, p_request_id: requestId, p_unblinding_id: receipt.unblindingId,
          p_receipt_created_at: receipt.createdAt, p_transformation_id: receipt.transformationId,
          p_lock_id: receipt.lockId,
          p_source_artifact_sha256: refs.sourceArtifactSha256, p_blinding_receipt_sha256: refs.blindingReceiptSha256,
          p_blinded_artifact_sha256: refs.blindedArtifactSha256, p_unblinding_secret_sha256: refs.unblindingSecretSha256,
          p_analysis_lock_receipt_sha256: refs.analysisLockReceiptSha256,
          p_analysis_artifact_filename: refs.analysisArtifact?.filename ?? null,
          p_analysis_artifact_sha256: refs.analysisArtifact?.sha256 ?? null,
          p_analysis_artifact_byte_length: refs.analysisArtifact?.byteLength ?? null,
          p_unblinding_receipt_sha256: await sha256Hex(released.receiptArtifact.bytes),
        };
        expect((await b.rpc("register_package_unblinding_completion", metadata)).error).not.toBeNull();
        expect((await a.rpc("register_package_unblinding_completion", {...metadata, p_blinded_artifact_sha256:"0".repeat(64)})).error).not.toBeNull();
        if (lock) expect((await a.rpc("register_package_unblinding_completion", {...metadata, p_analysis_lock_receipt_sha256:"0".repeat(64)})).error).not.toBeNull();
        const completed = await a.rpc("register_package_unblinding_completion", metadata);
        checked(completed.error, "Complete v0.5 package");
        expect(completed.data).toBeTruthy();
        const after = await a.from("blinding_workflows").select("state").eq("id",workflowId).single();
        checked(after.error, "Verify v0.5 completed state");
        expect(after.data?.state).toBe("unblinded");
        const stored = await a.from("unblinding_completions").select("schema_version, analysis_lock_id, blinded_artifact_sha256, unblinding_receipt_sha256, selected_columns").eq("id",completed.data).single();
        checked(stored.error, "Verify v0.5 completion metadata");
        expect(stored.data).toMatchObject({schema_version:"0.5",analysis_lock_id:lockRecordId,blinded_artifact_sha256:coordinated.receipt.manifestSha256,unblinding_receipt_sha256:metadata.p_unblinding_receipt_sha256,selected_columns:null});
      } else if (lock) {
        const released = await createLegacyReleaseWithPackageLock(packageResult.receiptArtifact.bytes, packageResult.secretArtifact.bytes, lock.receiptArtifact.bytes);
        const receipt = released.completion;
        if (receipt.schemaVersion !== "0.3" || !receipt.artifacts.analysisArtifact) throw new Error("Expected historical completion metadata.");
        const refs = receipt.artifacts;
        const metadata = {
          p_workflow_id: workflowId, p_request_id: requestId, p_unblinding_id: receipt.unblindingId,
          p_receipt_created_at: receipt.createdAt, p_transformation_id: receipt.transformationId,
          p_lock_id: receipt.lockId, p_selected_column: receipt.selectedColumn,
          p_source_artifact_sha256: refs.sourceArtifactSha256, p_blinding_receipt_sha256: refs.blindingReceiptSha256,
          p_blinded_artifact_sha256: refs.blindedArtifactSha256, p_unblinding_secret_sha256: refs.unblindingSecretSha256,
          p_analysis_lock_receipt_sha256: refs.analysisLockReceiptSha256,
          p_analysis_artifact_filename: refs.analysisArtifact?.filename,
          p_analysis_artifact_sha256: refs.analysisArtifact?.sha256,
          p_analysis_artifact_byte_length: refs.analysisArtifact?.byteLength,
          p_unblinding_receipt_sha256: await sha256Hex(released.receiptArtifact.bytes),
        };
        const unauthorized = await b.rpc("register_unblinding_completion", metadata);
        expect(unauthorized.error).not.toBeNull();
        const completed = await a.rpc("register_unblinding_completion", metadata);
        checked(completed.error, "Complete v0.3 transformation with v0.5 lock");
        expect(completed.data).toBeTruthy();
        const after = await a.from("blinding_workflows").select("state").eq("id", workflowId).single();
        checked(after.error, "Verify completed state");
        expect(after.data?.state).toBe("unblinded");
      }
    } finally {
      if (studyId) {
        // There is deliberately no client-side Study DELETE permission.
        // Archive synthetic records instead of bypassing RLS using an admin key.
        const archival = await a.from("studies")
          .update({ lifecycle: "archived" })
          .eq("id", studyId)
          .select("id, lifecycle")
          .single();
        if (archival.error || archival.data?.lifecycle !== "archived") {
          console.error(
            `IMPORTANT: Archive the disposable integration Study manually: ${studyId}`,
          );
          checked(archival.error, "Archive disposable Study");
          throw new Error("Could not verify synthetic Study archival.");
        }
      }
      // Each client holds its tokens only in process memory; persistSession=false.
    }
  });
});
