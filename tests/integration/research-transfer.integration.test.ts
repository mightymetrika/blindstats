import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { createMultiAnalysisLockPackage, createMultiUnblindingPackage } from "@/lib/blinding/multi-unblinding";
import { sha256Hex } from "@/lib/blinding/hashing";
import { SECRET_TRANSFER_BUCKET } from "@/lib/research-transfer/secret-constants";
import { sendAuthorizedSecret, validateSecretForReceipt } from "@/lib/research-transfer/secret-transfer";
import { createDatasetPackage } from "@/lib/blinding/package-v05/package";
import { createPackageAnalysisLock } from "@/lib/blinding/package-v05/analysis-lock";
import { createPackageUnblindingReceipt } from "@/lib/blinding/package-v05/unblinding";
import { delimitedAdapter } from "@/lib/datasets/adapters/delimited";
import { createMultiBlindedPackage } from "@/lib/blinding/multi-blinding";
import {
  createAnalystKeyBackup, decryptBlindedDataset, encryptBlindedDataset, encryptResearchFile,
} from "@/lib/research-transfer/crypto";
import { RESEARCH_TRANSFER_BUCKET, transferStoragePath, uploadCiphertext, uploadTransferObject } from "@/lib/research-transfer/storage";

import { MANAGED_FILE_VERSION, prepareResearchFile, researchFileContext, sendResearchFile, verifyDeliveredResearchFile,
  type FileDeliveryContext, type ResearchFileRecord, type PreparedResearchFile } from "@/lib/research-transfer/research-files";

// OPT-IN: real synthetic Storage/DB writes to DEVELOPMENT only. Never Production.
const DEVELOPMENT_URL = "https://kfrfemqoalzxwzecyjjf.supabase.co";
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
function config() {
  if (process.env.BLINDSTATS_IT_CONFIRM !== "DEVELOPMENT_ONLY" ||
      required("BLINDSTATS_IT_SUPABASE_URL").replace(/\/$/, "") !== DEVELOPMENT_URL ||
      !required("BLINDSTATS_IT_SUPABASE_PUBLISHABLE_KEY").startsWith("sb_publishable_")) {
    throw new Error("Refusing v46 integration writes outside verified Development.");
  }
  const emailA = required("BLINDSTATS_IT_A_EMAIL");
  const emailB = required("BLINDSTATS_IT_B_EMAIL");
  if (emailA.toLowerCase() === emailB.toLowerCase()) throw new Error("Two different accounts required.");
  return {
    key: required("BLINDSTATS_IT_SUPABASE_PUBLISHABLE_KEY"),
    emailA, emailB,
    passwordA: required("BLINDSTATS_IT_A_PASSWORD"),
    passwordB: required("BLINDSTATS_IT_B_PASSWORD"),
  };
}
function checked(error: { message: string } | null, operation: string) {
  if (error) throw new Error(`${operation}: ${error.message}`);
}
function id(value: string | undefined | null, operation: string) {
  if (!value) throw new Error(`Missing ID: ${operation}`);
  return value;
}

const source = new TextEncoder().encode(
  "participant,treatment,site,outcome\n" +
  "1,Active,North,4\n2,Placebo,South,7\n3,Active,South,5\n4,Placebo,North,6\n",
);

async function exerciseSecretRelease(a: SupabaseClient, b: SupabaseClient, studyId: string, workflowId: string,
  aId: string, bId: string, packageResult: Awaited<ReturnType<typeof createMultiBlindedPackage>> | Awaited<ReturnType<typeof createDatasetPackage>>,
  backup: Awaited<ReturnType<typeof createAnalystKeyBackup>> | null) {
  const hash = await sha256Hex(packageResult.secretArtifact.bytes);
  const mode = backup ? "recipient_e2ee_v1" : "managed_at_rest_v1";
  const isPackage = packageResult.receipt.schemaVersion === "0.5";
  const analysis = { filename: "synthetic-analysis.txt", bytes: new TextEncoder().encode("Synthetic locked analysis") };
  const lock = isPackage ? await createPackageAnalysisLock(packageResult.receiptArtifact.bytes, [analysis, {filename:"report.txt",bytes:new TextEncoder().encode("Synthetic result")}]) : await createMultiAnalysisLockPackage(packageResult.receiptArtifact.bytes, analysis);
  const registered = await b.rpc(isPackage ? "register_package_analysis_lock" : "register_multi_analysis_lock", { p_workflow_id: workflowId, p_analysis_lock_receipt_text: lock.receiptArtifact.text });
  checked(registered.error, "Register analyst analysis lock");
  const request = await b.rpc("request_unblinding", { p_workflow_id: workflowId, p_analysis_lock_id: registered.data });
  checked(request.error, "Request unblinding");
  const requestId = id(request.data, "unblinding request");
  const args = { p_request_id: requestId, p_plaintext_sha256: hash, p_transfer_mode: mode };
  expect((await a.rpc("initiate_unblinding_secret_transfer", args)).error).not.toBeNull();
  expect((await a.storage.from(SECRET_TRANSFER_BUCKET).upload(`${studyId}/${crypto.randomUUID()}.bin`, new Blob(["synthetic"], {type: "application/octet-stream"}), {upsert:false})).error).not.toBeNull();
  expect((await b.rpc("authorize_unblinding", {p_request_id: requestId})).error).not.toBeNull();
  checked((await a.rpc("authorize_unblinding", {p_request_id: requestId})).error, "Authorize unblinding independently");
  expect((await b.rpc("initiate_unblinding_secret_transfer", args)).error).not.toBeNull();
  const wrongMode = await a.rpc("initiate_unblinding_secret_transfer", {...args,
    p_transfer_mode: backup ? "managed_at_rest_v1" : "recipient_e2ee_v1" });
  expect(wrongMode.error?.message).toContain("Study file protection");
  const context = { studyId, workflowId, transformationId: packageResult.receipt.transformationId, recipientId: bId, requestId };
  await sendAuthorizedSecret(a, packageResult.secretArtifact.bytes, packageResult.receiptArtifact.bytes, context, backup?.publicJwk ?? null, !!backup);
  const record = await b.from("unblinding_secret_transfers").select("*").eq("request_id",requestId).single();
  checked(record.error,"Read secret transfer metadata");
  const t = record.data;
  expect(t).toMatchObject({sender_id:aId,recipient_id:bId,plaintext_sha256:hash,transfer_mode:mode});
  const path = transferStoragePath(studyId,t.id);
  expect((await a.storage.from(SECRET_TRANSFER_BUCKET).download(path)).error).not.toBeNull();
  expect((await b.storage.from(SECRET_TRANSFER_BUCKET).download(path)).error).not.toBeNull();
  expect((await b.storage.from(SECRET_TRANSFER_BUCKET).createSignedUrl(path,60)).error).not.toBeNull();
  expect((await a.rpc("authorize_unblinding_secret_download",{p_transfer_id:t.id})).error).not.toBeNull();
  // Dataset RPCs must never resolve a secret ID.
  expect((await b.rpc("authorize_research_transfer_download_v2",{p_transfer_id:t.id})).error).not.toBeNull();
  expect((await b.rpc("acknowledge_unblinding_secret_transfer",{p_transfer_id:t.id,p_plaintext_sha256:hash})).error).not.toBeNull();
  const grant = await b.rpc("authorize_unblinding_secret_download",{p_transfer_id:t.id});
  checked(grant.error,"Authorize secret retrieval");
  expect(grant.data).toMatchObject({path,mode,sha256:t.object_sha256,byteLength:t.object_byte_length});
  expect((await b.rpc("acknowledge_unblinding_secret_transfer",{p_transfer_id:t.id,p_plaintext_sha256:"0".repeat(64)})).error).not.toBeNull();
  await validateSecretForReceipt(packageResult.secretArtifact.bytes,packageResult.receiptArtifact.bytes,context.transformationId);
  checked((await b.rpc("acknowledge_unblinding_secret_transfer",{p_transfer_id:t.id,p_plaintext_sha256:hash})).error,"Record verification attestation");
  const events = await b.from("unblinding_secret_transfer_events").select("actor_id,event_type,occurred_at").eq("transfer_id",t.id).order("id");
  checked(events.error,"Read secret audit history");
  expect(events.data?.map(e=>e.event_type)).toEqual(["upload_initiated","upload_completed","download_granted","download_verified"]);
  expect(events.data?.map(e=>e.actor_id)).toEqual([aId,aId,bId,bId]);
  const workflow = await b.from("blinding_workflows").select("state").eq("id",workflowId).single();
  checked(workflow.error,"Check that receipt of secret did not complete unblinding");
  expect(workflow.data?.state).toBe("unblinding_authorized");
  // Complete the existing local protocol, then verify the server refuses any
  // further secret grant or acknowledgement. Only synthetic metadata persists.
  const released = await (isPackage ? createPackageUnblindingReceipt : createMultiUnblindingPackage)(packageResult.receiptArtifact.bytes,
    packageResult.secretArtifact.bytes, lock.receiptArtifact.bytes);
  const receipt = "completion" in released ? released.completion : released.receipt;
  const refs = receipt.artifacts;
  checked((await b.rpc(isPackage ? "register_package_unblinding_completion" : "register_multi_unblinding_completion", {
    p_workflow_id: workflowId, p_request_id: requestId,
    p_unblinding_id: receipt.unblindingId,
    p_receipt_created_at: receipt.createdAt,
    p_transformation_id: receipt.transformationId,
    p_lock_id: receipt.lockId, ...(receipt.schemaVersion === "0.4" ? {p_selected_columns:receipt.selectedColumns} : {}),
    p_source_artifact_sha256: refs.sourceArtifactSha256,
    p_blinding_receipt_sha256: refs.blindingReceiptSha256,
    p_blinded_artifact_sha256: refs.blindedArtifactSha256,
    p_unblinding_secret_sha256: refs.unblindingSecretSha256,
    p_analysis_lock_receipt_sha256: refs.analysisLockReceiptSha256,
    p_analysis_artifact_filename: refs.analysisArtifact?.filename ?? null,
    p_analysis_artifact_sha256: refs.analysisArtifact?.sha256 ?? null,
    p_analysis_artifact_byte_length: refs.analysisArtifact?.byteLength ?? null,
    p_unblinding_receipt_sha256: await sha256Hex(released.receiptArtifact.bytes),
  })).error, "Register synthetic completion");
  const completed = await b.from("blinding_workflows").select("state").eq("id",workflowId).single();
  checked(completed.error,"Check completion state");
  expect(completed.data?.state).toBe("unblinded");
  expect((await b.rpc("authorize_unblinding_secret_download",{p_transfer_id:t.id})).error).not.toBeNull();
  expect((await b.rpc("acknowledge_unblinding_secret_transfer",{p_transfer_id:t.id,p_plaintext_sha256:hash})).error).not.toBeNull();
  expect((await b.storage.from(SECRET_TRANSFER_BUCKET).createSignedUrl(path,60)).error).not.toBeNull();
  // Cleanup is an operator-only API, even for the original sender/recipient.
  for (const actor of [a,b]) {
    expect((await actor.rpc("list_research_storage_cleanup",{p_transfer_id:t.id,p_synthetic_immediate:true})).error).not.toBeNull();
    expect((await actor.rpc("begin_research_storage_cleanup",{p_bucket_id:SECRET_TRANSFER_BUCKET,p_transfer_id:t.id,p_operator_label:"synthetic",p_synthetic_immediate:true})).error).not.toBeNull();
    expect((await actor.rpc("confirm_research_storage_cleanup",{p_attempt_id:t.id,p_operator_label:"synthetic"})).error).not.toBeNull();
    expect((await actor.from("research_storage_cleanup_attempts").select("id")).error).not.toBeNull();
  }
  console.info(`Synthetic completed secret cleanup fixture (${mode}): ${t.id}`);
}

describe("Development only: v46 encrypted transfer and Storage role separation", () => {
  it("governs upload, denies direct download, and audits analyst retrieval grants", async () => {
    const env = config();
    const options = { auth: { autoRefreshToken: false, persistSession: false } };
    const a = createClient(DEVELOPMENT_URL, env.key, options);
    const b = createClient(DEVELOPMENT_URL, env.key, options);
    const loginA = await a.auth.signInWithPassword({ email: env.emailA, password: env.passwordA });
    checked(loginA.error, "Custodian login");
    const aId = id(loginA.data.user?.id, "custodian");
    const loginB = await b.auth.signInWithPassword({ email: env.emailB, password: env.passwordB });
    checked(loginB.error, "Analyst login");
    const bId = id(loginB.data.user?.id, "analyst");
    expect(aId).not.toBe(bId);

    let studyId: string | null = null;
    try {
      const studyName = `[INTEGRATION TEST] v46 encrypted transfer ${crypto.randomUUID()}`;
      const created = await a.from("studies").insert({ name: studyName, file_protection: "recipient_e2ee_v1" });
      checked(created.error, "Create synthetic Study");
      const study = await a.from("studies").select("id")
        .eq("name", studyName).eq("created_by", aId).single();
      checked(study.error, "Read synthetic Study");
      studyId = id(study.data?.id, "Study");
      const workflow = await a.from("blinding_workflows")
        .insert({ study_id: studyId }).select("id").single();
      checked(workflow.error, "Create blinding workflow");
      const workflowId = id(workflow.data?.id, "workflow");
      const analystAssigned = await a.rpc("assign_blinded_analyst_by_email", {
        p_study_id: studyId, p_email: env.emailB,
      });
      checked(analystAssigned.error, "Assign blinded analyst");
      expect(analystAssigned.data).toBe(bId);

      const passphrase = "Unique synthetic integration passphrase 2026";
      const backup = await createAnalystKeyBackup(studyId, bId, passphrase);
      const forbiddenKey = await a.rpc("register_research_transfer_key", {
        p_study_id: studyId, p_public_jwk: backup.publicJwk,
        p_wrapped_private_key: backup.wrappedPrivateKey, p_salt: backup.salt, p_iv: backup.iv,
      });
      expect(forbiddenKey.error).not.toBeNull();
      const draft = await a.from("blinding_plan_drafts")
        .update({ protection_targets: ["Synthetic treatment and site"],
          require_analysis_lock: true, authorization_policy: "independent" })
        .eq("workflow_id", workflowId).select("workflow_id").single();
      checked(draft.error, "Set synthetic blinding plan");
      const activated = await a.rpc("activate_blinding_plan", {
        p_workflow_id: workflowId, p_acknowledge_weaker_policies: false,
      });
      checked(activated.error, "Activate blinding plan");
      const packageResult = await createMultiBlindedPackage(source, ["treatment", "site"]);
      const registered = await a.rpc("register_multi_blinding_transformation", {
        p_workflow_id: workflowId, p_public_receipt_text: packageResult.receiptArtifact.text,
      });
      checked(registered.error, "Register v0.4 blinded dataset");

      const validArgs = { p_workflow_id: workflowId, p_recipient_id: bId,
        p_filename: "synthetic_blinded.csv", p_plaintext_sha256: packageResult.blinded.sha256 };
      expect((await a.rpc("initiate_research_transfer", validArgs)).error?.message).toContain("registered key required");
      expect((await a.rpc("initiate_managed_research_transfer", validArgs)).error?.message).toContain("Study file protection");
      expect((await a.from("studies").update({file_protection:"managed_at_rest_v1"}).eq("id",studyId)).error).not.toBeNull();
      expect((await b.from("studies").update({file_protection:"managed_at_rest_v1"}).eq("id",studyId)).error).not.toBeNull();
      const keyRegistered = await b.rpc("register_research_transfer_key", {
        p_study_id: studyId, p_public_jwk: backup.publicJwk,
        p_wrapped_private_key: backup.wrappedPrivateKey, p_salt: backup.salt, p_iv: backup.iv,
      });
      checked(keyRegistered.error, "Register analyst encryption key");
      // Second Study: key registration works before a workflow/transformation exists;
      // the same public key must not be reused across Studies.
      const otherName = `[INTEGRATION TEST] v46 isolated keys ${crypto.randomUUID()}`;
      checked((await a.from("studies").insert({name:otherName,file_protection:"recipient_e2ee_v1"})).error,"Create second strict Study");
      const other = await a.from("studies").select("id").eq("name",otherName).eq("created_by",aId).single();
      checked(other.error,"Read second strict Study");
      const otherId = id(other.data?.id,"second Study");
      checked((await a.rpc("assign_blinded_analyst_by_email", {p_study_id:otherId,p_email:env.emailB})).error,"Assign second Study analyst");
      const reused = await b.rpc("register_research_transfer_key",{p_study_id:otherId,p_public_jwk:backup.publicJwk,
        p_wrapped_private_key:backup.wrappedPrivateKey,p_salt:backup.salt,p_iv:backup.iv});
      expect(reused.error?.code).toBe("23505");
      const separate = await createAnalystKeyBackup(otherId,bId,"Separate synthetic Study key passphrase 2026");
      checked((await b.rpc("register_research_transfer_key",{p_study_id:otherId,p_public_jwk:separate.publicJwk,
        p_wrapped_private_key:separate.wrappedPrivateKey,p_salt:separate.salt,p_iv:separate.iv})).error,"Register separate key before transformation");
      expect(separate.publicJwk).not.toEqual(backup.publicJwk);
      checked((await a.from("study_memberships").delete().eq("study_id",otherId).eq("user_id",bId)).error,"Revoke second Study membership");
      const revokedKey = await b.from("research_transfer_key_backups").select("user_id").eq("study_id",otherId);
      checked(revokedKey.error,"Read key metadata after membership revoked");
      expect(revokedKey.data).toEqual([]);
      checked((await a.rpc("assign_blinded_analyst_by_email",{p_study_id:otherId,p_email:env.emailB})).error,"Restore membership");
      const restored = await b.from("research_transfer_public_keys").select("public_jwk").eq("study_id",otherId).eq("user_id",bId).single();
      checked(restored.error,"Read restored Study key");
      expect(restored.data?.public_jwk).toEqual(separate.publicJwk);


      const custodianPrivateRead = await a.from("research_transfer_key_backups")
        .select("wrapped_private_key").eq("study_id", studyId);
      checked(custodianPrivateRead.error, "Check custodian private-key RLS");
      expect(custodianPrivateRead.data).toEqual([]);

      expect((await a.rpc("initiate_managed_research_transfer", validArgs)).error?.message).toContain("Study file protection");

      const wrongHashInitiation = await a.rpc("initiate_research_transfer", {
        p_workflow_id: workflowId, p_recipient_id: bId, p_filename: "synthetic_blinded.csv",
        p_plaintext_sha256: "0".repeat(64),
      });
      expect(wrongHashInitiation.error).not.toBeNull();
      const unauthorizedInitiation = await b.rpc("initiate_research_transfer", {
        p_workflow_id: workflowId, p_recipient_id: bId, p_filename: "synthetic_blinded.csv",
        p_plaintext_sha256: packageResult.blinded.sha256,
      });
      expect(unauthorizedInitiation.error).not.toBeNull();

      const context = {
        studyId, workflowId, transformationId: packageResult.receipt.transformationId,
        recipientId: bId, plaintextSha256: packageResult.blinded.sha256,
      };
      const encrypted = await encryptBlindedDataset(
        packageResult.blinded.bytes, backup.publicJwk, context,
      );
      const initiated = await a.rpc("initiate_research_transfer", {
        p_workflow_id: workflowId, p_recipient_id: bId, p_filename: "synthetic_blinded.csv",
        p_plaintext_sha256: packageResult.blinded.sha256,
      });
      checked(initiated.error, "Initiate governed transfer");
      const transferId = id(initiated.data, "transfer");
      console.info(`Synthetic dataset transfer fixture (must be retained when ready): ${transferId}`);
      const path = transferStoragePath(studyId, transferId);

      // No one may upload an unrelated path, even in this private bucket.
      const unauthorizedUpload = await b.storage.from(RESEARCH_TRANSFER_BUCKET).upload(
        `${studyId}/unauthorized-${crypto.randomUUID()}.bin`,
        new Blob(["blocked"], { type: "application/octet-stream" }),
        { upsert: false },
      );
      expect(unauthorizedUpload.error).not.toBeNull();
      await uploadCiphertext(a, path, encrypted.ciphertext);
      const completed = await a.rpc("complete_research_transfer", {
        p_transfer_id: transferId, p_ciphertext_sha256: encrypted.ciphertextSha256,
        p_ciphertext_byte_length: encrypted.ciphertext.byteLength,
        p_envelope: encrypted.envelope,
      });
      checked(completed.error, "Finalize encrypted transfer");
      const senderDirectDownload = await a.storage.from(RESEARCH_TRANSFER_BUCKET).download(path);
      const recipientDirectDownload = await b.storage.from(RESEARCH_TRANSFER_BUCKET).download(path);
      expect(senderDirectDownload.error).not.toBeNull();
      expect(recipientDirectDownload.error).not.toBeNull();
      const unauthorizedGrant = await a.rpc("authorize_research_transfer_download", {
        p_transfer_id: transferId,
      });
      expect(unauthorizedGrant.error).not.toBeNull();
      const grant = await b.rpc("authorize_research_transfer_download", {
        p_transfer_id: transferId,
      });
      checked(grant.error, "Authorize recipient ciphertext retrieval");
      expect(grant.data).toBe(path);
      const stillNoDirectRead = await b.storage.from(RESEARCH_TRANSFER_BUCKET).download(path);
      expect(stillNoDirectRead.error).not.toBeNull();

      // The API server uses Storage service credentials only after the RPC;
      // that HTTP retrieval is exercised in the two-browser Preview smoke.
      // Verify the exact synthetic ciphertext locally as in the browser.
      const recovered = await decryptBlindedDataset(
        encrypted.ciphertext, encrypted.ciphertextSha256, encrypted.envelope,
        context, backup, bId, passphrase,
      );
      expect(Array.from(recovered)).toEqual(Array.from(packageResult.blinded.bytes));
      const acknowledged = await b.rpc("acknowledge_research_transfer", {
        p_transfer_id: transferId, p_plaintext_sha256: packageResult.blinded.sha256,
      });
      checked(acknowledged.error, "Record recipient verification receipt");
      const events = await b.from("research_transfer_events")
        .select("event_type, actor_id, occurred_at")
        .eq("transfer_id", transferId).order("occurred_at");
      checked(events.error, "Read recipient transfer audit trail");
      expect(events.data?.map((entry) => entry.event_type)).toEqual([
        "upload_initiated", "upload_completed", "download_granted", "download_verified",
      ]);
      expect(events.data?.every((entry) => !!entry.actor_id && !!entry.occurred_at)).toBe(true);
      expect((await b.storage.from(RESEARCH_TRANSFER_BUCKET).createSignedUrl(path,60)).error).not.toBeNull();
      expect((await a.storage.from(RESEARCH_TRANSFER_BUCKET).createSignedUrl(path,60)).error).not.toBeNull();
      await exerciseSecretRelease(a,b,studyId,workflowId,aId,bId,packageResult,backup);
    } finally {
      // Retain test audit records; archive the synthetic Study to distinguish
      // it from researcher Studies. Do not print credentials or secret material.
      if (studyId) {
        const archived = await a.from("studies").update({ lifecycle: "archived" })
          .eq("id", studyId);
        checked(archived.error, "Archive synthetic transfer Study");
      }
      await a.auth.signOut();
      await b.auth.signOut();
    }
  });

  it("permits custodian-first managed upload and analyst retrieval without a key", async () => {
    const env = config();
    const options = { auth: { autoRefreshToken: false, persistSession: false } };
    const a = createClient(DEVELOPMENT_URL, env.key, options);
    const b = createClient(DEVELOPMENT_URL, env.key, options);
    const loginA = await a.auth.signInWithPassword({ email: env.emailA, password: env.passwordA });
    checked(loginA.error, "Custodian login");
    const aId = id(loginA.data.user?.id, "custodian");
    const loginB = await b.auth.signInWithPassword({ email: env.emailB, password: env.passwordB });
    checked(loginB.error, "Analyst login");
    const bId = id(loginB.data.user?.id, "analyst");
    let studyId: string | null = null;
    try {
      const studyName = `[INTEGRATION TEST] v46 sender-first managed ${crypto.randomUUID()}`;
      const created = await a.from("studies").insert({ name: studyName });
      checked(created.error, "Create synthetic Study");
      const study = await a.from("studies").select("id")
        .eq("name", studyName).eq("created_by", aId).single();
      checked(study.error, "Read synthetic Study");
      studyId = id(study.data?.id, "Study");
      const workflow = await a.from("blinding_workflows")
        .insert({ study_id: studyId }).select("id").single();
      checked(workflow.error, "Create workflow");
      const workflowId = id(workflow.data?.id, "workflow");
      const analystAssigned = await a.rpc("assign_blinded_analyst_by_email", {
        p_study_id: studyId, p_email: env.emailB,
      });
      checked(analystAssigned.error, "Assign analyst");
      expect(analystAssigned.data).toBe(bId);
      // The receiver has not registered any encryption key in this Study.
      const keys = await b.from("research_transfer_public_keys")
        .select("user_id").eq("study_id", studyId);
      checked(keys.error, "Check no pre-enrollment required");
      expect(keys.data).toEqual([]);
      const unnecessaryKey = await createAnalystKeyBackup(studyId,bId,"Synthetic managed Study passphrase 2026");
      const rejectedKey = await b.rpc("register_research_transfer_key",{p_study_id:studyId,p_public_jwk:unnecessaryKey.publicJwk,
        p_wrapped_private_key:unnecessaryKey.wrappedPrivateKey,p_salt:unnecessaryKey.salt,p_iv:unnecessaryKey.iv});
      expect(rejectedKey.error?.message).toContain("Study does not require recipient-only encryption");


      const draft = await a.from("blinding_plan_drafts")
        .update({ protection_targets: ["Synthetic treatment and site"],
          require_analysis_lock: true, authorization_policy: "independent" })
        .eq("workflow_id", workflowId).select("workflow_id").single();
      checked(draft.error, "Set plan");
      const activated = await a.rpc("activate_blinding_plan", {
        p_workflow_id: workflowId, p_acknowledge_weaker_policies: false,
      });
      checked(activated.error, "Activate plan");
      const packageResult = await createMultiBlindedPackage(source, ["treatment", "site"]);
      const registered = await a.rpc("register_multi_blinding_transformation", {
        p_workflow_id: workflowId, p_public_receipt_text: packageResult.receiptArtifact.text,
      });
      checked(registered.error, "Register blinded dataset");
      const managedStudy = await b.from("studies").select("file_protection").eq("id",studyId).single();
      checked(managedStudy.error,"Read managed Study policy");
      expect(managedStudy.data?.file_protection).toBe("managed_at_rest_v1");
      const rejectedMode = await a.rpc("initiate_research_transfer", {p_workflow_id:workflowId,p_recipient_id:bId,
        p_filename:"synthetic_blinded.csv",p_plaintext_sha256:packageResult.blinded.sha256});
      expect(rejectedMode.error?.message).toContain("Study file protection");


      const wrongHash = await a.rpc("initiate_managed_research_transfer", {
        p_workflow_id: workflowId, p_recipient_id: bId, p_filename: "synthetic_blinded.csv",
        p_plaintext_sha256: "0".repeat(64),
      });
      expect(wrongHash.error).not.toBeNull();
      const unauthorized = await b.rpc("initiate_managed_research_transfer", {
        p_workflow_id: workflowId, p_recipient_id: bId, p_filename: "synthetic_blinded.csv",
        p_plaintext_sha256: packageResult.blinded.sha256,
      });
      expect(unauthorized.error).not.toBeNull();
      const initiated = await a.rpc("initiate_managed_research_transfer", {
        p_workflow_id: workflowId, p_recipient_id: bId, p_filename: "synthetic_blinded.csv",
        p_plaintext_sha256: packageResult.blinded.sha256,
      });
      checked(initiated.error, "Initiate managed transfer");
      const transferId = id(initiated.data, "transfer");
      console.info(`Synthetic dataset transfer fixture (must be retained when ready): ${transferId}`);
      const path = transferStoragePath(studyId, transferId);
      await uploadTransferObject(a, path, packageResult.blinded.bytes);
      const rejectedComplete = await b.rpc("complete_managed_research_transfer", {
        p_transfer_id: transferId, p_object_sha256: packageResult.blinded.sha256,
        p_object_byte_length: packageResult.blinded.bytes.length,
      });
      expect(rejectedComplete.error).not.toBeNull();
      const completed = await a.rpc("complete_managed_research_transfer", {
        p_transfer_id: transferId, p_object_sha256: packageResult.blinded.sha256,
        p_object_byte_length: packageResult.blinded.bytes.length,
      });
      checked(completed.error, "Complete managed transfer");
      const metadata = await b.from("research_transfers")
        .select("transfer_mode, plaintext_sha256, ciphertext_sha256, state")
        .eq("id", transferId).single();
      checked(metadata.error, "Retrieve recipient transfer metadata");
      expect(metadata.data).toMatchObject({
        transfer_mode: "managed_at_rest_v1", state: "ready",
        plaintext_sha256: packageResult.blinded.sha256,
        ciphertext_sha256: packageResult.blinded.sha256,
      });
      // Neither the sender nor receiver may bypass the authenticated
      // download endpoint by reading the private Storage bucket directly.
      expect((await a.storage.from(RESEARCH_TRANSFER_BUCKET).download(path)).error).not.toBeNull();
      expect((await b.storage.from(RESEARCH_TRANSFER_BUCKET).download(path)).error).not.toBeNull();
      const deniedGrant = await a.rpc("authorize_research_transfer_download_v2", {
        p_transfer_id: transferId,
      });
      expect(deniedGrant.error).not.toBeNull();
      const granted = await b.rpc("authorize_research_transfer_download_v2", {
        p_transfer_id: transferId,
      });
      checked(granted.error, "Authorize analyst managed download");
      expect(granted.data).toMatchObject({
        path, mode: "managed_at_rest_v1", sha256: packageResult.blinded.sha256,
        byteLength: packageResult.blinded.bytes.length,
      });
      const attested = await b.rpc("acknowledge_research_transfer", {
        p_transfer_id: transferId, p_plaintext_sha256: packageResult.blinded.sha256,
      });
      checked(attested.error, "Record verification attestation");
      const events = await b.from("research_transfer_events")
        .select("event_type, actor_id, occurred_at").eq("transfer_id", transferId)
        .order("occurred_at");
      checked(events.error, "Read audit events");
      expect(events.data?.map((event) => event.event_type)).toEqual([
        "upload_initiated", "upload_completed", "download_granted", "download_verified",
      ]);
      expect(events.data?.every((event) => !!event.actor_id && !!event.occurred_at)).toBe(true);
      expect((await b.storage.from(RESEARCH_TRANSFER_BUCKET).createSignedUrl(path,60)).error).not.toBeNull();
      expect((await a.storage.from(RESEARCH_TRANSFER_BUCKET).createSignedUrl(path,60)).error).not.toBeNull();
      await exerciseSecretRelease(a,b,studyId,workflowId,aId,bId,packageResult,null);
    } finally {
      if (studyId) {
        const archived = await a.from("studies").update({ lifecycle: "archived" })
          .eq("id", studyId);
        checked(archived.error, "Archive synthetic managed transfer Study");
      }
      await a.auth.signOut();
      await b.auth.signOut();
    }
  });

  it.each(["managed_at_rest_v1", "recipient_e2ee_v1"] as const)("preserves v0.5 secret authorization and rejects the legacy dataset transfer path (%s)", async (fileProtection) => {
    const env = config();
    const options = { auth: { autoRefreshToken: false, persistSession: false } };
    const a = createClient(DEVELOPMENT_URL, env.key, options);
    const b = createClient(DEVELOPMENT_URL, env.key, options);
    const loginA = await a.auth.signInWithPassword({ email: env.emailA, password: env.passwordA });
    checked(loginA.error,"Custodian login"); const aId = id(loginA.data.user?.id,"custodian");
    const loginB = await b.auth.signInWithPassword({ email: env.emailB, password: env.passwordB });
    checked(loginB.error,"Analyst login"); const bId = id(loginB.data.user?.id,"analyst");
    let studyId: string | null = null;
    try {
      const name = `[INTEGRATION TEST] v47 package secret ${fileProtection} ${crypto.randomUUID()}`;
      checked((await a.from("studies").insert({name,file_protection:fileProtection})).error,"Create synthetic Study");
      const study = await a.from("studies").select("id").eq("name",name).eq("created_by",aId).single();
      checked(study.error,"Read synthetic Study"); studyId = id(study.data?.id,"study");
      const assignment = await a.rpc("assign_blinded_analyst_by_email",{p_study_id:studyId,p_email:env.emailB});
      checked(assignment.error,"Assign separated analyst"); expect(assignment.data).toBe(bId);
      const workflow = await a.from("blinding_workflows").insert({study_id:studyId}).select("id").single();
      checked(workflow.error,"Create synthetic workflow"); const workflowId = id(workflow.data?.id,"workflow");
      checked((await a.from("blinding_plan_drafts").update({protection_targets:["Synthetic treatment"],require_analysis_lock:true,authorization_policy:"independent"}).eq("workflow_id",workflowId)).error,"Set plan");
      checked((await a.rpc("activate_blinding_plan",{p_workflow_id:workflowId,p_acknowledge_weaker_policies:false})).error,"Activate plan");
      const p = await createDatasetPackage([
        {datasetId:"d1",bytes:source,adapter:delimitedAdapter("csv")},
        {datasetId:"d2",bytes:new TextEncoder().encode("arm\tscore\nActive\t1\nPlacebo\t2\n"),adapter:delimitedAdapter("tsv")},
      ], [{members:[{datasetId:"d1",variableId:"v2"},{datasetId:"d2",variableId:"v1"}]}]);
      checked((await a.rpc("register_package_blinding_transformation",{p_workflow_id:workflowId,p_public_receipt_text:p.receiptArtifact.text})).error,"Register v0.5 package");
      const backup = fileProtection === "recipient_e2ee_v1" ? await createAnalystKeyBackup(studyId,bId,"Synthetic v47 Study recovery passphrase") : null;
      if (backup) checked((await b.rpc("register_research_transfer_key",{p_study_id:studyId,p_public_jwk:backup.publicJwk,p_wrapped_private_key:backup.wrappedPrivateKey,p_salt:backup.salt,p_iv:backup.iv})).error,"Register Study-specific recipient key");
      const legacyRpc = backup ? "initiate_research_transfer" : "initiate_managed_research_transfer";
      for (const hash of [p.receipt.manifestSha256,p.receipt.manifest.datasets[0].blinded.sha256]) {
        const rejected = await a.rpc(legacyRpc,{p_workflow_id:workflowId,p_recipient_id:bId,p_filename:"synthetic.csv",p_plaintext_sha256:hash});
        expect(rejected.error?.message).toContain("Dataset SHA-256");
      }
      await exerciseSecretRelease(a,b,studyId,workflowId,aId,bId,p,backup);
    } finally {
      if (studyId) checked((await a.from("studies").update({lifecycle:"archived"}).eq("id",studyId)).error,"Archive synthetic package Study");
      await a.auth.signOut(); await b.auth.signOut();
    }
  });

  it.each(["managed_at_rest_v1", "recipient_e2ee_v1"] as const)("delivers independent supporting files and a complete package, with safe retry (%s)", async (protection) => {
    const env = config();
    const options = { auth: { autoRefreshToken: false, persistSession: false } };
    const a = createClient(DEVELOPMENT_URL, env.key, options);
    const b = createClient(DEVELOPMENT_URL, env.key, options);
    const loginA = await a.auth.signInWithPassword({email:env.emailA,password:env.passwordA}); checked(loginA.error,"Custodian login");
    const loginB = await b.auth.signInWithPassword({email:env.emailB,password:env.passwordB}); checked(loginB.error,"Analyst login");
    const aId = id(loginA.data.user?.id,"custodian"), bId = id(loginB.data.user?.id,"analyst");
    let studyId: string | null = null;
    try {
      const name = `[INTEGRATION TEST] v47 multi-file delivery ${protection} ${crypto.randomUUID()}`;
      checked((await a.from("studies").insert({name,file_protection:protection})).error,"Create synthetic Study");
      const study = await a.from("studies").select("id").eq("name",name).single(); checked(study.error,"Read Study");
      studyId=id(study.data?.id,"Study");
      checked((await a.rpc("assign_blinded_analyst_by_email",{p_study_id:studyId,p_email:env.emailB})).error,"Assign analyst before workflow");
      const passphrase="Synthetic v47 file delivery recovery passphrase";
      const backup=protection==="recipient_e2ee_v1" ? await createAnalystKeyBackup(studyId,bId,passphrase) : null;
      const delivery: FileDeliveryContext={studyId,recipientId:bId,protection,packageDelivery:null};
      const document=await prepareResearchFile("protocol.txt",new TextEncoder().encode("Synthetic protocol"),"supporting",protection,null);
      function args(file: PreparedResearchFile) {
        return {p_study_id:delivery.studyId,p_workflow_id:file.purpose==="package_dataset"?delivery.packageDelivery!.workflowId:null,
          p_recipient_id:bId,p_file_purpose:file.purpose,p_artifact_id:file.artifactId,p_filename:file.filename,
          p_plaintext_sha256:file.sha256,p_plaintext_byte_length:file.bytes.length,p_transfer_mode:protection};
      }
      if (backup) {
        expect((await a.rpc("initiate_research_file",args(document))).error).not.toBeNull();
        checked((await b.rpc("register_research_transfer_key",{p_study_id:studyId,p_public_jwk:backup.publicJwk,
          p_wrapped_private_key:backup.wrappedPrivateKey,p_salt:backup.salt,p_iv:backup.iv})).error,"Register Study key");
      }
      expect((await b.rpc("initiate_research_file",args(document))).error).not.toBeNull();
      expect((await a.rpc("initiate_research_file",{...args(document),p_study_id:crypto.randomUUID()})).error).not.toBeNull();
      expect((await a.rpc("initiate_research_file",{...args(document),p_transfer_mode:backup?"managed_at_rest_v1":"recipient_e2ee_v1"})).error).not.toBeNull();
      expect((await a.rpc("initiate_research_file",{...args(document),p_filename:"unblinding-secret.json"})).error).not.toBeNull();
      expect((await a.rpc("initiate_research_file",{...args(document),p_workflow_id:crypto.randomUUID()})).error).not.toBeNull();
      expect((await a.rpc("initiate_research_file",{...args(document),p_plaintext_byte_length:4194305})).error).not.toBeNull();
      async function start(file: PreparedResearchFile) {
        const result=await a.rpc("initiate_research_file",args(file)); checked(result.error,"Initiate research file");
        return id(result.data,"transfer ID");
      }
      async function payload(file: PreparedResearchFile, transferId: string) {
        const encrypted=backup?await encryptResearchFile(file.bytes,backup.publicJwk,researchFileContext(delivery,transferId,file,file.bytes.length)):null;
        const stored=encrypted?.ciphertext??file.bytes;
        return {stored,complete:{p_transfer_id:transferId,p_object_sha256:encrypted?.ciphertextSha256??file.sha256,
          p_object_byte_length:stored.length,p_envelope:encrypted?.envelope??{version:MANAGED_FILE_VERSION}}};
      }
      async function verifyGrant(transferId: string, file: PreparedResearchFile, stored?: Uint8Array) {
        const record=await b.from("research_transfers").select("*").eq("id",transferId).single(); checked(record.error,"Read recipient file metadata");
        const row=record.data as ResearchFileRecord;
        expect(row).toMatchObject({state:"ready",file_purpose:file.purpose,artifact_id:file.artifactId,plaintext_sha256:file.sha256,plaintext_byte_length:file.bytes.length});
        const path=transferStoragePath(delivery.studyId,transferId);
        expect((await a.rpc("authorize_research_transfer_download_v2",{p_transfer_id:transferId})).error).not.toBeNull();
        expect((await a.storage.from(RESEARCH_TRANSFER_BUCKET).download(path)).error).not.toBeNull();
        expect((await b.storage.from(RESEARCH_TRANSFER_BUCKET).createSignedUrl(path,60)).error).not.toBeNull();
        const grant=await b.rpc("authorize_research_transfer_download_v2",{p_transfer_id:transferId}); checked(grant.error,"Authorize recipient download");
        expect(grant.data).toMatchObject({path,mode:protection,sha256:row.ciphertext_sha256,byteLength:row.ciphertext_byte_length});
        if(stored) expect(Array.from(await verifyDeliveredResearchFile(row,delivery,stored,backup,passphrase))).toEqual(Array.from(file.bytes));
        expect((await b.rpc("acknowledge_research_transfer",{p_transfer_id:transferId,p_plaintext_sha256:"0".repeat(64)})).error).not.toBeNull();
        if (stored) checked((await b.rpc("acknowledge_research_transfer",{p_transfer_id:transferId,p_plaintext_sha256:file.sha256})).error,"Acknowledge verified file");
        expect((await a.rpc("abandon_research_file",{p_transfer_id:transferId})).error).not.toBeNull();
        const events=await b.from("research_transfer_events").select("event_type").eq("transfer_id",transferId).order("id"); checked(events.error,"Read audit events");
        expect(events.data?.map(e=>e.event_type)).toEqual(["upload_initiated","upload_completed","download_granted",...(stored?["download_verified"]:[])]);
        console.info(`Synthetic ready research file (must be retained): ${transferId}`);
      }
      // Support sharing is independent of any workflow or registered transformation.
      const first=await start(document); expect(await start(document)).toBe(first);
      const unfinished=await payload(document,first);
      await uploadTransferObject(a,transferStoragePath(delivery.studyId,first),unfinished.stored);
      expect((await b.rpc("abandon_research_file",{p_transfer_id:first})).error).not.toBeNull();
      expect((await b.rpc("complete_research_file",unfinished.complete)).error).not.toBeNull();
      expect((await a.rpc("initiate_research_file",args(document))).error).not.toBeNull();
      checked((await a.rpc("abandon_research_file",{p_transfer_id:first})).error,"Abandon pending uploaded file");
      expect((await a.rpc("complete_research_file",unfinished.complete)).error).not.toBeNull();
      expect((await b.rpc("authorize_research_transfer_download_v2",{p_transfer_id:first})).error).not.toBeNull();
      expect((await a.storage.from(RESEARCH_TRANSFER_BUCKET).update(transferStoragePath(delivery.studyId,first),new Blob([Uint8Array.from(unfinished.stored).buffer]))).error).not.toBeNull();
      console.info(`Synthetic abandoned research file cleanup fixture: ${first}`);
      const retry=await start(document); expect(retry).not.toBe(first);
      const docPayload=await payload(document,retry); await uploadTransferObject(a,transferStoragePath(delivery.studyId,retry),docPayload.stored);
      expect((await a.rpc("complete_research_file",{...docPayload.complete,p_object_byte_length:docPayload.stored.length+1})).error).not.toBeNull();
      checked((await a.rpc("complete_research_file",docPayload.complete)).error,"Complete retried support file");
      await verifyGrant(retry,document,docPayload.stored);
      const support2=await prepareResearchFile("codebook.txt",new TextEncoder().encode("Synthetic codebook"),"supporting",protection,null);
      const support2Id=await sendResearchFile(a,delivery,support2,backup?.publicJwk??null);
      await verifyGrant(support2Id,support2);
      const independent=await b.from("research_transfers").select("workflow_id,transformation_record_id").eq("id",retry).single();
      checked(independent.error,"Verify independent support identity"); expect(independent.data).toEqual({workflow_id:null,transformation_record_id:null});
      // Now register two linked datasets and deliver each exact artifact.
      const workflow=await a.from("blinding_workflows").insert({study_id:studyId}).select("id").single(); checked(workflow.error,"Create workflow");
      const workflowId=id(workflow.data?.id,"workflow");
      checked((await a.from("blinding_plan_drafts").update({protection_targets:["Synthetic treatment"],require_analysis_lock:true,authorization_policy:"independent"}).eq("workflow_id",workflowId)).error,"Set plan");
      checked((await a.rpc("activate_blinding_plan",{p_workflow_id:workflowId,p_acknowledge_weaker_policies:false})).error,"Activate plan");
      const p=await createDatasetPackage([{datasetId:"d1",bytes:source,adapter:delimitedAdapter("csv")},
        {datasetId:"d2",bytes:new TextEncoder().encode("arm\tscore\nActive\t1\nPlacebo\t2\n"),adapter:delimitedAdapter("tsv")}],
        [{members:[{datasetId:"d1",variableId:"v2"},{datasetId:"d2",variableId:"v1"}]}]);
      checked((await a.rpc("register_package_blinding_transformation",{p_workflow_id:workflowId,p_public_receipt_text:p.receiptArtifact.text})).error,"Register package");
      delivery.packageDelivery={workflowId,transformationId:p.receipt.transformationId,datasets:p.receipt.manifest.datasets};
      const readyIds:string[]=[];
      for (const artifact of p.files) {
        const file=await prepareResearchFile(artifact.filename,artifact.bytes,"package_dataset",protection,delivery.packageDelivery);
        for (const invalid of [{p_artifact_id:"unknown"},{p_artifact_id:artifact.datasetId==="d1"?"d2":"d1"},
          {p_filename:"other.csv"},{p_plaintext_sha256:p.receipt.manifestSha256},{p_plaintext_byte_length:artifact.bytes.length+1},{p_workflow_id:crypto.randomUUID()}]) {
          expect((await a.rpc("initiate_research_file",{...args(file),...invalid})).error).not.toBeNull();
        }
        const transferId=await start(file); const object=await payload(file,transferId);
        await uploadTransferObject(a,transferStoragePath(delivery.studyId,transferId),object.stored);
        const legacyComplete=backup?await a.rpc("complete_research_transfer",{p_transfer_id:transferId,p_ciphertext_sha256:object.complete.p_object_sha256,
          p_ciphertext_byte_length:object.stored.length,p_envelope:{...object.complete.p_envelope,version:"v46-ecdh-hkdf-aes256gcm-1"}}):
          await a.rpc("complete_managed_research_transfer",{p_transfer_id:transferId,p_object_sha256:file.sha256,p_object_byte_length:object.stored.length});
        expect(legacyComplete.error).not.toBeNull();
        checked((await a.rpc("complete_research_file",object.complete)).error,"Complete registered dataset");
        expect((await a.rpc("initiate_research_file",args(file))).error).not.toBeNull();
        await verifyGrant(transferId,file,object.stored); readyIds.push(transferId);
      }
      expect(new Set(readyIds).size).toBe(2);
      const ready=await b.from("research_transfers").select("artifact_id,state").eq("study_id",studyId).eq("workflow_id",workflowId).order("artifact_id");
      checked(ready.error,"Read complete package delivery"); expect(ready.data).toEqual([{artifact_id:"d1",state:"ready"},{artifact_id:"d2",state:"ready"}]);
      await exerciseSecretRelease(a,b,studyId,workflowId,aId,bId,p,backup);
    } finally {
      if(studyId) checked((await a.from("studies").update({lifecycle:"archived"}).eq("id",studyId)).error,"Archive synthetic Study");
      await a.auth.signOut(); await b.auth.signOut();
    }
  });

});
