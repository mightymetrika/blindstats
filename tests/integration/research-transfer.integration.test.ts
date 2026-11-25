import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { createMultiAnalysisLockPackage, createMultiUnblindingPackage } from "@/lib/blinding/multi-unblinding";
import { sha256Hex } from "@/lib/blinding/hashing";
import { SECRET_TRANSFER_BUCKET } from "@/lib/research-transfer/secret-constants";
import { sendAuthorizedSecret, validateSecretForReceipt } from "@/lib/research-transfer/secret-transfer";
import { createMultiBlindedPackage } from "@/lib/blinding/multi-blinding";
import {
  createAnalystKeyBackup, decryptBlindedDataset, encryptBlindedDataset,
} from "@/lib/research-transfer/crypto";
import { RESEARCH_TRANSFER_BUCKET, transferStoragePath, uploadCiphertext, uploadTransferObject } from "@/lib/research-transfer/storage";

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
  aId: string, bId: string, packageResult: Awaited<ReturnType<typeof createMultiBlindedPackage>>,
  backup: Awaited<ReturnType<typeof createAnalystKeyBackup>> | null) {
  const hash = await sha256Hex(packageResult.secretArtifact.bytes);
  const mode = backup ? "recipient_e2ee_v1" : "managed_at_rest_v1";
  const lock = await createMultiAnalysisLockPackage(packageResult.receiptArtifact.bytes,
    { filename: "synthetic-analysis.txt", bytes: new TextEncoder().encode("Synthetic locked analysis") });
  const registered = await b.rpc("register_multi_analysis_lock", { p_workflow_id: workflowId, p_analysis_lock_receipt_text: lock.receiptArtifact.text });
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
  const released = await createMultiUnblindingPackage(packageResult.receiptArtifact.bytes,
    packageResult.secretArtifact.bytes, lock.receiptArtifact.bytes);
  const refs = released.receipt.artifacts;
  checked((await b.rpc("register_multi_unblinding_completion", {
    p_workflow_id: workflowId, p_request_id: requestId,
    p_unblinding_id: released.receipt.unblindingId,
    p_receipt_created_at: released.receipt.createdAt,
    p_transformation_id: released.receipt.transformationId,
    p_lock_id: released.receipt.lockId, p_selected_columns: released.receipt.selectedColumns,
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
});
