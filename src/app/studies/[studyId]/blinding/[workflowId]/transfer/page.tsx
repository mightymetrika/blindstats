import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { StudyEncryptionSetup } from "@/components/research-transfer/StudyEncryptionSetup";
import { SignOutButton } from "@/components/SignOutButton";
import { StudyFilesChevron, studyFilesPanel, studyFilesSummary } from "@/components/research-transfer/StudyFilesDisclosure";
import { ResearchTransferWorkspace } from "@/components/research-transfer/ResearchTransferWorkspace";
import type { AnalystKeyBackup, PublicKeyJwk, TransferEnvelope } from "@/lib/research-transfer/crypto";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ studyId: string; workflowId: string }> };

export default async function ResearchTransferPage({ params }: Params) {
  const { studyId, workflowId } = await params;
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims?.sub) redirect("/login");
  const userId = claims.claims.sub as string;
  const [studyResult, workflowResult, capabilityResult, transformationResult] = await Promise.all([
    supabase.from("studies").select("id, name, file_protection").eq("id", studyId).maybeSingle(),
    supabase.from("blinding_workflows").select("id, state")
      .eq("id", workflowId).eq("study_id", studyId).maybeSingle(),
    supabase.from("study_capabilities").select("capability")
      .eq("study_id", studyId).eq("user_id", userId),
    supabase.from("blinding_transformations")
      .select("transformation_id, blinded_artifact_sha256")
      .eq("study_id", studyId).eq("workflow_id", workflowId).maybeSingle(),
  ]);
  if (studyResult.error || workflowResult.error || capabilityResult.error || transformationResult.error) {
    throw new Error("Unable to load Study transfer authorization and transformation.");
  }
  if (!studyResult.data || !workflowResult.data) notFound();

  const capabilities = new Set((capabilityResult.data ?? []).map((item) => item.capability));
  const custodian = ["blinding.create", "blinding.configure", "unblinding.authorize"]
    .every((capability) => capabilities.has(capability)) &&
    ["analysis.lock", "unblinding.request", "unblinded.receive"]
      .every((capability) => !capabilities.has(capability));
  const analyst = ["analysis.lock", "unblinding.request", "unblinded.receive"]
    .every((capability) => capabilities.has(capability)) &&
    ["blinding.create", "blinding.configure", "unblinding.authorize"]
      .every((capability) => !capabilities.has(capability));
  if (!custodian && !analyst) notFound();

  const [transfersResult, keysResult, backupsResult, analystCapabilityResult] = await Promise.all([
    supabase.from("research_transfers")
      .select("id, filename, sender_id, recipient_id, state, transfer_mode, plaintext_sha256, ciphertext_sha256, ciphertext_byte_length, envelope, created_at, ready_at")
      .eq("study_id", studyId).eq("workflow_id", workflowId).order("created_at", { ascending: false }),
    custodian ? supabase.from("research_transfer_public_keys")
      .select("user_id, public_jwk").eq("study_id", studyId) : Promise.resolve({ data: [], error: null }),
    analyst ? supabase.from("research_transfer_key_backups")
      .select("wrapped_private_key, salt, iv")
      .eq("study_id", studyId).eq("user_id", userId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    custodian ? supabase.from("study_capabilities")
      .select("user_id").eq("study_id", studyId).eq("capability", "analysis.lock") : Promise.resolve({ data: [], error: null }),
  ]);
  if (transfersResult.error || keysResult.error || backupsResult.error || analystCapabilityResult.error) {
    throw new Error("Unable to load research transfer records.");
  }
  const analystIds = new Set((analystCapabilityResult.data ?? []).map((item) => item.user_id));
  const publicKeys = new Map((keysResult.data ?? [])
    .map((key) => [key.user_id, key.public_jwk as PublicKeyJwk]));
  const recipients = Array.from(analystIds)
    .filter((id) => id !== userId)
    .map((id) => ({ userId: id, publicJwk: publicKeys.get(id) ?? null }));
  const backup = backupsResult.data ? {
    wrappedPrivateKey: backupsResult.data.wrapped_private_key,
    salt: backupsResult.data.salt, iv: backupsResult.data.iv,
  } satisfies Pick<AnalystKeyBackup, "wrappedPrivateKey" | "salt" | "iv"> : null;
  const transfers = (transfersResult.data ?? []).map((entry) => ({
    ...entry,
    transfer_mode: entry.transfer_mode as "recipient_e2ee_v1" | "managed_at_rest_v1",
    envelope: entry.envelope as TransferEnvelope | { version: "v46-managed-atrest-1" } | null,
  }));

  const transferIds = transfers.map((entry) => entry.id);
  const { data: auditEvents, error: auditError } = transferIds.length
    ? await supabase.from("research_transfer_events")
      .select("transfer_id, actor_id, event_type, occurred_at")
      .in("transfer_id", transferIds).order("occurred_at", { ascending: false }).limit(100)
    : { data: [], error: null };
  if (auditError) throw new Error("Unable to load transfer audit trail.");

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link className="text-sm underline" href={`/studies/${studyId}/blinding/${workflowId}`}>
          Back to blinding workflow
        </Link>
        <SignOutButton />
      </div>
      <header className="my-8">
        <h1 className="text-3xl font-semibold">Study files</h1>
        <p className="mt-2 text-sm text-black/65 dark:text-white/65">
          {studyResult.data.name} · {custodian ? "Blinding custodian" : "Blinded analyst"}
        </p>
        <p className="mt-2 text-xs text-black/60 dark:text-white/60">
          Development only: synthetic data only.
        </p>
      </header>
      {transformationResult.data ? (
        <ResearchTransferWorkspace
          studyId={studyId} workflowId={workflowId} userId={userId}
          transformationId={transformationResult.data.transformation_id}
          expectedSha256={transformationResult.data.blinded_artifact_sha256}
          role={custodian ? "custodian" : "analyst"} recipients={recipients}
          fileProtection={studyResult.data.file_protection === "recipient_e2ee_v1" ? "recipient_e2ee_v1" : "managed_at_rest_v1"}
          backup={backup} transfers={transfers}
        />
      ) : (
        <section className={studyFilesPanel}>
          {analyst && studyResult.data.file_protection === "recipient_e2ee_v1" && !backup ?
            <StudyEncryptionSetup studyId={studyId} userId={userId} /> :
            <p>{analyst ? "No files yet." : "Register the blinded dataset before sending."}</p>}
        </section>
      )}
      <details className={`group mt-6 ${studyFilesPanel}`}>
        <summary className={studyFilesSummary}><StudyFilesChevron />How are files protected?</summary>
        <div className="mt-3 max-w-3xl space-y-2">
          <p>Managed storage encrypts files in transit and at rest. It is not end-to-end encryption:
            privileged BlindStats infrastructure operators can technically access file contents.</p>
          <p>Recipient-only encryption encrypts the file in your browser using the analyst’s registered key.
            The Study requires its own key; the analyst must set it up before you send.</p>
          <p>Downloads require assigned Study access. File integrity is checked and transfer events are recorded.</p>
        </div>
      </details>
      <details className={`group mt-6 ${studyFilesPanel}`}>
        <summary className={studyFilesSummary}><StudyFilesChevron />Transfer audit history</summary>
        {auditEvents?.length ? (
          <ul className="mt-3 space-y-2 text-xs">
            {auditEvents.map((event, index) => (
              <li key={`${event.transfer_id}-${event.occurred_at}-${index}`} className="break-words">
                {new Date(event.occurred_at).toLocaleString()} — {event.event_type} — actor {event.actor_id.slice(0, 8)}… — transfer {event.transfer_id.slice(0, 8)}…
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-sm text-black/60">No transfer events yet.</p>}
      </details>
    </main>
  );
}
